package dev.knowledgeai.business;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * KnowledgeAI 业务服务入口（阶段 4 拆分）。
 *
 * 语言与组件选型见 docs/architecture/adr/adr-0009-business-service-language.md：
 * Java 17 + Spring Boot 3 + Spring Security（M1 引入）+ Flyway baseline（M2 引入）。
 * 端口约定：8080（Next BFF / 网关的 /api 反代目标）。
 */
@SpringBootApplication
public class BusinessApplication {

    public static void main(String[] args) {
        SpringApplication.run(BusinessApplication.class, args);
    }
}
