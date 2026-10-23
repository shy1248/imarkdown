/**
 * Tab / Shift+Tab 行为的测试（src/editor/indentOutdent.ts）。
 * 覆盖：代码块内插入/删除缩进、列表缩进、普通段落不拦截。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CustomCodeBlock } from '../editor/code/codeBlock';
import { IndentOutdent } from '../editor/indentOutdent';

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
    editor = new Editor({
        extensions: [StarterKit.configure({ codeBlock: false }), CustomCodeBlock, IndentOutdent],
        content,
    });
    return editor;
}

function tabHandler(): (shift: boolean) => boolean {
    return (window as any).__imarkdownTabHandler;
}

/** tiptap 的 create 事件在 setTimeout(0) 后触发，需等待一拍 */
const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
    editor?.destroy();
    editor = null;
});

describe('Tab 键处理', () => {
    it('代码块内 Tab 应插入两个空格', async () => {
        makeEditor('<pre><code>line</code></pre>');
        await nextTick();
        editor!.commands.setTextSelection(2);
        expect(tabHandler()(false)).toBe(true);
        expect(editor!.state.doc.child(0).textContent).toBe('l  ine');
    });

    it('代码块内 Shift+Tab 应删除行首最多两个空格', async () => {
        makeEditor('<pre><code>  code</code></pre>');
        await nextTick();
        // 光标位于两个缩进空格之后（代码块内容起始位置为 1）
        editor!.commands.setTextSelection(3);
        expect(tabHandler()(true)).toBe(true);
        expect(editor!.state.doc.child(0).textContent).toBe('code');
    });

    it('列表项中 Tab 应返回 true（执行缩进）', async () => {
        makeEditor('<ul><li><p>item</p></li></ul>');
        await nextTick();
        let itemPos = -1;
        editor!.state.doc.descendants((node, pos) => {
            if (node.type.name === 'paragraph') itemPos = pos;
        });
        editor!.commands.setTextSelection(itemPos + 2);
        expect(tabHandler()(false)).toBe(true);
    });

    it('普通段落中 Tab 应返回 false（不处理）', async () => {
        makeEditor('<p>plain</p>');
        await nextTick();
        editor!.commands.setTextSelection(3);
        expect(tabHandler()(false)).toBe(false);
    });

    it('编辑器销毁后应清除全局回调', async () => {
        const ed = makeEditor('<p>plain</p>');
        await nextTick();
        ed.destroy();
        editor = null;
        expect((window as any).__imarkdownTabHandler).toBeUndefined();
    });
});