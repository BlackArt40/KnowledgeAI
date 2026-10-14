# A6.1 本机演练用的 S3 兼容层（moto）。
# 背景：本机 Docker Hub 匿名拉取配额耗尽且镜像源不可得，MinIO 镜像无法拉取；
# 以 moto server（S3 API 兼容，阶段 2 验收同口径）替代——docker-compose.split.yml
# 的 minio 生产定义保持不变，本文件仅用于本机演练覆盖。
FROM python:3.12-slim
RUN pip install --no-cache-dir "moto[s3,server]==5.2.4"
EXPOSE 9000
CMD ["moto_server", "-H", "0.0.0.0", "-p", "9000"]
