// ---------------------------------------------------------------------------
// KnowledgeAI VS Code extension - 代码库内 RAG 问答.
//
// Commands:
//   kai.askSelection  - ask about the selected code (editor context menu)
//   kai.askFile       - ask about the whole active file
//   kai.syncWorkspace - collect workspace files -> sync to a KB (docs)
//   kai.configure     - set endpoint / API key / KB id (stored in secrets)
//
// Plain CommonJS (no build step), same zero-dependency style as the Chrome
// extension / embeddable widget. API protocol lives in ask.js / sync.js
// (pure Node modules, unit-tested by scripts/smoke/test-vscode.ts).
// ---------------------------------------------------------------------------

"use strict";

const vscode = require("vscode");
const { askOnce } = require("./ask");
const { collectFiles, syncWorkspaceToKb } = require("./sync");

const SECRET_KEYS = { endpoint: "kai.endpoint", apiKey: "kai.apiKey", kbId: "kai.kbId" };

async function loadConfig(context) {
  const [endpoint, apiKey, kbId] = await Promise.all([
    context.secrets.get(SECRET_KEYS.endpoint),
    context.secrets.get(SECRET_KEYS.apiKey),
    context.secrets.get(SECRET_KEYS.kbId),
  ]);
  return {
    endpoint: endpoint || "http://localhost:3000",
    apiKey: apiKey || "",
    kbId: kbId || "",
  };
}

function requireConfig(cfg) {
  if (!cfg.apiKey) {
    vscode.window.showWarningMessage("请先运行「KnowledgeAI: 配置连接」填写 API Key");
    return false;
  }
  if (!cfg.kbId) {
    vscode.window.showWarningMessage("请先运行「KnowledgeAI: 配置连接」填写知识库 ID");
    return false;
  }
  return true;
}

async function runAsk(context, output, query, sourceLabel) {
  const cfg = await loadConfig(context);
  if (!requireConfig(cfg)) return;
  output.clear();
  output.appendLine(`[KnowledgeAI] ${sourceLabel}`);
  output.appendLine(`问题：${query}\n`);
  output.show(true);
  try {
    const { answer, sources } = await askOnce({ ...cfg, query });
    output.appendLine(answer);
    if (sources && sources.length) {
      output.appendLine(`\n--- 引用来源 (${sources.length}) ---`);
      for (const s of sources.slice(0, 10)) {
        output.appendLine(`- ${s.name || s.title || s.url || s.docId || "?"}`);
      }
    }
    vscode.window.setStatusBarMessage("KnowledgeAI: 回答完成", 3000);
  } catch (err) {
    output.appendLine(`\n[错误] ${err.message}`);
    vscode.window.showErrorMessage(`KnowledgeAI 问答失败：${err.message}`);
  }
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const output = vscode.window.createOutputChannel("KnowledgeAI");

  context.subscriptions.push(
    vscode.commands.registerCommand("kai.configure", async () => {
      const cfg = await loadConfig(context);
      const endpoint = await vscode.window.showInputBox({
        prompt: "KnowledgeAI 服务地址（含端口）",
        value: cfg.endpoint,
        validateInput: (v) => (/^https?:\/\/.+/.test(v) ? null : "需为 http(s):// 地址"),
      });
      if (endpoint === undefined) return;
      const apiKey = await vscode.window.showInputBox({
        prompt: "API Key（需 chat:read / kb:write 权限）",
        password: true,
        value: cfg.apiKey || undefined,
      });
      if (apiKey === undefined) return;
      const kbId = await vscode.window.showInputBox({
        prompt: "知识库 ID",
        value: cfg.kbId || undefined,
      });
      if (kbId === undefined) return;
      await context.secrets.store(SECRET_KEYS.endpoint, endpoint);
      await context.secrets.store(SECRET_KEYS.apiKey, apiKey);
      await context.secrets.store(SECRET_KEYS.kbId, kbId);
      vscode.window.showInformationMessage("KnowledgeAI 连接配置已保存");
    }),

    vscode.commands.registerCommand("kai.askSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const sel = editor.selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(editor.selection);
      if (!sel.trim()) {
        vscode.window.showWarningMessage("没有可提问的代码（请先选中）");
        return;
      }
      await runAsk(context, output, sel, `选中代码 · ${editor.document.fileName}`);
    }),

    vscode.commands.registerCommand("kai.askFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const text = editor.document.getText();
      await runAsk(context, output, text.slice(0, 100_000), `当前文件 · ${editor.document.fileName}`);
    }),

    vscode.commands.registerCommand("kai.syncWorkspace", async () => {
      const cfg = await loadConfig(context);
      if (!requireConfig(cfg)) return;
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || !folders.length) {
        vscode.window.showWarningMessage("请先打开一个工作区文件夹");
        return;
      }
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "KnowledgeAI: 同步工作区…", cancellable: false },
        async () => {
          const files = await collectFiles(folders[0].uri.fsPath);
          if (!files.length) {
            vscode.window.showInformationMessage("没有可同步的代码/文本文件");
            return;
          }
          output.clear();
          output.appendLine(`[KnowledgeAI] 同步 ${folders[0].name}（${files.length} 个文件）`);
          output.show(true);
          const result = await syncWorkspaceToKb({
            ...cfg,
            files,
            onProgress: (done, total, name, imported) =>
              output.appendLine(`  [${done}/${total}] ${name}（累计导入 ${imported}）`),
          });
          output.appendLine(
            `\n完成：导入 ${result.imported.length} / 跳过（重名）${result.skipped.length} / 失败 ${result.failed.length}`
          );
          if (result.failed.length) output.appendLine(`失败：${result.failed.join(", ")}`);
          vscode.window.showInformationMessage(
            `KnowledgeAI 同步完成：导入 ${result.imported.length} 个文档`
          );
        }
      );
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
