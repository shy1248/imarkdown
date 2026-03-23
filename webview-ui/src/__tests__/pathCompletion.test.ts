/**
 * pathCompletion.ts 的测试 — extractMarkdownLinkPrefix
 */
import { describe, it, expect } from 'vitest';

// 为测试重新实现纯函数
function extractMarkdownLinkPrefix(
    nodeText: string,
    cursorOffset: number,
): { prefix: string; prefixStart: number } | null {
    const textToCursor = nodeText.slice(0, cursorOffset);

    let depth = 0;
    let parenIdx = -1;
    for (let i = textToCursor.length - 1; i >= 0; i--) {
        const ch = textToCursor[i];
        if (ch === ')') { depth++; }
        else if (ch === '(') {
            if (depth > 0) { depth--; }
            else { parenIdx = i; break; }
        }
    }
    if (parenIdx === -1) return null;

    if (parenIdx === 0 || textToCursor[parenIdx - 1] !== ']') return null;

    const closeBracket = parenIdx - 1;
    let bracketDepth = 0;
    let openBracket = -1;
    for (let i = closeBracket; i >= 0; i--) {
        const ch = textToCursor[i];
        if (ch === ']') { bracketDepth++; }
        else if (ch === '[') {
            bracketDepth--;
            if (bracketDepth === 0) { openBracket = i; break; }
        }
    }
    if (openBracket === -1) return null;

    const prefix = textToCursor.slice(parenIdx + 1);

    if (/^https?:\/\//i.test(prefix)) return null;
    if (prefix.startsWith('#')) return null;
    if (/^[a-z][a-z0-9+\-.]*:/i.test(prefix)) return null;

    return { prefix, prefixStart: parenIdx + 1 };
}

describe('extractMarkdownLinkPrefix', () => {
    it('应识别 URL 为空的链接', () => {
        // [text](|
        const text = '[text](';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toEqual({ prefix: '', prefixStart: 7 });
    });

    it('应识别含部分路径的链接', () => {
        // [text](./images/|
        const text = '[text](./images/';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toEqual({ prefix: './images/', prefixStart: 7 });
    });

    it('应识别图片链接', () => {
        // ![alt](./|
        const text = '![alt](./';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toEqual({ prefix: './', prefixStart: 7 });
    });

    it('http URL 应返回 null', () => {
        const text = '[text](https://example.com';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toBeNull();
    });

    it('大写 HTTP URL 应返回 null（不区分大小写）', () => {
        const text = '[text](HTTP://example.com';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toBeNull();
    });

    it('锚点链接应返回 null', () => {
        const text = '[text](#heading';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toBeNull();
    });

    it('其他协议应返回 null', () => {
        const text = '[text](mailto:user@example';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toBeNull();
    });

    it('括号前无 "]" 时应返回 null', () => {
        const text = 'some text (cursor here';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toBeNull();
    });

    it('方括号不匹配时应返回 null', () => {
        const text = '](path';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toBeNull();
    });

    it('无开括号时应返回 null', () => {
        const text = 'just plain text';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toBeNull();
    });

    it('应处理波浪号 home 路径', () => {
        const text = '[doc](~/Documents/';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toEqual({ prefix: '~/Documents/', prefixStart: 6 });
    });

    it('应处理嵌套括号（已闭合）', () => {
        // 链接前有已闭合括号：(note) [link](./
        const text = '(note) [link](./';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toEqual({ prefix: './', prefixStart: 14 });
    });

    it('应处理光标在部分偏移处的情况', () => {
        const text = '[text](./images/photo.png)';
        // 光标在偏移 16 处，即 "./images/" 之后
        const result = extractMarkdownLinkPrefix(text, 16);
        expect(result).toEqual({ prefix: './images/', prefixStart: 7 });
    });

    it('应处理链接前同行有其他文本的情况', () => {
        const text = 'See [this file](./doc';
        const result = extractMarkdownLinkPrefix(text, text.length);
        expect(result).toEqual({ prefix: './doc', prefixStart: 16 });
    });
});
