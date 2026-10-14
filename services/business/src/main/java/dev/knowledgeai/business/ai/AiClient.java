package dev.knowledgeai.business.ai;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

/**
 * Python AI 服务客户端（手册 4.8）。业务服务持有 AI_INTERNAL_TOKEN，
 * /internal/* 契约与 ADR-0008 一致；SSE 帧格式 = `data: {json}\n\n`。
 */
@Service
@Profile("pg")
public class AiClient {

    private final String baseUrl;
    private final String internalToken;
    private final HttpClient http;

    public AiClient(@Value("${ai.service-url}") String baseUrl,
                    @Value("${ai.internal-token}") String internalToken) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.internalToken = internalToken;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    public record IndexResult(boolean ok, int chunks, String code, String message) {
    }

    /** POST /internal/index（content 内联源；workspaceId 已由业务侧校验）。 */
    public IndexResult index(String workspaceId, String kbId, String docId,
                             String filename, String mime, String content,
                             int chunkSize, int chunkOverlap) throws IOException, InterruptedException {
        Map<String, Object> source = new LinkedHashMap<>();
        source.put("type", "content");
        source.put("content", content);
        Map<String, Object> settings = Map.of("chunkSize", chunkSize, "chunkOverlap", chunkOverlap);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("workspaceId", workspaceId);
        body.put("kbId", kbId);
        body.put("docId", docId);
        body.put("filename", filename);
        body.put("mime", mime);
        body.put("source", source);
        body.put("settings", settings);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/internal/index"))
                .timeout(Duration.ofMillis(120_000))
                .header("Content-Type", "application/json")
                .header("X-Internal-Token", internalToken)
                .POST(HttpRequest.BodyPublishers.ofString(toJson(body)))
                .build();
        HttpResponse<String> res = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        Map<String, Object> parsed = parseJson(res.body());
        boolean ok = Boolean.TRUE.equals(parsed.get("ok"));
        Number chunks = (Number) parsed.get("chunks");
        return new IndexResult(ok, chunks == null ? 0 : chunks.intValue(),
                (String) parsed.get("code"), (String) parsed.get("message"));
    }

    /** POST /internal/index（binary 源：base64 传输，Python 侧按 mime 解析 pdf/docx/xlsx）。 */
    public IndexResult indexBinary(String workspaceId, String kbId, String docId,
                                   String filename, String mime, byte[] bytes,
                                   int chunkSize, int chunkOverlap) throws IOException, InterruptedException {
        Map<String, Object> source = new LinkedHashMap<>();
        source.put("type", "binary");
        source.put("mime", mime);
        source.put("contentB64", Base64.getEncoder().encodeToString(bytes));
        Map<String, Object> settings = Map.of("chunkSize", chunkSize, "chunkOverlap", chunkOverlap);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("workspaceId", workspaceId);
        body.put("kbId", kbId);
        body.put("docId", docId);
        body.put("filename", filename);
        body.put("mime", mime);
        body.put("source", source);
        body.put("settings", settings);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/internal/index"))
                .timeout(Duration.ofMillis(120_000))
                .header("Content-Type", "application/json")
                .header("X-Internal-Token", internalToken)
                .POST(HttpRequest.BodyPublishers.ofString(toJson(body)))
                .build();
        HttpResponse<String> res = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        Map<String, Object> parsed = parseJson(res.body());
        boolean ok = Boolean.TRUE.equals(parsed.get("ok"));
        Number chunks = (Number) parsed.get("chunks");
        return new IndexResult(ok, chunks == null ? 0 : chunks.intValue(),
                (String) parsed.get("code"), (String) parsed.get("message"));
    }

    /** DELETE /internal/index/{kbId}/{docId}?workspaceId=（阶段 3 租户过滤契约）。 */
    public void clearIndex(String workspaceId, String kbId, String docId) throws IOException, InterruptedException {
        String path = docId == null
                ? "/internal/index/" + kbId
                : "/internal/index/" + kbId + "/" + docId;
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + path + "?workspaceId=" + workspaceId))
                .timeout(Duration.ofSeconds(15))
                .header("X-Internal-Token", internalToken)
                .DELETE()
                .build();
        http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    /** POST /internal/chat/stream —— 返回响应体流（SSE `data:` 帧序列），由调用方透传。 */
    public HttpResponse<java.io.InputStream> chatStream(String bodyJson) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/internal/chat/stream"))
                .timeout(Duration.ofMillis(120_000))
                .header("Content-Type", "application/json")
                .header("X-Internal-Token", internalToken)
                .POST(HttpRequest.BodyPublishers.ofString(bodyJson, StandardCharsets.UTF_8))
                .build();
        return http.send(request, HttpResponse.BodyHandlers.ofInputStream());
    }

    /** 通用内部 POST（阶段 5：/internal/agent/run 入队）。返回原始响应供调用方判状态码。 */
    public HttpResponse<String> postInternal(String path, String bodyJson)
            throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + path))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/json")
                .header("X-Internal-Token", internalToken)
                .POST(HttpRequest.BodyPublishers.ofString(bodyJson, StandardCharsets.UTF_8))
                .build();
        return http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    /** GET /health —— 就绪探针的 ai 维度（ADR-0006/0007 同语义：不可达 = degraded）。 */
    public boolean healthy() {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/health"))
                    .timeout(Duration.ofSeconds(3))
                    .GET().build();
            return http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).statusCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> parseJson(String body) {
        // 极简解析：仅提取 ok/chunks/code/message 四个平铺字段（契约固定，避免引 JSON 库）
        Map<String, Object> out = new LinkedHashMap<>();
        if (body == null) return out;
        out.put("ok", body.contains("\"ok\":true"));
        Number chunks = extractNumber(body, "chunks");
        if (chunks != null) out.put("chunks", chunks);
        String code = extractString(body, "code");
        if (code != null) out.put("code", code);
        String message = extractString(body, "message");
        if (message != null) out.put("message", message);
        return out;
    }

    private static Number extractNumber(String body, String key) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"" + key + "\":(\\d+)").matcher(body);
        return m.find() ? Long.parseLong(m.group(1)) : null;
    }

    private static String extractString(String body, String key) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"" + key + "\":\"([^\"]*)\"").matcher(body);
        return m.find() ? m.group(1) : null;
    }

    /** 极简 JSON 序列化：值仅 String/Number/Map/List&lt;String&gt;（内部契约固定）。字符串做基本转义。 */
    public static String toJson(Map<String, Object> map) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> e : map.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append('"').append(escape(e.getKey())).append("\":");
            Object v = e.getValue();
            if (v instanceof Map<?, ?> nested) {
                @SuppressWarnings("unchecked")
                Map<String, Object> nestedMap = (Map<String, Object>) nested;
                sb.append(toJson(nestedMap));
            } else if (v instanceof List<?> list) {
                sb.append('[');
                boolean itemFirst = true;
                for (Object item : list) {
                    if (!itemFirst) sb.append(',');
                    itemFirst = false;
                    sb.append('"').append(escape(String.valueOf(item))).append('"');
                }
                sb.append(']');
            } else if (v instanceof Number) {
                sb.append(v);
            } else {
                sb.append('"').append(escape(String.valueOf(v))).append('"');
            }
        }
        return sb.append('}').toString();
    }

    private static String escape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }
}
