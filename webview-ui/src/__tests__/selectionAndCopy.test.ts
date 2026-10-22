/**
 * 全选行为与“复制为 Markdown”选区序列化的回归测试。
 *
 * 覆盖：
 *   • Ctrl/Cmd+A 产生的选区与手动从文档头部选到尾部一致（TextSelection）；
 *   • 全选后按 Backspace / Delete 可清空整个文档；
 *   • 选中整张表格节点时复制完整表格，选中部分单元格时只复制这些单元格；
 *   • 表格 Markdown 序列化保留表格语法（含 <br/> 换行、合并单元格等）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.hoisted(() => {
    // editorUtils 间接依赖 vscode.ts，需要先提供 webview API 桩
    (window as any).__postedMessages = [];
    (window as any).acquireVsCodeApi = () => ({
        postMessage: (msg: any) => { (window as any).__postedMessages.push(msg); },
        getState: () => undefined,
        setState: () => { },
    });
});

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { TableRow } from '@tiptap/extension-table-row';
import { AllSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { Table, TableHeader, TableCell, TableDeleteOnBackspace, TableCellHardBreak } from '../editor/table/tableExtensions';
import { TableControls } from '../editor/table/tableControls';
import { applyColumnAlignment } from '../editor/table/tableContextMenu';
import { IndentOutdent } from '../editor/indentOutdent';
import { SelectAllDocument, createDocumentTextSelection } from '../editor/selectAll';
import { serializeSelectionAsMarkdown, insertMarkdownText } from '../editor/editorUtils';
import { MarkdownCopy, MarkdownPaste } from '../editor/editorExtensions';
const TABLE_MD = '| a | b |\n| --- | --- |\n| 1 | 2 |';

function makeEditor(markdown: string): Editor {
    return new Editor({
        extensions: [
            StarterKit,
            Table.configure({ resizable: true }),
            TableRow,
            TableHeader,
            TableCell,
            TableControls,
            TableDeleteOnBackspace,
            TableCellHardBreak,
            MarkdownCopy,
            MarkdownPaste,
            IndentOutdent,
            SelectAllDocument,
            Markdown.configure({ transformCopiedText: false }),
        ],
        content: markdown,
    });
}

function findTablePos(editor: Editor): number {
    let tablePos = -1;
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'table') tablePos = pos;
    });
    return tablePos;
}

describe('全选快捷键', () => {
    let editor: Editor | null = null;

    afterEach(() => {
        editor?.destroy();
        editor = null;
    });

    it('Ctrl+A 创建与手动全选一致的文本选区', () => {
        editor = makeEditor('第一段\n\n' + TABLE_MD + '\n\n最后一段');
        const { doc } = editor.state;
        const from = Selection.atStart(doc).from;
        const to = Selection.atEnd(doc).to;

        editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'a', ctrlKey: true, bubbles: true, cancelable: true,
        }));

        expect(editor.state.selection).toBeInstanceOf(TextSelection);
        expect(editor.state.selection.from).toBe(from);
        expect(editor.state.selection.to).toBe(to);
    });

    it('Ctrl+A 后按 Backspace 清空整个文档', () => {
        editor = makeEditor('第一段\n\n' + TABLE_MD + '\n\n最后一段');
        const dom = editor.view.dom;

        dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'a', ctrlKey: true, bubbles: true, cancelable: true,
        }));
        dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Backspace', bubbles: true, cancelable: true,
        }));

        expect(editor.state.doc.textContent).toBe('');
        expect(editor.state.doc.childCount).toBe(1);
        expect((editor.storage as any).markdown.getMarkdown().trim()).toBe('');
    });

    it('Ctrl+A 后按 Delete 清空整个文档', () => {
        editor = makeEditor('第一段\n\n' + TABLE_MD + '\n\n最后一段');
        const dom = editor.view.dom;

        dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'a', ctrlKey: true, bubbles: true, cancelable: true,
        }));
        dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Delete', bubbles: true, cancelable: true,
        }));

        expect(editor.state.doc.textContent).toBe('');
        expect(editor.state.doc.childCount).toBe(1);
    });

    it('ProseMirror 产生的 AllSelection 会被归一化为文本选区', () => {
        editor = makeEditor('第一段\n\n最后一段');
        const { doc } = editor.state;

        editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(doc)));

        expect(editor.state.selection).toBeInstanceOf(TextSelection);
        expect(editor.state.selection.from).toBe(Selection.atStart(doc).from);
        expect(editor.state.selection.to).toBe(Selection.atEnd(doc).to);
    });

    it('空文档不会创建无效选区', () => {
        const empty = makeEditor('');
        expect(createDocumentTextSelection(empty.state.doc)).toBeNull();
        empty.destroy();
    });
});

describe('复制为 Markdown 的表格选区', () => {
    let editor: Editor | null = null;

    // 3x3 表格，方便验证“只复制选中单元格”
    const GRID_MD = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |';

    afterEach(() => {
        editor?.destroy();
        editor = null;
    });

    function cellPosOf(row: number, col: number): number {
        const tablePos = findTablePos(editor!);
        const table = editor!.state.doc.nodeAt(tablePos)!;
        const map = TableMap.get(table);
        return tablePos + 1 + map.map[row * map.width + col];
    }

    function selectCells(anchor: [number, number], head: [number, number]): void {
        editor!.commands.setCellSelection({
            anchorCell: cellPosOf(anchor[0], anchor[1]),
            headCell: cellPosOf(head[0], head[1]),
        });
    }

    it('选中整张表格节点时复制完整表格', () => {
        editor = makeEditor('前面\n\n' + GRID_MD + '\n\n后面');
        editor.commands.setNodeSelection(findTablePos(editor));

        expect(serializeSelectionAsMarkdown(editor)).toBe(GRID_MD);
    });

    it('只选中单个单元格时只复制该单元格', () => {
        editor = makeEditor(GRID_MD);
        selectCells([1, 1], [1, 1]);

        expect(serializeSelectionAsMarkdown(editor)).toBe('| 2 |\n| --- |');
    });

    it('选中 2x2 单元格区域时只复制这些单元格', () => {
        editor = makeEditor(GRID_MD);
        selectCells([1, 1], [2, 2]);

        expect(serializeSelectionAsMarkdown(editor))
            .toBe('| 2 | 3 |\n| --- | --- |\n| 5 | 6 |');
    });

    it('选中整列时只复制该列', () => {
        editor = makeEditor(GRID_MD);
        selectCells([0, 1], [2, 1]);

        expect(serializeSelectionAsMarkdown(editor))
            .toBe('| b |\n| --- |\n| 2 |\n| 5 |');
    });

    it('选中全部单元格时等于整张表格', () => {
        editor = makeEditor(GRID_MD);
        selectCells([0, 0], [2, 2]);

        expect(serializeSelectionAsMarkdown(editor)).toBe(GRID_MD);
    });

    it('表格之外的选区保持原有内容', () => {
        editor = makeEditor('前面\n\n' + GRID_MD + '\n\n后面');
        editor.commands.setTextSelection({ from: 1, to: 3 });

        expect(serializeSelectionAsMarkdown(editor)).toBe('前面');
    });
});

describe('表格 Markdown 序列化', () => {
    let editor: Editor | null = null;

    afterEach(() => {
        editor?.destroy();
        editor = null;
    });

    function makeEditorFromJSON(content: unknown): Editor {
        return new Editor({
            extensions: [
                StarterKit,
                Table.configure({ resizable: true }),
                TableRow,
                TableHeader,
                TableCell,
                Markdown.configure({ transformCopiedText: false }),
            ],
            content: content as any,
        });
    }

    function tableMarkdown(ed: Editor): string {
        // 与编辑器保存路径一致：更新文档时使用 storage.markdown.getMarkdown()
        return (ed.storage as any).markdown.getMarkdown().trim();
    }

    it('单段落单元格保持原有表格语法', () => {
        editor = makeEditor(TABLE_MD);
        expect(tableMarkdown(editor)).toBe(TABLE_MD);
    });

    it('单元格含多个段落时仍输出完整表格', () => {
        editor = makeEditorFromJSON({
            type: 'doc',
            content: [{
                type: 'table',
                content: [
                    {
                        type: 'tableRow',
                        content: [
                            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
                            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
                        ],
                    },
                    {
                        type: 'tableRow',
                        content: [
                            {
                                type: 'tableCell',
                                content: [
                                    { type: 'paragraph', content: [{ type: 'text', text: '1' }] },
                                    { type: 'paragraph', content: [{ type: 'text', text: '1b' }] },
                                ],
                            },
                            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
                        ],
                    },
                ],
            }],
        });

        expect(tableMarkdown(editor)).toBe('| a | b |\n| --- | --- |\n| 1<br/>1b | 2 |');
    });

    it('首行不是表头时仍输出完整表格', () => {
        editor = makeEditorFromJSON({
            type: 'doc',
            content: [{
                type: 'table',
                content: [
                    {
                        type: 'tableRow',
                        content: [
                            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
                            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
                        ],
                    },
                    {
                        type: 'tableRow',
                        content: [
                            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
                            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
                        ],
                    },
                ],
            }],
        });

        expect(tableMarkdown(editor)).toBe(TABLE_MD);
    });

    it('含合并单元格的表格输出合法网格', () => {
        editor = makeEditorFromJSON({
            type: 'doc',
            content: [{
                type: 'table',
                content: [
                    {
                        type: 'tableRow',
                        content: [
                            {
                                type: 'tableHeader',
                                attrs: { colspan: 2, rowspan: 1 },
                                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'merged' }] }],
                            },
                            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }] },
                        ],
                    },
                    {
                        type: 'tableRow',
                        content: [
                            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
                            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
                            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '3' }] }] },
                        ],
                    },
                ],
            }],
        });

        expect(tableMarkdown(editor)).toBe(
            '| merged |  | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |'
        );
    });

    it('保留对齐与行内标记', () => {
        editor = makeEditor('| a | b | c |\n| :--- | :---: | ---: |\n| **x** | y | z |');
        expect(tableMarkdown(editor)).toBe(
            '| a | b | c |\n| :--- | :---: | ---: |\n| **x** | y | z |'
        );
    });

    it('列对齐操作会应用到整列', () => {
        editor = makeEditor(TABLE_MD);
        const tablePos = findTablePos(editor);
        applyColumnAlignment(editor.view, tablePos, 1, 'right');
        expect(tableMarkdown(editor)).toBe(
            '| a | b |\n| --- | ---: |\n| 1 | 2 |'
        );
    });

    it('引用块中的表格不会混入块级前缀', () => {
        editor = makeEditor('> | a | b |\n> | --- | --- |\n> | 1 | 2 |');
        expect(tableMarkdown(editor)).toBe(
            '> | a | b |\n> | --- | --- |\n> | 1 | 2 |'
        );
    });

    it('单元格内按 Enter 插入 <br/> 而不是新段落', () => {
        editor = makeEditor(TABLE_MD);
        const doc = editor.state.doc;
        const tablePos = findTablePos(editor);
        const table = doc.nodeAt(tablePos)!;
        const map = TableMap.get(table);
        const firstBodyCell = tablePos + 1 + map.map[map.width];

        // 光标置于第一个数据单元格文本末尾："1|"
        editor.commands.setTextSelection(firstBodyCell + 3);
        editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', bubbles: true, cancelable: true,
        }));

        const cell = editor.state.doc.nodeAt(firstBodyCell)!;
        expect(cell.childCount).toBe(1);
        expect(JSON.stringify(cell.toJSON())).toContain('"hardBreak"');
        expect(tableMarkdown(editor)).toBe('| a | b |\n| --- | --- |\n| 1<br/> | 2 |');
    });

    it('<br/> 单元格内容可稳定往返', () => {
        editor = makeEditor('| a | b |\n| --- | --- |\n| x<br/>y | 2 |');
        expect(tableMarkdown(editor)).toBe('| a | b |\n| --- | --- |\n| x<br/>y | 2 |');
    });
});

describe('表格手柄单击选中整行/整列', () => {
    let editor: Editor | null = null;

    afterEach(() => {
        editor?.destroy();
        editor = null;
    });

    /** 模拟把鼠标悬停在单元格上并按下手柄。 */
    function pressHandle(ed: Editor, row: number, col: number, kind: 'row' | 'col'): HTMLElement {
        // 编辑器的首次 update 早于表格 node view 的 DOM 创建，
        // 这里触发一次更新，让控件监听器挂载到 tableWrapper 上。
        ed.view.dispatch(ed.state.tr.setMeta('syncTableControls', true));

        const wrapper = ed.view.dom.querySelector('.tableWrapper') as HTMLElement;
        const tableEl = wrapper.querySelector('table') as HTMLTableElement;
        const rows = tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr');
        const cells = rows[row].querySelectorAll(':scope > th, :scope > td');
        cells[col].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));

        const handle = wrapper.querySelector(
            kind === 'row' ? '.table-row-handle' : '.table-col-handle',
        ) as HTMLElement | null;
        expect(handle).not.toBeNull();

        handle!.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true, cancelable: true, button: 0,
        }));
        document.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true, cancelable: true, button: 0,
        }));
        return handle!;
    }

    it('单击列手柄立即选中整列', () => {
        editor = makeEditor(TABLE_MD);
        pressHandle(editor, 1, 1, 'col');

        const sel = editor.state.selection;
        expect(sel).toBeInstanceOf(CellSelection);
        const cellSel = sel as CellSelection;
        expect(cellSel.isColSelection()).toBe(true);

        let count = 0;
        cellSel.forEachCell(() => { count++; });
        expect(count).toBe(2); // 2 行（表头 + 1 个数据行）
    });

    it('单击行手柄立即选中整行', () => {
        editor = makeEditor(TABLE_MD);
        pressHandle(editor, 1, 0, 'row');

        const sel = editor.state.selection;
        expect(sel).toBeInstanceOf(CellSelection);
        const cellSel = sel as CellSelection;
        expect(cellSel.isRowSelection()).toBe(true);

        let count = 0;
        cellSel.forEachCell(() => { count++; });
        expect(count).toBe(2); // 2 列
    });

    it('浏览器回读为头单元格文本选区时恢复整列选区', () => {
        editor = makeEditor(TABLE_MD);
        pressHandle(editor, 1, 1, 'col');
        expect(editor.state.selection).toBeInstanceOf(CellSelection);

        // 模拟 Chromium 把不可见的单元格选区规范化后回读为文本选区
        const tablePos = findTablePos(editor);
        const table = editor.state.doc.nodeAt(tablePos)!;
        const map = TableMap.get(table);
        const lastCellPos = tablePos + 1 + map.positionAt(map.height - 1, 1, table);
        editor.commands.setTextSelection(lastCellPos + 1);

        const sel = editor.state.selection;
        expect(sel).toBeInstanceOf(CellSelection);
        expect((sel as CellSelection).isColSelection()).toBe(true);
    });
});

describe('表格区域粘贴', () => {
    let editor: Editor | null = null;

    afterEach(() => {
        editor?.destroy();
        editor = null;
    });

    /** 返回文档中所有表格的位置。 */
    function findAllTablePositions(ed: Editor): number[] {
        const positions: number[] = [];
        ed.state.doc.descendants((node, pos) => {
            if (node.type.name === 'table') positions.push(pos);
        });
        return positions;
    }

    function cellPos(ed: Editor, tablePos: number, row: number, col: number): number {
        const table = ed.state.doc.nodeAt(tablePos)!;
        const map = TableMap.get(table);
        return tablePos + 1 + map.map[row * map.width + col];
    }

    function cellText(ed: Editor, tablePos: number, row: number, col: number): string {
        return ed.state.doc.nodeAt(cellPos(ed, tablePos, row, col))!.textContent;
    }

    const GRID_3 = '| h1 | h2 | h3 |\n| --- | --- | --- |\n| a | b | c |\n| d | e | f |';

    it('将复制的多个单元格填充到对应单元格而不是嵌套表格', () => {
        editor = makeEditor(GRID_3 + '\n\n' + '| x1 | x2 | x3 |\n| --- | --- | --- |\n| p | q | r |\n| s | t | u |');
        const tables = findAllTablePositions(editor);
        expect(tables.length).toBe(2);

        // 选中源表格的 2x2 区域（b/c、e/f）
        editor.commands.setCellSelection({
            anchorCell: cellPos(editor, tables[0], 1, 1),
            headCell: cellPos(editor, tables[0], 2, 2),
        });
        const markdown = serializeSelectionAsMarkdown(editor);
        expect(markdown).toContain('| b | c |');

        // 在目标表格的 (1,1) 单元格内粘贴
        editor.commands.setTextSelection(cellPos(editor, tables[1], 1, 1) + 2);
        expect(insertMarkdownText(editor, markdown)).toBe(true);

        expect(cellText(editor, tables[1], 1, 1)).toBe('b');
        expect(cellText(editor, tables[1], 1, 2)).toBe('c');
        expect(cellText(editor, tables[1], 2, 1)).toBe('e');
        expect(cellText(editor, tables[1], 2, 2)).toBe('f');
        // 目标表格外未受影响，且未产生嵌套表格
        expect(cellText(editor, tables[1], 0, 0)).toBe('x1');
        expect(findAllTablePositions(editor).length).toBe(2);
    });

    it('目标表格容纳不下复制的表格时弹出通知且不修改文档', () => {
        editor = makeEditor(GRID_3 + '\n\n' + '| x1 | x2 | x3 |\n| --- | --- | --- |\n| p | q | r |\n| s | t | u |');
        const tables = findAllTablePositions(editor);

        editor.commands.setCellSelection({
            anchorCell: cellPos(editor, tables[0], 1, 1),
            headCell: cellPos(editor, tables[0], 2, 2),
        });
        const markdown = serializeSelectionAsMarkdown(editor);
        const before = (editor.storage as any).markdown.getMarkdown();

        (window as any).__postedMessages.length = 0;
        // 从最后一行的单元格开始粘贴，2 行内容无法容纳
        editor.commands.setTextSelection(cellPos(editor, tables[1], 2, 1) + 2);
        expect(insertMarkdownText(editor, markdown)).toBe(true);

        expect((editor.storage as any).markdown.getMarkdown()).toBe(before);
        const warnings = (window as any).__postedMessages
            .filter((m: any) => m.type === 'showWarning');
        expect(warnings.length).toBe(1);
    });

    it('目标单元格选区形状与复制的表格不一致时弹出通知', () => {
        editor = makeEditor(GRID_3 + '\n\n' + GRID_3);
        const tables = findAllTablePositions(editor);

        editor.commands.setCellSelection({
            anchorCell: cellPos(editor, tables[0], 1, 1),
            headCell: cellPos(editor, tables[0], 2, 2),
        });
        const markdown = serializeSelectionAsMarkdown(editor);
        const before = (editor.storage as any).markdown.getMarkdown();

        (window as any).__postedMessages.length = 0;
        // 目标选区为 2x1，与复制的 2x2 不匹配
        editor.commands.setCellSelection({
            anchorCell: cellPos(editor, tables[1], 1, 1),
            headCell: cellPos(editor, tables[1], 2, 1),
        });
        expect(insertMarkdownText(editor, markdown)).toBe(true);

        expect((editor.storage as any).markdown.getMarkdown()).toBe(before);
        const warnings = (window as any).__postedMessages
            .filter((m: any) => m.type === 'showWarning');
        expect(warnings.length).toBe(1);
    });
});

describe('Ctrl+C / Ctrl+V（Markdown 格式）', () => {
    let editor: Editor | null = null;

    afterEach(() => {
        editor?.destroy();
        editor = null;
    });

    function clipboardEvent(type: 'copy' | 'paste' | 'cut', data: { text?: string } = {}) {
        const event = new Event(type, { bubbles: true, cancelable: true }) as any;
        const store: Record<string, string> = {};
        if (data.text !== undefined) store['text/plain'] = data.text;
        event.clipboardData = {
            setData: (t: string, v: string) => { store[t] = v; },
            getData: (t: string) => store[t] ?? '',
        };
        return { event, store };
    }

    it('复制部分文本选区时为纯文本（不包含节点类型）', () => {
        editor = makeEditor('**加粗** 与普通文本');
        editor.commands.setTextSelection({ from: 1, to: 3 });

        const { event, store } = clipboardEvent('copy');
        editor.view.dom.dispatchEvent(event);

        expect(store['text/plain']).toBe('加粗');
    });

    it('复制完整段落时保留 Markdown 行内格式', () => {
        editor = makeEditor('**加粗** 与普通文本');
        const paragraphEnd = editor.state.doc.child(0).nodeSize - 1;
        editor.commands.setTextSelection({ from: 1, to: paragraphEnd });

        const { event, store } = clipboardEvent('copy');
        editor.view.dom.dispatchEvent(event);

        expect(store['text/plain']).toBe('**加粗** 与普通文本');
    });

    it('复制代码块片段时为纯文本，不会带上代码围栏', () => {
        editor = makeEditor('```\nconst a = 1;\nconst b = 2;\n```');
        // 代码块内容起始于位置 1，仅选中第一行
        editor.commands.setTextSelection({ from: 1, to: 13 });

        const { event, store } = clipboardEvent('copy');
        editor.view.dom.dispatchEvent(event);

        expect(store['text/plain']).toBe('const a = 1;');
        expect(store['text/plain']).not.toContain('```');
    });

    it('复制代码块全部文字时保留代码围栏', () => {
        editor = makeEditor('```\nconst a = 1;\nconst b = 2;\n```');
        const codeBlock = editor.state.doc.child(0);
        const codeEnd = 1 + codeBlock.content.size;
        editor.commands.setTextSelection({ from: 1, to: codeEnd });

        const { event, store } = clipboardEvent('copy');
        editor.view.dom.dispatchEvent(event);

        expect(store['text/plain']).toContain('```');
        expect(store['text/plain']).toContain('const a = 1;');
    });

    it('复制单元格内的文字时为纯文本（不输出表格）', () => {
        editor = makeEditor(TABLE_MD);
        const tablePos = findTablePos(editor);
        const table = editor.state.doc.nodeAt(tablePos)!;
        const map = TableMap.get(table);
        const firstBodyCell = tablePos + 1 + map.map[map.width];

        // 选中单元格内文本 "1"
        editor.commands.setTextSelection({ from: firstBodyCell + 2, to: firstBodyCell + 3 });

        const { event, store } = clipboardEvent('copy');
        editor.view.dom.dispatchEvent(event);

        expect(store['text/plain']).toBe('1');
        expect(store['text/plain']).not.toContain('|');
    });

    it('剪切时剪贴板为纯文本且删除选区', () => {
        editor = makeEditor('**加粗** 与普通文本');
        editor.commands.setTextSelection({ from: 1, to: 3 });

        const { event, store } = clipboardEvent('cut');
        editor.view.dom.dispatchEvent(event);

        expect(store['text/plain']).toBe('加粗');
        expect(editor.state.doc.textContent).toBe(' 与普通文本');
    });

    it('复制整张表格时剪贴板为完整表格 Markdown', () => {
        editor = makeEditor('前面\n\n' + TABLE_MD + '\n\n后面');
        const tablePos = findTablePos(editor);
        editor.commands.setNodeSelection(tablePos);

        const { event, store } = clipboardEvent('copy');
        editor.view.dom.dispatchEvent(event);

        expect(store['text/plain']).toBe(TABLE_MD);
    });

    it('复制部分单元格时剪贴板仅包含所选单元格', () => {
        editor = makeEditor(TABLE_MD);
        const tablePos = findTablePos(editor);
        const table = editor.state.doc.nodeAt(tablePos)!;
        const map = TableMap.get(table);
        const anchorCell = tablePos + 1 + map.map[map.width];
        editor.commands.setCellSelection({ anchorCell, headCell: anchorCell });

        const { event, store } = clipboardEvent('copy');
        editor.view.dom.dispatchEvent(event);

        expect(store['text/plain']).toBe('| 1 |\n| --- |');
    });

    it('粘贴 Markdown 文本时解析为富文本', () => {
        editor = makeEditor('');
        editor.commands.setTextSelection(1);

        const { event } = clipboardEvent('paste', { text: '## 标题\n\n**加粗**' });
        editor.view.dom.dispatchEvent(event);

        const json = JSON.stringify(editor.state.doc.toJSON());
        expect(json).toContain('"heading"');
        expect(json).toContain('"bold"');
    });

    it('粘贴表格 Markdown 时还原为表格节点', () => {
        editor = makeEditor('');
        editor.commands.setTextSelection(1);

        const { event } = clipboardEvent('paste', { text: TABLE_MD });
        editor.view.dom.dispatchEvent(event);

        expect(findTablePos(editor)).toBeGreaterThanOrEqual(0);
        expect((editor.storage as any).markdown.getMarkdown().trim()).toBe(TABLE_MD);
    });

    it('粘贴所选单元格 Markdown 时还原为对应表格', () => {
        editor = makeEditor('');
        const subset = '| 2 | 3 |\n| --- | --- |\n| 5 | 6 |';

        const { event } = clipboardEvent('paste', { text: subset });
        editor.view.dom.dispatchEvent(event);

        expect(findTablePos(editor)).toBeGreaterThanOrEqual(0);
        expect((editor.storage as any).markdown.getMarkdown().trim()).toBe(subset);
    });

    it('粘贴包含空行的代码块时保留完整代码块内容', () => {
        editor = makeEditor('');
        editor.commands.setTextSelection(1);

        const md = '```plaintext\nAAAA\n\n\nBBBB\n```';
        const { event } = clipboardEvent('paste', { text: md });
        editor.view.dom.dispatchEvent(event);

        expect((editor.storage as any).markdown.getMarkdown().trim()).toBe(md);
    });

    it('在段落中粘贴块级 Markdown 时保持块级结构', () => {
        editor = makeEditor('abc');
        editor.commands.setTextSelection(3);

        const { event } = clipboardEvent('paste', { text: '## 标题\n\n- a' });
        editor.view.dom.dispatchEvent(event);

        const md = (editor.storage as any).markdown.getMarkdown();
        expect(md).toContain('## 标题');
        expect(md).toContain('- a');
        expect(md).not.toContain('abc## ');
    });

    it('代码块内粘贴保持纯文本', () => {
        editor = makeEditor('```\n\n```');
        const codePos = editor.state.doc.child(0).nodeSize;
        editor.commands.setTextSelection(codePos - 1);

        const { event } = clipboardEvent('paste', { text: '**not bold**' });
        editor.view.dom.dispatchEvent(event);

        const json = JSON.stringify(editor.state.doc.toJSON());
        expect(json).not.toContain('"bold"');
        expect(json).toContain('**not bold**');
    });
});
