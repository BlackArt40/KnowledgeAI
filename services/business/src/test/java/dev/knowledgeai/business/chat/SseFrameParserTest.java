package dev.knowledgeai.business.chat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** SSE 帧解析契约（与现网/Python 一致：`data: {json}\n\n`，type 在 JSON 内）。 */
class SseFrameParserTest {

    @Test
    void extractsFramesFromStream() {
        String sse = "data: {\"type\":\"sources\",\"count\":1}\n\n"
                + "data: {\"type\":\"token\",\"text\":\"你好\"}\n"
                + "data: {\"type\":\"token\",\"text\":\"世界\"}\n\n"
                + ": ping\n\n"
                + "data: {\"type\":\"done\",\"text\":\"你好世界\",\"citations\":[{\"n\":1}]}\n\n";
        List<String> payloads = SseFrameParser.extractDataPayloads(sse);
        assertEquals(4, payloads.size());
        assertEquals("sources", SseFrameParser.frameType(payloads.get(0)));
        assertEquals("token", SseFrameParser.frameType(payloads.get(1)));
        assertEquals("done", SseFrameParser.frameType(payloads.get(3)));
        assertEquals("你好世界", SseFrameParser.concatTokenText(payloads));
    }

    @Test
    void handlesEmptyAndMalformed() {
        assertTrue(SseFrameParser.extractDataPayloads(null).isEmpty());
        assertTrue(SseFrameParser.extractDataPayloads("").isEmpty());
        assertEquals(0, SseFrameParser.extractDataPayloads("event: ping\ndata:\n\n").size());
        assertEquals(null, SseFrameParser.frameType("not json"));
    }
}
