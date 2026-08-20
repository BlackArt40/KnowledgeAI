---
title: Webhook 指南
description: KnowledgeAI 出站 Webhook 订阅、事件类型、HMAC 签名验证与投递重试机制
type: how-to
category: api
level: L2
version: 1.0.0
authors: [technical-writer]
owner: api-owner
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [guide.md, errors.md, reference.md]
---

# Webhook 指南

> 本文教你订阅 KnowledgeAI 事件（文档就绪 / Agent 完成 / 用量告警）、验证签名并处理投递重试。

## 事件类型

| 事件 | 触发时机 | 载荷要点 |
|------|----------|----------|
| `kb.ready` | 知识库内某文档处理完成 | 文档 ID、知识库 ID、处理状态 |
| `agent.completed` | Agent 调研任务成功完成 | 任务 ID、主题、报告内容摘要 |
| `usage.alert` | 工作区用量跨越套餐阈值 | 用量统计、阈值、套餐信息 |

## 创建订阅

```bash
curl -X POST http://localhost:3000/api/v1/webhooks \
  -H "Authorization: Bearer kai_sk_..." -H "Content-Type: application/json" \
  -d '{
    "name": "我的接收端",
    "url": "https://example.com/hooks/kai",
    "secret": "a-random-signing-secret",
    "events": ["kb.ready", "agent.completed"]
  }'
```

- `url` 必须是 HTTPS（创建时校验）；
- `secret` 用于签名验证；**不填则投递不签名**（生产环境务必填写）；
- 返回 `201` + 订阅对象（含 `id`）。

## 投递格式与签名验证

每个事件以 `POST` 投递到订阅 URL，请求头：

```
X-KAI-Event: kb.ready
X-KAI-Signature: sha256=<HMAC-SHA256 十六进制>
Content-Type: application/json
```

**签名算法**：以 `secret` 为密钥，对请求体（原始字节）做 HMAC-SHA256，输出 `sha256=<hex>`。

**验证示例**（Node.js）：

```javascript
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(rawBody, header, secret) {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

**验证示例**（Python）：

```python
import hashlib, hmac

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(header, expected)
```

**验证示例**（Go）：

```go
import "crypto/hmac"
import "crypto/sha256"
import "encoding/hex"

func verify(raw []byte, header, secret string) bool {
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write(raw)
    want := "sha256=" + hex.EncodeToString(mac.Sum(nil))
    return hmac.Equal([]byte(header), []byte(want))
}
```

## 投递与重试机制

- 投递走后台队列（`webhook-deliver`），与业务解耦，**fire-and-forget**；
- 内存队列：重试 3 次，指数退避；BullMQ 后端：自带重试与死信队列（DLQ）；
- 你的接收端应快速返回 `2xx`；非 2xx 会被视为失败进入重试；
- 幂等处理：投递可能重试，接收端需按事件 ID / 文档 ID 幂等去重。

## 管理订阅

| 操作 | 端点 |
|------|------|
| 列表（含最近投递记录） | `GET /api/v1/webhooks` |
| 详情（含投递历史） | `GET /api/v1/webhooks/{id}` |
| 更新（名称/地址/密钥/事件/启用） | `PATCH /api/v1/webhooks/{id}` |
| 删除 | `DELETE /api/v1/webhooks/{id}` |
| 发送测试事件 | `POST /api/v1/webhooks/{id}/test` |

## 相关文档

- [API 使用指南](guide.md)
- [API 参考](reference.md)
- [错误码表](errors.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版（依据 src/lib/webhooks 源码核对） |
