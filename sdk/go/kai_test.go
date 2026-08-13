package kai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Unit tests for the SDK wire format - they run against a local httptest
// server that emulates the KnowledgeAI v1 endpoints (no live server needed).
// `go test ./sdk/go` runs these; scripts/smoke/test-sdk.ts additionally
// exercises the SDKs against a live dev server end-to-end.

func sdkServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"user":{"id":"usr_1","email":"a@b.c","name":"A","role":"owner","workspaceId":"ws_default"}}`))
	})
	mux.HandleFunc("/api/v1/knowledge-bases", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			w.Write([]byte(`{"kbs":[{"id":"kb_1","name":"产品文档"}]}`))
		case http.MethodPost:
			w.WriteHeader(201)
			w.Write([]byte(`{"kb":{"id":"kb_2","name":"新库"}}`))
		}
	})
	mux.HandleFunc("/api/v1/chat", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte("data: {\"type\":\"sources\",\"count\":1,\"chunks\":[]}\n\n"))
		w.Write([]byte("data: {\"type\":\"token\",\"text\":\"你好\"}\n\n"))
		w.Write([]byte("data: {\"type\":\"done\",\"messageId\":\"msg_1\",\"conversationId\":\"conv_1\",\"citations\":[],\"followUps\":[]}\n\n"))
	})
	mux.HandleFunc("/api/v1/agent/run", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte("data: {\"type\":\"done\",\"task\":{\"id\":\"task_1\",\"status\":\"done\"}}\n\n"))
	})
	mux.HandleFunc("/api/v1/webhooks", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			w.Write([]byte(`{"webhooks":[]}`))
		case http.MethodPost:
			w.WriteHeader(201)
			w.Write([]byte(`{"webhook":{"id":"whk_1"}}`))
		}
	})
	mux.HandleFunc("/api/v1/webhooks/whk_1", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			w.Write([]byte(`{"ok":true}`))
		}
	})
	return httptest.NewServer(mux)
}

func TestMe(t *testing.T) {
	srv := sdkServer(t)
	defer srv.Close()
	c := New("kai_sk_test", srv.URL)
	me, err := c.Me(context.Background())
	if err != nil {
		t.Fatalf("Me: %v", err)
	}
	if me.User.ID != "usr_1" || me.User.Role != "owner" {
		t.Fatalf("unexpected me: %+v", me.User)
	}
}

func TestUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`{"error":"未登录"}`))
	}))
	defer srv.Close()
	c := New("", srv.URL)
	_, err := c.Me(context.Background())
	if err == nil {
		t.Fatal("expected error for 401")
	}
	if apiErr, ok := err.(*APIError); !ok || apiErr.Status != 401 {
		t.Fatalf("expected APIError 401, got %v", err)
	}
}

func TestListAndCreateKnowledgeBases(t *testing.T) {
	srv := sdkServer(t)
	defer srv.Close()
	c := New("kai_sk_test", srv.URL)
	ctx := context.Background()

	list, err := c.ListKnowledgeBases(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list.Kbs) != 1 || list.Kbs[0]["name"] != "产品文档" {
		t.Fatalf("unexpected list: %+v", list)
	}

	created, err := c.CreateKnowledgeBase(ctx, "新库", "", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created["kb"].(map[string]any)["id"] != "kb_2" {
		t.Fatalf("unexpected create: %+v", created)
	}
}

func TestAskStreamsTokensAndDone(t *testing.T) {
	srv := sdkServer(t)
	defer srv.Close()
	c := New("kai_sk_test", srv.URL)
	var tokens []string
	done, err := c.Ask(context.Background(), "kb_1", "你好", func(tok string) {
		tokens = append(tokens, tok)
	})
	if err != nil {
		t.Fatalf("ask: %v", err)
	}
	if strings.Join(tokens, "") != "你好" {
		t.Fatalf("tokens: %v", tokens)
	}
	if done.MessageID != "msg_1" || done.ConversationID != "conv_1" {
		t.Fatalf("unexpected done: %+v", done)
	}
}

func TestRunAgent(t *testing.T) {
	srv := sdkServer(t)
	defer srv.Close()
	c := New("kai_sk_test", srv.URL)
	task, err := c.RunAgent(context.Background(), "行业趋势")
	if err != nil {
		t.Fatalf("runAgent: %v", err)
	}
	if task["id"] != "task_1" || task["status"] != "done" {
		t.Fatalf("unexpected task: %+v", task)
	}
}

func TestWebhooks(t *testing.T) {
	srv := sdkServer(t)
	defer srv.Close()
	c := New("kai_sk_test", srv.URL)
	ctx := context.Background()

	ws, err := c.ListWebhooks(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(ws.Webhooks) != 0 {
		t.Fatalf("unexpected: %+v", ws)
	}
	created, err := c.CreateWebhook(ctx, "https://example.com/hook", []string{"kb.ready"}, "测试", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created["webhook"].(map[string]any)["id"] != "whk_1" {
		t.Fatalf("unexpected create: %+v", created)
	}
	if err := c.DeleteWebhook(ctx, "whk_1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
}
