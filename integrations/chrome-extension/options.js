// KnowledgeAI 扩展设置页 - 保存 API Key / 知识库 / 服务地址。
(function () {
  const $ = (id) => document.getElementById(id);

  chrome.storage.local.get(["kaiConfig"], (store) => {
    const c = store.kaiConfig || {};
    $("endpoint").value = c.endpoint || "http://localhost:3000";
    $("apiKey").value = c.apiKey || "";
    $("kbId").value = c.kbId || "";
  });

  $("save").addEventListener("click", () => {
    chrome.storage.local.set(
      {
        kaiConfig: {
          endpoint: $("endpoint").value.trim(),
          apiKey: $("apiKey").value.trim(),
          kbId: $("kbId").value.trim(),
        },
      },
      () => {
        $("status").textContent = "已保存 ✓ 现在可以在网页中选中文字并右键提问。";
      }
    );
  });
})();
