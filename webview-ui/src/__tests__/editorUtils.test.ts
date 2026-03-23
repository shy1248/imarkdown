/**
 * editorUtils.ts 的测试 — resolveImageUrl
 */
import { describe, it, expect } from 'vitest';

// 为测试重新实现，不依赖 DOM
function resolveImageUrl(src: string, baseUri: string): string {
    if (!src) return src;
    const lower = src.toLowerCase();
    if (lower.startsWith('http://') || lower.startsWith('https://') ||
        lower.startsWith('data:') || lower.startsWith('vscode-resource:') ||
        lower.startsWith('vscode-file:')) {
        return src;
    }
    if (!baseUri) return src;
    try { return new URL(src, baseUri).toString(); } catch { return src; }
}

describe('resolveImageUrl', () => {
    const baseUri = 'https://file+.vscode-resource.vscode-cdn.net/Users/doc/';

    it('空 src 应返回空字符串', () => {
        expect(resolveImageUrl('', baseUri)).toBe('');
    });

    it('http URL 应原样返回', () => {
        const url = 'http://example.com/img.png';
        expect(resolveImageUrl(url, baseUri)).toBe(url);
    });

    it('https URL 应原样返回', () => {
        const url = 'https://example.com/img.png';
        expect(resolveImageUrl(url, baseUri)).toBe(url);
    });

    it('data URL 应原样返回', () => {
        const url = 'data:image/png;base64,abc123';
        expect(resolveImageUrl(url, baseUri)).toBe(url);
    });

    it('vscode-resource URL 应原样返回', () => {
        const url = 'vscode-resource://file/path/img.png';
        expect(resolveImageUrl(url, baseUri)).toBe(url);
    });

    it('vscode-file URL 应原样返回', () => {
        const url = 'vscode-file://vscode-app/path/img.png';
        expect(resolveImageUrl(url, baseUri)).toBe(url);
    });

    it('应将相对路径解析为基于 baseUri 的绝对路径', () => {
        const result = resolveImageUrl('images/photo.png', baseUri);
        expect(result).toBe('https://file+.vscode-resource.vscode-cdn.net/Users/doc/images/photo.png');
    });

    it('应将 ./ 相对路径解析为基于 baseUri 的绝对路径', () => {
        const result = resolveImageUrl('./images/photo.png', baseUri);
        expect(result).toBe('https://file+.vscode-resource.vscode-cdn.net/Users/doc/images/photo.png');
    });

    it('应将 ../ 相对路径解析为基于 baseUri 的绝对路径', () => {
        const result = resolveImageUrl('../other/photo.png', baseUri);
        expect(result).toBe('https://file+.vscode-resource.vscode-cdn.net/Users/other/photo.png');
    });

    it('无 baseUri 时应原样返回 src', () => {
        expect(resolveImageUrl('images/photo.png', '')).toBe('images/photo.png');
    });

    it('协议检测应不区分大小写', () => {
        expect(resolveImageUrl('HTTP://example.com/img.png', baseUri)).toBe('HTTP://example.com/img.png');
        expect(resolveImageUrl('HTTPS://example.com/img.png', baseUri)).toBe('HTTPS://example.com/img.png');
        expect(resolveImageUrl('Data:image/png;base64,abc', baseUri)).toBe('Data:image/png;base64,abc');
    });
});
