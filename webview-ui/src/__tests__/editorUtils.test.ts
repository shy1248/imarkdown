/**
 * editorUtils.ts 的测试 — 直接测试真实实现。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveImageUrl, getEditorMarkdown } from '../editor/editorUtils';

const baseUri = 'https://file+.vscode-resource.vscode-cdn.net/Users/doc/';

describe('resolveImageUrl', () => {
    beforeEach(() => {
        (window as any).__imarkdownBaseUri = baseUri;
    });

    afterEach(() => {
        delete (window as any).__imarkdownBaseUri;
    });

    it('空 src 应返回空字符串', () => {
        expect(resolveImageUrl('')).toBe('');
    });

    it('绝对协议 URL 应原样返回', () => {
        for (const url of [
            'http://example.com/img.png',
            'https://example.com/img.png',
            'data:image/png;base64,abc123',
            'vscode-resource://file/path/img.png',
            'vscode-file://vscode-app/path/img.png',
        ]) {
            expect(resolveImageUrl(url)).toBe(url);
        }
    });

    it('协议检测应不区分大小写', () => {
        for (const url of [
            'HTTP://example.com/img.png',
            'HTTPS://example.com/img.png',
            'Data:image/png;base64,abc',
        ]) {
            expect(resolveImageUrl(url)).toBe(url);
        }
    });

    it('应将相对路径解析为基于 baseUri 的绝对路径', () => {
        expect(resolveImageUrl('images/photo.png'))
            .toBe(`${baseUri}images/photo.png`);
    });

    it('应将 ./ 与 ../ 相对路径正确解析', () => {
        expect(resolveImageUrl('./images/photo.png'))
            .toBe(`${baseUri}images/photo.png`);
        expect(resolveImageUrl('../other/photo.png'))
            .toBe('https://file+.vscode-resource.vscode-cdn.net/Users/other/photo.png');
    });

    it('无 baseUri 时应原样返回 src', () => {
        (window as any).__imarkdownBaseUri = '';
        expect(resolveImageUrl('images/photo.png')).toBe('images/photo.png');
    });

    it('baseUri 非法时不应抛错', () => {
        (window as any).__imarkdownBaseUri = 'not a valid uri';
        expect(() => resolveImageUrl('images/photo.png')).not.toThrow();
    });
});

describe('getEditorMarkdown', () => {
    it('应优先使用 markdown 序列化结果', () => {
        const editor: any = {
            storage: { markdown: { getMarkdown: () => '# hi' } },
            getText: () => 'fallback',
        };
        expect(getEditorMarkdown(editor)).toBe('# hi');
    });

    it('缺少 markdown 存储时应回退到纯文本', () => {
        const editor: any = { storage: {}, getText: () => 'plain text' };
        expect(getEditorMarkdown(editor)).toBe('plain text');
    });

    it('storage 为空时应回退到纯文本', () => {
        const editor: any = { getText: () => 'plain text' };
        expect(getEditorMarkdown(editor)).toBe('plain text');
    });
});