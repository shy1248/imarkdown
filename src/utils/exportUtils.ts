import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { i18n } from './i18n';

/**
 * 向 webview 编辑器请求 HTML 内容，返回包含 HTML 的 Promise。
 */
export function requestHtmlFromWebview(
    webviewPanel: vscode.WebviewPanel
): Promise<string> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            disposable.dispose();
            reject(new Error('Timeout waiting for HTML content from webview'));
        }, 10000);

        const disposable = webviewPanel.webview.onDidReceiveMessage((msg) => {
            if (msg.type === 'exportHtmlResponse') {
                clearTimeout(timeout);
                disposable.dispose();
                resolve(msg.html as string);
            }
        });

        webviewPanel.webview.postMessage({ type: 'requestExportHtml' });
    });
}

/**
 * 根据编辑器 HTML 内容构建完整的独立 HTML 文档字符串。
 * bodyHtml 开头可能包含 webview 注入的多个 <style> 标签（字体/间距/katex），
 * 将其提取后放入 <head>，确保样式优先级高于基础样式表。
 */
function buildFullHtml(bodyHtml: string, title: string): string {
    // 提取 webview 注入的前导 <style>…</style> 块（如 export-font-style、katex 内联样式等），
    // 单独收集后放入 <head> 的基础样式之后。
    let remaining = bodyHtml;
    const injectedStyles: string[] = [];
    const styleTagRe = /^(\s*<style[^>]*>[\s\S]*?<\/style>)/i;
    let m: RegExpExecArray | null;
    while ((m = styleTagRe.exec(remaining)) !== null) {
        injectedStyles.push(m[1]);
        remaining = remaining.slice(m[0].length);
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.35/dist/katex.min.css" integrity="sha384-kxkJHCDsW1FFPAB+rhMRoswPFPm6MBh3w2UhDD/1EWha1LjJSCaGg/3gfqkMOKR" crossorigin="anonymous">
<style>
  /* ── 基础重置与布局 ── */
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    max-width: 900px;
    margin: 0 auto;
    padding: 40px 20px;
    line-height: 1.6;
    color: #333;
  }
  img { max-width: 100%; height: auto; }
  pre { background: #f5f5f5; padding: 16px; border-radius: 6px; overflow-x: hidden; white-space: pre-wrap; word-break: break-all; }
  code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.9em; }
  :not(pre) > code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
  blockquote { margin: 16px 0; padding: 0 16px; border-left: 4px solid #ddd; color: #666; overflow-x: hidden; white-space: pre-wrap; word-break: break-word; }
  body > :first-child { margin-top: 0 !important; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  hr { border: none; border-top: 1px solid #ddd; }
  ul, ol { padding-left: 2em; }
  ul:not([data-type="taskList"]) > li { list-style: none; position: relative; }
  ul:not([data-type="taskList"]) > li::before { content: "•"; font-family: inherit; position: absolute; left: -2em; top: 0; width: 1em; text-align: right; }
  ul:not([data-type="taskList"]) > li > ul:not([data-type="taskList"]) > li::before { content: "○"; }
  ul:not([data-type="taskList"]) > li > ul:not([data-type="taskList"]) > li > ul:not([data-type="taskList"]) > li::before { content: "■"; font-size: 0.6em; top: 0.2em; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0; }
  ul[data-type="taskList"] li[data-checked] { display: flex; flex-direction: row; align-items: flex-start; gap: 8px; margin: 2px 0; }
  ul[data-type="taskList"] li[data-checked] > label { display: inline-flex; align-items: center; flex: 0 0 auto; margin: 0; padding-top: 0.2em; cursor: default; user-select: none; -webkit-user-select: none; }
  ul[data-type="taskList"] li[data-checked] > label > span { display: none; }
  ul[data-type="taskList"] li[data-checked] > div { display: block; flex: 1; min-width: 0; margin: 0; }
  ul[data-type="taskList"] li[data-checked] > div > p { display: inline; margin: 0; }
  ul[data-type="taskList"] li[data-checked="true"] > div,
  ul[data-type="taskList"] li[data-checked="true"] > div > p { text-decoration: line-through; color: #888; }
  a { color: #0366d6; text-decoration: none; }
  a:hover { text-decoration: underline; }
  svg { max-width: 100%; height: auto; }
  .mermaid-diagram { text-align: center; margin: 16px 0; }
  .mermaid-diagram svg { max-width: 100%; height: auto; }
  .katex-display { margin: 1em 0; text-align: center; }
</style>
${injectedStyles.join('\n')}
</head>
<body>
${remaining}
</body>
</html>`;
}


function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 将当前文档导出为 HTML。
 * 保存后提示用户在浏览器中打开（用于 PDF 导出或复制到 Word）。
 */
export async function exportAsHtml(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
): Promise<void> {
    const bodyHtml = await requestHtmlFromWebview(webviewPanel);
    const title = path.basename(document.uri.fsPath, '.md');
    const fullHtml = buildFullHtml(bodyHtml, title);

    const defaultUri = vscode.Uri.file(
        path.join(path.dirname(document.uri.fsPath), `${title}.html`)
    );
    const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'HTML Files': ['html'] },
    });
    if (!saveUri) return;

    fs.writeFileSync(saveUri.fsPath, fullHtml, 'utf8');

    const openInBrowser = i18n.t('openInBrowser');
    const action = await vscode.window.showInformationMessage(
        i18n.t('exportHtmlSuccess', { path: saveUri.fsPath }),
        openInBrowser
    );
    if (action === openInBrowser) {
        vscode.env.openExternal(saveUri);
    }
}
