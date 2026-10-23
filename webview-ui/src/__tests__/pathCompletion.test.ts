/**
 * 路径补全纯逻辑的测试 — 直接测试真实实现。
 */
import { describe, it, expect } from 'vitest';
import { extractMarkdownLinkPrefix } from '../editor/markdown/pathCompletion';
import { looksLikeLocalPath, routeDomPathCompletionResult } from '../editor/shared/domPathCompletion';

describe('extractMarkdownLinkPrefix', () => {
    it('应识别 URL 为空的链接', () => {
        const text = '[text](';
        expect(extractMarkdownLinkPrefix(text, text.length)).toEqual({ prefix: '', prefixStart: 7 });
    });

    it('应识别含部分路径的链接', () => {
        const text = '[text](./images/';
        expect(extractMarkdownLinkPrefix(text, text.length)).toEqual({ prefix: './images/', prefixStart: 7 });
    });

    it('应识别图片链接', () => {
        const text = '![alt](./';
        expect(extractMarkdownLinkPrefix(text, text.length)).toEqual({ prefix: './', prefixStart: 7 });
    });

    it('http/https 与非本地协议应返回 null', () => {
        for (const text of [
            '[text](https://example.com',
            '[text](HTTP://example.com',
            '[text](mailto:user@example',
            '[text](#heading',
        ]) {
            expect(extractMarkdownLinkPrefix(text, text.length), text).toBeNull();
        }
    });

    it('括号前无 "]" 时应返回 null', () => {
        const text = 'some text (cursor here';
        expect(extractMarkdownLinkPrefix(text, text.length)).toBeNull();
    });

    it('方括号不匹配时应返回 null', () => {
        const text = '](path';
        expect(extractMarkdownLinkPrefix(text, text.length)).toBeNull();
    });

    it('无开括号时应返回 null', () => {
        expect(extractMarkdownLinkPrefix('just plain text', 15)).toBeNull();
    });

    it('应处理波浪号 home 路径', () => {
        const text = '[doc](~/Documents/';
        expect(extractMarkdownLinkPrefix(text, text.length)).toEqual({ prefix: '~/Documents/', prefixStart: 6 });
    });

    it('应处理链接前已闭合的括号', () => {
        const text = '(note) [link](./';
        expect(extractMarkdownLinkPrefix(text, text.length)).toEqual({ prefix: './', prefixStart: 14 });
    });

    it('光标位于 URL 中间时应只取到光标处', () => {
        const text = '[text](./images/photo.png)';
        expect(extractMarkdownLinkPrefix(text, 16)).toEqual({ prefix: './images/', prefixStart: 7 });
    });

    it('应处理链接前同行有其他文本的情况', () => {
        const text = 'See [this file](./doc';
        expect(extractMarkdownLinkPrefix(text, text.length)).toEqual({ prefix: './doc', prefixStart: 16 });
    });

    it('光标为 0 时应返回 null', () => {
        expect(extractMarkdownLinkPrefix('[text](./', 0)).toBeNull();
    });

    it('Windows 盘符路径应被识别为本地路径前缀', () => {
        const text = '[doc](C:\\docs\\';
        expect(extractMarkdownLinkPrefix(text, text.length)).toEqual({
            prefix: 'C:\\docs\\',
            prefixStart: 6,
        });
    });
});

describe('looksLikeLocalPath', () => {
    it('应识别常见本地路径', () => {
        for (const value of ['./a.png', '../b.md', 'images/c.png', '~/d.md', '/abs/e.md', 'C:\\docs\\f.md', 'file name.md']) {
            expect(looksLikeLocalPath(value), value).toBe(true);
        }
    });

    it('网络协议/锚点/data 应返回 false', () => {
        for (const value of [
            'https://example.com/a.png',
            'HTTP://example.com',
            'mailto:a@b.com',
            'data:image/png;base64,xx',
            '#heading',
            '//cdn.example.com/a.png',
            'ftp://example.com/a',
            'vscode-resource://x',
        ]) {
            expect(looksLikeLocalPath(value), value).toBe(false);
        }
    });

    it('空值应返回 false', () => {
        expect(looksLikeLocalPath('')).toBe(false);
    });
});

describe('routeDomPathCompletionResult', () => {
    it('无活跃 PathCompleter 时应返回 false', () => {
        expect(routeDomPathCompletionResult('unknown-request', [])).toBe(false);
    });
});