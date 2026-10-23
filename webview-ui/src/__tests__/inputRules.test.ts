/**
 * Markdown 自动转换规则的测试（src/editor/markdown/inputRules.ts）。
 * 覆盖：图片语法、链接语法、行内代码/代码块中不转换、普通文本不误转。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { MarkdownImageInputRule, MarkdownLinkInputRule } from '../editor/markdown/inputRules';

let editor: Editor | null = null;

function makeEditor(content = '<p></p>'): Editor {
    editor = new Editor({
        extensions: [StarterKit, Image, MarkdownImageInputRule, MarkdownLinkInputRule],
        content,
    });
    return editor;
}

function insertText(text: string, marks?: { type: string }[]): void {
    editor!.commands.insertContent({ type: 'text', text, ...(marks ? { marks } : {}) } as any);
}

function collect(node: any, type: string, out: any[] = []): any[] {
    if (node.type === type) out.push(node);
    (node.content ?? []).forEach((child: any) => collect(child, type, out));
    return out;
}

afterEach(() => {
    editor?.destroy();
    editor = null;
});

describe('MarkdownImageInputRule', () => {
    it('应将 ![alt](src) 转为图片节点', () => {
        makeEditor();
        insertText('![alt](img.png)');
        const images = collect(editor!.getJSON(), 'image');
        expect(images).toHaveLength(1);
        expect(images[0].attrs.src).toBe('img.png');
        expect(images[0].attrs.alt).toBe('alt');
    });

    it('应支持带标题的图片语法', () => {
        makeEditor();
        insertText('![a](b.png "caption")');
        const images = collect(editor!.getJSON(), 'image');
        expect(images).toHaveLength(1);
        expect(images[0].attrs.title).toBe('caption');
    });

    it('行内代码中的图片语法不应转换（回归用例）', () => {
        makeEditor();
        insertText('![a](b.png)', [{ type: 'code' }]);
        expect(collect(editor!.getJSON(), 'image')).toHaveLength(0);
    });

    it('代码块中的图片语法不应转换', () => {
        makeEditor('<pre><code>![a](b.png)</code></pre>');
        // 触发一次文档变更（内容本身已是代码块）
        insertText('x');
        expect(collect(editor!.getJSON(), 'image')).toHaveLength(0);
    });
});

describe('MarkdownLinkInputRule', () => {
    it('应将 [text](url) 转为带链接标记的文本', () => {
        makeEditor();
        insertText('[docs](https://example.com)');
        const json = JSON.stringify(editor!.getJSON());
        expect(json).toContain('"type":"link"');
        expect(json).toContain('https://example.com');
        expect(json).toContain('docs');
    });

    it('行内代码中的链接语法不应转换（回归用例）', () => {
        makeEditor();
        insertText('[a](b)', [{ type: 'code' }]);
        expect(JSON.stringify(editor!.getJSON())).not.toContain('"type":"link"');
    });

    it('代码块中的链接语法不应转换', () => {
        makeEditor('<pre><code>[a](b)</code></pre>');
        insertText('x');
        expect(JSON.stringify(editor!.getJSON())).not.toContain('"type":"link"');
    });
});