# 业务服务镜像（阶段 6 拆分部署，docker-compose.split.yml / k8s/split.yaml 用）。
# 多阶段：Maven 构建 → 极简 JRE 运行时。构建参数无需密钥（A6.5：密钥只走运行时 env）。
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
# 先拷 pom 拉依赖（层缓存：源码变更不重拉）
COPY pom.xml ./
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:17-jre
# curl 供容器 HEALTHCHECK（/actuator/health）
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/target/*.jar app.jar
EXPOSE 8080
# pg profile 是生产形态（ADR-0009 红线：无 DB 无业务）；配置全部经环境变量注入
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar", "--spring.profiles.active=pg"]
