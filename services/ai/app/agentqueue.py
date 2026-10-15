# ---------------------------------------------------------------------------
# Agent 任务队列 + 进度发布（阶段 5，手册 5.2/5.3）。
#
# 队列：语言中立 Redis List（`agent:queue`，Java LPUSH / Python BLPOP）。
#   ADR-0008 原选 arq——其 wire format 为私有协议，而本部署的生产者已定在
#   Java 业务服务（手册 5.1），故切换为裸 Redis List；QUEUE_MAX_DEPTH 背压
#   语义（入队前深度检查、超限拒绝）与 ADR-0007 保持一致，切换点封装在本
#   模块内（enqueue/queue_depth 两个函数）。
# 进度：Redis Pub/Sub channel `agent:<taskId>`（与 TS agent-bus-redis.ts 同名），
#   帧契约 step/done/error/end（init 由业务服务在 SSE 打开时自行发送）。
# 心跳：`agent:worker:heartbeat`（TTL 30s，10s 续期）——业务服务据此在入队
#   前判断 worker 存活（A5.6：worker 挂掉 → 任务进入失败/可重试）。
# 终态快照：done/error 时写 `agent:final:{taskId}`（TTL 7 天）——业务服务
#   懒回收兜底（流中断/无订阅者时仍能取回真实结果而不是误判失败）。
# ---------------------------------------------------------------------------
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, Optional

import redis
import redis.asyncio as aioredis

from . import settings
from .agent import run_pipeline

logger = logging.getLogger("kai.ai.agent")

_publish: Optional[aioredis.Redis] = None
_queue: Optional[aioredis.Redis] = None


def _decode(value: bytes) -> str:
    return value.decode("utf-8") if isinstance(value, bytes) else str(value)


async def _get_publish() -> aioredis.Redis:
    global _publish
    if _publish is None:
        _publish = aioredis.from_url(settings.redis_url(), decode_responses=False)
    return _publish


def _get_queue() -> aioredis.Redis:
    global _queue
    if _queue is None:
        _queue = aioredis.from_url(settings.redis_url(), decode_responses=False)
    return _queue


async def close_connections() -> None:
    global _publish, _queue
    for client in (_publish, _queue):
        if client is not None:
            try:
                await client.aclose()
            except Exception:
                pass
    _publish = None
    _queue = None


async def queue_depth() -> int:
    try:
        return int(await _get_queue().llen(settings.QUEUE_KEY))
    except Exception:
        return 0


async def worker_alive() -> bool:
    try:
        return bool(await _get_queue().exists(settings.WORKER_HEARTBEAT_KEY))
    except Exception:
        return False


async def enqueue_agent_run(job: Dict[str, Any]) -> int:
    """LPUSH 入队。返回当前队列深度（调用方在入队前自行做深度检查）。"""
    client = _get_queue()
    await client.lpush(settings.QUEUE_KEY, json.dumps(job, ensure_ascii=False))
    return int(await client.llen(settings.QUEUE_KEY))


async def _publish_frame(task_id: str, frame: Dict[str, Any]) -> None:
    client = await _get_publish()
    await client.publish(f"agent:{task_id}", json.dumps(frame, ensure_ascii=False))


async def _heartbeat_loop() -> None:
    client = _get_queue()
    while True:
        try:
            await client.set(settings.WORKER_HEARTBEAT_KEY, "1",
                             ex=settings.WORKER_HEARTBEAT_TTL_S)
        except Exception as e:
            logger.warning("heartbeat failed", extra={"fields": {"err": str(e)}})
        await asyncio.sleep(settings.WORKER_HEARTBEAT_INTERVAL_S)


async def _run_one(job: Dict[str, Any]) -> None:
    task_id = str(job.get("taskId") or "")
    if not task_id:
        return
    started = time_ms()

    async def emit(frame: Dict[str, Any]) -> None:
        await _publish_frame(task_id, frame)

    logger.info("agent run start", extra={"fields": {"taskId": task_id, "topic": job.get("topic", "")}})
    try:
        task_snapshot = await run_pipeline(job, emit)
        await emit({"type": "done", "task": task_snapshot})
        final = {"ok": True, "task": task_snapshot}
        logger.info("agent run done", extra={"fields": {
            "taskId": task_id, "durationMs": time_ms() - started,
            "citations": len(task_snapshot.get("citations") or []),
        }})
    except Exception as e:
        message = str(e) or "执行失败"
        await emit({"type": "error", "message": message})
        final = {"ok": False, "error": message}
        logger.error("agent run failed", extra={"fields": {"taskId": task_id, "err": message}})
    finally:
        # end 帧恒发（SSE 消费方据此关闭流；与 TS publishAgentEnd 语义一致）
        await emit({"type": "end"})
        # 终态快照（业务服务懒回收兜底）
        try:
            client = await _get_publish()
            await client.set(f"agent:final:{task_id}", json.dumps(final, ensure_ascii=False),
                             ex=settings.AGENT_FINAL_KEY_TTL_S)
        except Exception as e:
            logger.warning("final snapshot failed", extra={"fields": {"taskId": task_id, "err": str(e)}})


def time_ms() -> int:
    import time

    return int(time.time() * 1000)


async def _worker_loop() -> None:
    client = _get_queue()
    while True:
        try:
            item = await client.brpop(settings.QUEUE_KEY, timeout=5)
            if item is None:
                continue
            _key, raw = item
            try:
                job = json.loads(_decode(raw))
            except ValueError:
                logger.warning("invalid job payload dropped")
                continue
            await _run_one(job)
        except asyncio.CancelledError:
            raise
        except redis.exceptions.TimeoutError:
            # BLPOP 的 5 秒空转超时与底层 socket 读超时存在竞态（评审 #2）：
            # 空转轮询周期性抛 TimeoutError 属预期，静默续跑——不刷 ERROR 日志
            continue
        except Exception as e:
            # 单任务失败不拖垮 worker（连接抖动等），退避后继续
            logger.error("worker loop error", extra={"fields": {"err": str(e)}})
            await asyncio.sleep(1.0)


_worker_tasks: list = []


def start_worker() -> None:
    """uvicorn 启动时注册：心跳 + 消费循环（进程内 asyncio worker）。"""
    if _worker_tasks:
        return
    _worker_tasks.append(asyncio.create_task(_heartbeat_loop()))
    _worker_tasks.append(asyncio.create_task(_worker_loop()))
    logger.info("agent worker started", extra={"fields": {
        "queue": settings.QUEUE_KEY, "maxDepth": settings.QUEUE_MAX_DEPTH}})


async def stop_worker() -> None:
    for t in _worker_tasks:
        t.cancel()
    _worker_tasks.clear()
    await close_connections()
