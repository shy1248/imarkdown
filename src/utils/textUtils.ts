/**
 * 纯文本工具函数：不依赖 VS Code API，便于单元测试。
 */

/** 将所有行尾符统一替换为 LF（\n）。 */
export function normalizeEol(text: string): string {
    return text.replace(/(?:\r\n|\r|\n)/g, '\n');
}

/** 将文本行尾符转换为文档使用的 EOL（2 = CRLF，其它 = LF）。 */
export function toDocumentEol(text: string, eol: number): string {
    return text.replace(/(?:\r\n|\r|\n)/g, eol === 2 ? '\r\n' : '\n');
}

/** 转义 HTML 特殊字符。 */
export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
