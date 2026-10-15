package dev.knowledgeai.business.agent;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Service;

/**
 * Agent 事件总线（手册 5.3）：订阅 Redis Pub/Sub channel `agent:<taskId>`，
 * 把 Python worker 发布的帧（step/done/error/end）转交 SSE 流。
 * channel 命名与 TS src/lib/queue/agent-bus-redis.ts 一致（跨语言契约）。
 * 用法：先 subscribe 拿到 FrameChannel（在入队之前，防丢首帧），SSE 线程
 * poll 消费，end 帧或超时后 close()。
 */
@Service
@Profile("pg")
public class AgentEventBus {

    private final RedisMessageListenerContainer container;

    public AgentEventBus(RedisMessageListenerContainer container) {
        this.container = container;
    }

    public FrameChannel subscribe(String taskId) {
        ChannelTopic topic = new ChannelTopic("agent:" + taskId);
        BlockingQueue<String> queue = new LinkedBlockingQueue<>();
        org.springframework.data.redis.connection.MessageListener listener = (message, pattern) -> {
            byte[] body = message.getBody() == null ? new byte[0] : message.getBody();
            queue.add(new String(body, StandardCharsets.UTF_8));
        };
        container.addMessageListener(listener, topic);
        return new FrameChannel(queue, () -> container.removeMessageListener(listener, topic));
    }

    /** 一个任务的帧通道：SSE 线程 poll，关闭时退订。 */
    public static final class FrameChannel implements AutoCloseable {
        private final BlockingQueue<String> queue;
        private final Runnable unsubscribe;
        private volatile boolean closed;

        FrameChannel(BlockingQueue<String> queue, Runnable unsubscribe) {
            this.queue = queue;
            this.unsubscribe = unsubscribe;
        }

        /** 阻塞取一帧；超时返回 null。 */
        public String poll(long timeoutMs) throws InterruptedException {
            return queue.poll(timeoutMs, TimeUnit.MILLISECONDS);
        }

        @Override
        public void close() {
            if (closed) return;
            closed = true;
            try {
                unsubscribe.run();
            } catch (Exception ignored) {
                // 退订失败不影响响应
            }
        }
    }

    @Configuration
    @Profile("pg")
    static class BusConfig {
        @Bean
        public RedisMessageListenerContainer agentListenerContainer(RedisConnectionFactory connectionFactory) {
            RedisMessageListenerContainer container = new RedisMessageListenerContainer();
            container.setConnectionFactory(connectionFactory);
            // 单线程派发（评审修复）：容器默认 SimpleAsyncTaskExecutor 每消息一线程，
            // done（大帧）与 end（小帧）背靠背发布时并发竞速——end 先被 relay 处理会
            // 提前 return 关流，done 帧丢失。单线程保证同 channel 帧按发布顺序派发。
            container.setTaskExecutor(new java.util.concurrent.ThreadPoolExecutor(
                    1, 1, 60L, java.util.concurrent.TimeUnit.SECONDS,
                    new java.util.concurrent.LinkedBlockingQueue<>(),
                    r -> {
                        Thread t = new Thread(r, "agent-frame-dispatch");
                        t.setDaemon(true);
                        return t;
                    }));
            return container;
        }
    }
}
