// KnowledgeAI 问答结果页 - 读取选中文本与配置, 通过 background 桥接问答。
(function () {
  const $ = (id) => document.getElementById(id);

  chrome.storage.local.get(["kaiPendingQuery", "kaiConfig"], (store) => {
    const query = (store.kaiPendingQuery || "").trim();
    const config = store.kaiConfig || {};
    $("query").textContent = query || "（没有选中文本，请在网页中选中文字后右键发送）";

    if (!config.apiKey || !config.kbId || !query) {
      $("status").textContent = "缺少配置或选中文本，请先到设置页填写 API Key 与知识库 ID。";
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "KAI_ASK",
        query,
        endpoint: config.endpoint || "http://localhost:3000",
        apiKey: config.apiKey,
        kbId: config.kbId,
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          $("status").textContent = "调用失败：" + chrome.runtime.lastError.message;
          return;
        }
        if (resp && resp.ok) {
          $("answer").textContent = resp.answer;
          $("status").textContent = "回答完成";
        } else {
          $("status").textContent = "问答失败：" + ((resp && resp.error) || "未知错误");
        }
      }
    );
  });
})();
