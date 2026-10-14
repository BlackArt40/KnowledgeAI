# KnowledgeAI AI 服务（阶段 1 拆分）—— 仅内网暴露，compose 不映射宿主端口。
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY pyproject.toml ./
COPY app ./app

RUN pip install --no-cache-dir .

EXPOSE 8000

# 健康探针：GET /health（无鉴权）。--no-access-log 关闭 uvicorn 默认访问日志，
# 统一由 app 内 JSON 中间件输出（含 traceId）。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
