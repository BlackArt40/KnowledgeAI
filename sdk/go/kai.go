// Package kai is the KnowledgeAI Go SDK (P7-1) - zero dependencies (stdlib).
//
// Usage:
//
//	client := kai.New("kai_sk_...", "http://localhost:3000")
//	kbs, err := client.ListKnowledgeBases(ctx)
//	tokens, done, err := client.Ask(ctx, "kb_xxx", "产品支持哪些格式？", nil)
package kai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultTimeout = 60 * time.Second

// Client talks to the KnowledgeAI v1 API.
type Client struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

// New creates a Client. apiKey is a kai_sk_... key or session JWT.
func New(apiKey, baseURL string) *Client {
	if baseURL == "" {
		baseURL = "http://localhost:3000"
	}
	return &Client{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: defaultTimeout},
	}
}

// APIError is returned for non-2xx responses.
type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("kai: HTTP %d %s", e.Status, e.Body)
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &APIError{Status: resp.StatusCode, Body: strings.TrimSpace(string(raw))}
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// SSEEvent is one parsed frame of a text/event-stream response.
type SSEEvent map[string]any

func (c *Client) sse(ctx context.Context, method, path string, body any, onEvent func(SSEEvent) error) error {
	buf, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		return &APIError{Status: resp.StatusCode, Body: strings.TrimSpace(string(raw))}
	}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var data strings.Builder
	flush := func() error {
		if data.Len() == 0 {
			return nil
		}
		line := strings.TrimSpace(data.String())
		data.Reset()
		if !strings.HasPrefix(line, "data:") {
			return nil
		}
		var ev SSEEvent
		if err := json.Unmarshal([]byte(strings.TrimSpace(line[5:])), &ev); err != nil {
			return err
		}
		return onEvent(ev)
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := flush(); err != nil {
				return err
			}
		} else {
			data.WriteString(line)
			data.WriteString("\n")
		}
	}
	if err := flush(); err != nil {
		return err
	}
	return scanner.Err()
}

// ── Public API ────────────────────────────────────────────────────────────

// Me is the identity response of GET /api/v1/me.
type Me struct {
	User struct {
		ID          string `json:"id"`
		Email       string `json:"email"`
		Name        string `json:"name"`
		Role        string `json:"role"`
		WorkspaceID string `json:"workspaceId"`
	} `json:"user"`
}

// Me returns the authenticated caller's identity.
func (c *Client) Me(ctx context.Context) (*Me, error) {
	var out Me
	if err := c.do(ctx, http.MethodGet, "/api/v1/me", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// KbList is the response of GET /api/v1/knowledge-bases.
type KbList struct {
	Kbs []map[string]any `json:"kbs"`
}

// ListKnowledgeBases lists KBs visible in the workspace.
func (c *Client) ListKnowledgeBases(ctx context.Context) (*KbList, error) {
	var out KbList
	if err := c.do(ctx, http.MethodGet, "/api/v1/knowledge-bases", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreateKnowledgeBase creates a KB (requires kb:write scope).
func (c *Client) CreateKnowledgeBase(ctx context.Context, name, desc, color string) (map[string]any, error) {
	body := map[string]any{"name": name, "desc": desc}
	if color != "" {
		body["color"] = color
	}
	var out map[string]any
	if err := c.do(ctx, http.MethodPost, "/api/v1/knowledge-bases", body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// AskResult is the `done` event of a streamed chat answer.
type AskResult struct {
	MessageID      string           `json:"messageId"`
	ConversationID string           `json:"conversationId"`
	Title          string           `json:"title"`
	Citations      []map[string]any `json:"citations"`
	FollowUps      []string         `json:"followUps"`
}

// Ask streams a Q&A over SSE. onToken (may be nil) receives each text delta.
// Returns the `done` event.
func (c *Client) Ask(ctx context.Context, kbID, query string, onToken func(string)) (*AskResult, error) {
	body := map[string]any{"kbId": kbID, "query": query}
	var out *AskResult
	err := c.sse(ctx, http.MethodPost, "/api/v1/chat", body, func(ev SSEEvent) error {
		switch ev["type"] {
		case "token":
			if onToken != nil {
				if t, ok := ev["text"].(string); ok {
					onToken(t)
				}
			}
		case "done":
			raw, err := json.Marshal(ev)
			if err != nil {
				return err
			}
			return json.Unmarshal(raw, &out)
		case "error":
			msg, _ := ev["message"].(string)
			return errors.New("kai: " + msg)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// RunAgent streams an agent research task over SSE. Returns the final task.
func (c *Client) RunAgent(ctx context.Context, topic string) (map[string]any, error) {
	var out map[string]any
	err := c.sse(ctx, http.MethodPost, "/api/v1/agent/run", map[string]any{"topic": topic}, func(ev SSEEvent) error {
		switch ev["type"] {
		case "done":
			task, _ := ev["task"].(map[string]any)
			out = task
		case "error":
			msg, _ := ev["message"].(string)
			return errors.New("kai: " + msg)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// WebhookList is the response of GET /api/v1/webhooks.
type WebhookList struct {
	Webhooks []map[string]any `json:"webhooks"`
}

// ListWebhooks lists webhook subscriptions in the workspace.
func (c *Client) ListWebhooks(ctx context.Context) (*WebhookList, error) {
	var out WebhookList
	if err := c.do(ctx, http.MethodGet, "/api/v1/webhooks", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreateWebhook registers an event subscription.
func (c *Client) CreateWebhook(ctx context.Context, url string, events []string, name, secret string) (map[string]any, error) {
	body := map[string]any{"url": url, "events": events, "name": name, "secret": secret}
	var out map[string]any
	if err := c.do(ctx, http.MethodPost, "/api/v1/webhooks", body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// DeleteWebhook removes a subscription.
func (c *Client) DeleteWebhook(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/api/v1/webhooks/"+id, nil, nil)
}
