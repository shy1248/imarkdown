/**
 * 导出 HTML 的纯工具函数（不依赖 VS Code API，便于单元测试）。
 */
import * as path from 'path';
import { escapeHtml } from './textUtils';

const STYLE_TAG_RE = /^(\s*<style[^>]*>[\s\S]*?<\/style>)/i;

/** 提取 bodyHtml 开头连续注入的 <style> 标签。 */
export function extractInjectedStyles(bodyHtml: string): { injectedStyles: string[]; remaining: string } {
    let remaining = bodyHtml;
    const injectedStyles: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = STYLE_TAG_RE.exec(remaining)) !== null) {
        injectedStyles.push(match[1]);
        remaining = remaining.slice(match[0].length);
    }
    return { injectedStyles, remaining };
}

/** 由文档路径推导导出 HTML 的标题（去掉任意扩展名，如 .md / .markdown）。 */
export function getHtmlExportTitle(filePath: string): string {
    return path.basename(filePath, path.extname(filePath));
}

/**
 * 根据编辑器 HTML 内容构建完整的独立 HTML 文档字符串。
 * bodyHtml 开头可能包含 webview 注入的多个 <style> 标签（字体/间距/katex），
 * 将其提取后放入 <head>，确保样式优先级高于基础样式表。
 */
export function buildFullHtml(bodyHtml: string, title: string): string {
    const { injectedStyles, remaining } = extractInjectedStyles(bodyHtml);

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
