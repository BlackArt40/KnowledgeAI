#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KnowledgeAI Python SDK (P7-1) - zero dependencies (stdlib only).

Usage:
    from kai_sdk import KnowledgeAI, KnowledgeAIError

    kai = KnowledgeAI(api_key="kai_sk_...", base_url="http://localhost:3000")
    data = kai.list_knowledge_bases()
    result = kai.ask("kb_xxx", "产品支持哪些格式？", on_token=lambda t: print(t, end=""))
"""

import json
import urllib.error
import urllib.request

__all__ = ["KnowledgeAI", "KnowledgeAIError"]


class KnowledgeAIError(Exception):
    """Raised for non-2xx responses (carries .status and .body)."""

    def __init__(self, message, status=None, body=None):
        super().__init__(message)
        self.status = status
        self.body = body


class KnowledgeAI:
    def __init__(self, api_key, base_url="http://localhost:3000", timeout=60):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # ── internal ──────────────────────────────────────────────────────────
    def _headers(self, json_body=False):
        headers = {"Authorization": "Bearer %s" % self.api_key}
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    def _request(self, method, path, body=None):
        req = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(body).encode("utf-8") if body is not None else None,
            headers=self._headers(body is not None),
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
                return json.loads(raw.decode("utf-8")) if raw else {}
        except urllib.error.HTTPError as e:
            data = None
            try:
                data = json.loads(e.read().decode("utf-8"))
            except Exception:
                pass
            raise KnowledgeAIError(
                (data or {}).get("error") or "HTTP %d" % e.code, e.code, data
            )
        except urllib.error.URLError as e:
            raise KnowledgeAIError(str(e.reason))

    @staticmethod
    def _sse_events(resp):
        """Yield parsed SSE events (dict) from a text/event-stream body."""
        buffer = ""
        for raw in resp:
            if not raw:
                continue
            buffer += raw.decode("utf-8")
            while "\n\n" in buffer:
                frame, buffer = buffer.split("\n\n", 1)
                for line in frame.splitlines():
                    if line.startswith("data:"):
                        yield json.loads(line[5:].strip())
                        break

    # ── public API ────────────────────────────────────────────────────────
    def me(self):
        return self._request("GET", "/api/v1/me")

    def list_knowledge_bases(self):
        return self._request("GET", "/api/v1/knowledge-bases")

    def create_knowledge_base(self, name, desc="", color=None):
        body = {"name": name, "desc": desc}
        if color:
            body["color"] = color
        return self._request("POST", "/api/v1/knowledge-bases", body)

    def ask(self, kb_id, query, on_token=None, on_sources=None, web_search=False, timeout=None):
        """Streamed Q&A. Returns the `done` event dict.
        on_token(text) / on_sources(chunks) are called as events arrive."""
        payload = {"kbId": kb_id, "query": query, "webSearch": web_search}
        req = urllib.request.Request(
            self.base_url + "/api/v1/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers=self._headers(True),
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as resp:
                done = None
                for event in self._sse_events(resp):
                    if event.get("type") == "sources" and on_sources:
                        on_sources(event.get("chunks", []))
                    elif event.get("type") == "token" and on_token:
                        on_token(event.get("text", ""))
                    elif event.get("type") == "done":
                        done = event
                    elif event.get("type") == "error":
                        raise KnowledgeAIError(
                            event.get("message") or "问答失败", None, event
                        )
                return done
        except urllib.error.HTTPError as e:
            raise KnowledgeAIError("HTTP %d" % e.code, e.code, None)
        except urllib.error.URLError as e:
            raise KnowledgeAIError(str(e.reason))

    def run_agent(self, topic, on_step=None):
        """Streamed agent research. Returns the final task dict."""
        req = urllib.request.Request(
            self.base_url + "/api/v1/agent/run",
            data=json.dumps({"topic": topic}).encode("utf-8"),
            headers=self._headers(True),
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                task = None
                for event in self._sse_events(resp):
                    if event.get("type") == "step" and on_step:
                        on_step(event.get("step"))
                    elif event.get("type") == "done":
                        task = event.get("task")
                    elif event.get("type") == "error":
                        raise KnowledgeAIError(
                            event.get("message") or "Agent 执行失败", None, event
                        )
                return task
        except urllib.error.HTTPError as e:
            raise KnowledgeAIError("HTTP %d" % e.code, e.code, None)
        except urllib.error.URLError as e:
            raise KnowledgeAIError(str(e.reason))

    def list_webhooks(self):
        return self._request("GET", "/api/v1/webhooks")

    def create_webhook(self, url, events, name="", secret=""):
        return self._request(
            "POST",
            "/api/v1/webhooks",
            {"url": url, "events": events, "name": name, "secret": secret},
        )

    def delete_webhook(self, webhook_id):
        return self._request("DELETE", "/api/v1/webhooks/%s" % webhook_id)


if __name__ == "__main__":
    # Quick self-test against a live server:
    #   python3 kai_sdk.py http://localhost:3000 kai_sk_xxx kb_xxx
    import sys

    base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
    key = sys.argv[2] if len(sys.argv) > 2 else ""
    kb = sys.argv[3] if len(sys.argv) > 3 else None
    kai = KnowledgeAI(key, base_url=base)
    print("me:", kai.me())
    print("kbs:", kai.list_knowledge_bases())
    if kb:
        done = kai.ask(kb, "你好")
        print("\ndone:", done)
