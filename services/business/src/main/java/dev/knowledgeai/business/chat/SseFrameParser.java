package dev.knowledgeai.business.chat;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SSE `data:` 帧解析（手册 4.4/4.8）：Python AI 服务与现网 TS 的 SSE 线上格式
 * 均为 `data: {json}\n\n`（type 字段在 JSON 内：sources/token/done/error）。
 * 纯函数，便于单测。
 */
public final class SseFrameParser {

    private static final Pattern DATA_LINE = Pattern.compile("^data:( .*)?$", Pattern.MULTILINE);

    private SseFrameParser() {
    }

    /** 提取一段 SSE 文本中的 data 帧 JSON 列表（忽略非 data 行与空帧）。 */
    public static List<String> extractDataPayloads(String sseText) {
        List<String> out = new ArrayList<>();
        if (sseText == null || sseText.isEmpty()) return out;
        for (String block : sseText.split("\n\n")) {
            for (String line : block.split("\n")) {
                Matcher m = DATA_LINE.matcher(line);
                if (m.matches()) {
                    String payload = m.group(1);
                    if (payload != null && !payload.isBlank()) {
                        out.add(payload.stripLeading());
                    }
                }
            }
        }
        return out;
    }

    /** 从 data 帧 JSON 中取 "type" 字段值（契约固定，避免引 JSON 库）。 */
    public static String frameType(String dataJson) {
        Matcher m = Pattern.compile("\"type\"\\s*:\\s*\"(\\w+)\"").matcher(dataJson);
        return m.find() ? m.group(1) : null;
    }

    /** 拼接 token 帧的 text 字段（demo 生成 3 字符/token）。 */
    public static String concatTokenText(List<String> dataJsons) {
        StringBuilder sb = new StringBuilder();
        Pattern p = Pattern.compile("\"text\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        for (String json : dataJsons) {
            if ("token".equals(frameType(json))) {
                Matcher m = p.matcher(json);
                if (m.find()) sb.append(unescape(m.group(1)));
            }
        }
        return sb.toString();
    }

    private static String unescape(String s) {
        return s.replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t")
                .replace("\\\"", "\"").replace("\\\\", "\\");
    }
}
