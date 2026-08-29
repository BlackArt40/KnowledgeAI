# Static SDK exercise script - executed by scripts/smoke/test-sdk.ts with all
# runtime config in the environment (never interpolated into code):
#   KAI_SDK_DIR   directory holding kai_sdk.py
#   KAI_BASE_URL  local dev-server origin
#   KAI_API_KEY   API key created by the parent smoke run
#   KAI_KB_ID     KB to chat against
import os
import sys

sys.path.insert(0, os.environ["KAI_SDK_DIR"])
from kai_sdk import KnowledgeAI  # noqa: E402

kai = KnowledgeAI(os.environ["KAI_API_KEY"], base_url=os.environ["KAI_BASE_URL"])
me = kai.me()
assert me["user"]["id"], "me failed"
kbs = kai.list_knowledge_bases()
assert isinstance(kbs["kbs"], list), "list failed"
created = kai.create_knowledge_base("SDK Py 测试库")
assert created["kb"]["id"], "create failed"
tokens = []
done = kai.ask(os.environ["KAI_KB_ID"], "介绍一下这个知识库的内容", on_token=tokens.append)
assert done["conversationId"], "ask failed"
assert len(tokens) > 0, "no tokens"
task = kai.run_agent("一句话总结：大模型的发展")
assert task and task["status"] == "done", "agent failed"
whs = kai.list_webhooks()
assert isinstance(whs["webhooks"], list), "webhooks failed"
wh = kai.create_webhook("https://example.com/hook", ["kb.ready"], name="sdk")
assert wh["webhook"]["id"], "webhook create failed"
kai.delete_webhook(wh["webhook"]["id"])
print("PY_OK me=" + me["user"]["id"] + " kbs=" + str(len(kbs["kbs"])) + " tokens=" + str(len(tokens)) + " task=" + task["status"])
