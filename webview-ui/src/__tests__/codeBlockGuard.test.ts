/**
 * 代码块边界守卫的测试（src/editor/code/codeBlock.ts）。
 * 当块级节点意外进入代码块时，应被提取为代码块之后的段落。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CustomCodeBlock } from '../editor/code/codeBlock';

let editor: Editor | null = null;

function makeEditor(): Editor {
    editor = new Editor({
        extensions: [StarterKit.configure({ codeBlock: false }), CustomCodeBlock],
        content: '<pre><code>line</code></pre>',
    });
    return editor;
}

afterEach(() => {
    editor?.destroy();
    editor = null;
});

describe('codeBlockBoundaryGuard', () => {
    it('块级节点被插入代码块后应移至代码块之后的段落', () => {
        makeEditor();
        const paragraph = editor!.schema.nodes.paragraph.create(null, editor!.schema.text('intruder'));
        // 位置 1 = 代码块内容起始处
        editor!.view.dispatch(editor!.state.tr.insert(1, paragraph));

        const { doc } = editor!.state;
        const block = doc.child(0);
        expect(block.type.name).toBe('codeBlock');
        let hasBlockChild = false;
        block.forEach((child) => { if (!child.isInline) hasBlockChild = true; });
        expect(hasBlockChild).toBe(false);

        const texts: string[] = [];
        doc.forEach((node) => { if (node.type.name === 'paragraph') texts.push(node.textContent); });
        expect(texts).toContain('intruder');
    });

    it('合法代码块内容不应被修改', () => {
        makeEditor();
        editor!.view.dispatch(editor!.state.tr.insertText('X', 1));
        const block = editor!.state.doc.child(0);
        expect(block.type.name).toBe('codeBlock');
        expect(block.textContent).toContain('X');
        // 代码块内部不应出现块级节点
        block.forEach((child) => expect(child.isInline || child.isText).toBe(true));
    });
});