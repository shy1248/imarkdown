import { Editor } from '@tiptap/core';
import { DOMParser as PMDOMParser, Fragment, Slice as PMSlice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { t } from '../i18n';
import { postMessage } from '../vscode';

/**
 * 读取编辑器内容对应的 Markdown 文本。
 * 优先使用 tiptap-markdown 的序列化结果，回退到纯文本。
 */
export function getEditorMarkdown(editor: Editor): string {
    const storage = editor.storage as any;
    return storage?.markdown?.getMarkdown
        ? storage.markdown.getMarkdown()
        : editor.getText();
}

/**
 * 将相对图片 URL 解析为绝对 webview URL。
 */
export function resolveImageUrl(src: string): string {
    if (!src) return src;
    const lower = src.toLowerCase();
    if (lower.startsWith('http://') || lower.startsWith('https://') ||
        lower.startsWith('data:') || lower.startsWith('vscode-resource:') ||
        lower.startsWith('vscode-file:')) {
        return src;
    }
    const baseUri = (window as any).__imarkdownBaseUri || '';
    if (!baseUri) return src;
    try { return new URL(src, baseUri).toString(); } catch { return src; }
}

/**
 * 更新编辑器 DOM 中所有图片元素的 URL 为解析后的绝对地址。
 */
export function updateImageUrls(editorView: any): void {
    const root = editorView?.dom;
    if (!root) return;
    root.querySelectorAll('img').forEach((img: HTMLImageElement) => {
        const current = img.getAttribute('src') || '';
        const resolved = resolveImageUrl(current);
        if (resolved && resolved !== img.src) img.src = resolved;
    });
}

/**
 * 将表格单元格选区（CellSelection）序列化为“仅包含所选单元格”的 Markdown 表格。
 *
 * 直接对 CellSelection 做 `doc.slice(from, to)` 只会得到选区末尾的单个单元格，
 * 因此这里按 TableMap 重建选中区域的网格：
 *   • 选中区域内的单元格内容保持不变；
 *   • 合并单元格被展平，被覆盖的位置输出空单元格占位；
 *   • 无法处理时返回空字符串，由调用方回退到普通序列化。
 */
export function serializeCellSelectionAsMarkdown(editor: Editor, selection: any): string {
    const serializer = (editor.storage as any)?.markdown?.serializer;
    const $anchor = selection?.$anchorCell;
    if (!serializer || !$anchor) return '';

    // 找到选区所属的表格节点及其内容起始位置
    let table: PMNode | null = null;
    let tableStart = -1;
    for (let d = $anchor.depth; d > 0; d--) {
        if ($anchor.node(d).type.name === 'table') {
            table = $anchor.node(d);
            tableStart = $anchor.start(d);
            break;
        }
    }
    if (!table) return '';

    const map = TableMap.get(table);
    const selectedOffsets = new Set<number>();
    selection.forEachCell((_node: PMNode, pos: number) => {
        selectedOffsets.add(pos - tableStart);
    });
    if (selectedOffsets.size === 0) return '';

    // 记录每个单元格在网格中的锚点（首次出现的位置）
    const anchorPositions = new Map<number, { row: number; col: number }>();
    for (let r = 0; r < map.height; r++) {
        for (let c = 0; c < map.width; c++) {
            const offset = map.map[r * map.width + c];
            if (!anchorPositions.has(offset)) anchorPositions.set(offset, { row: r, col: c });
        }
    }

    // 选中单元格的矩形范围（考虑跨行/跨列）
    let minRow = Infinity;
    let maxRow = -1;
    let minCol = Infinity;
    let maxCol = -1;
    for (const offset of selectedOffsets) {
        const anchor = anchorPositions.get(offset);
        if (!anchor) continue;
        const cell = table.nodeAt(offset);
        const rowspan = cell?.attrs?.rowspan ?? 1;
        const colspan = cell?.attrs?.colspan ?? 1;
        minRow = Math.min(minRow, anchor.row);
        maxRow = Math.max(maxRow, anchor.row + rowspan - 1);
        minCol = Math.min(minCol, anchor.col);
        maxCol = Math.max(maxCol, anchor.col + colspan - 1);
    }
    if (maxRow < 0) return '';

    const rowType = table.child(0)?.type;
    const fallbackCellType = table.nodeAt(map.map[0])?.type;
    if (!rowType) return '';

    const rows: PMNode[] = [];
    for (let r = minRow; r <= maxRow; r++) {
        const cells: PMNode[] = [];
        for (let c = minCol; c <= maxCol; c++) {
            const offset = map.map[r * map.width + c];
            const cell = table.nodeAt(offset);
            const anchor = anchorPositions.get(offset);
            const isAnchorHere = !!anchor && anchor.row === r && anchor.col === c;

            if (cell && isAnchorHere) {
                // 展平合并单元格，保证子表格是规则网格
                cells.push(cell.type.create(
                    { ...cell.attrs, colspan: 1, rowspan: 1 },
                    cell.content,
                    cell.marks,
                ));
            } else {
                const empty = (cell?.type ?? fallbackCellType)?.createAndFill({
                    colspan: 1,
                    rowspan: 1,
                });
                if (empty) cells.push(empty);
            }
        }
        if (cells.length) rows.push(rowType.create(null, cells));
    }
    if (!rows.length) return '';

    const selectedTable = table.type.create(null, rows);
    return serializer.serialize(Fragment.from(selectedTable)).trim();
}

/**
 * 判断选区是否覆盖了节点的全部文字内容。
 *
 *   • 文本块（段落/标题/代码块等）：选中范围覆盖整个内容区即视为完整；
 *   • 容器节点（列表/引用块/表格等）：比较第一个与最后一个文本字符的位置；
 *   • 没有任何文本的节点：要求选中整个节点。
 *
 * 只有完整选中的节点才保留其 Markdown 节点类型；部分选中时会退化为纯文本，
 * 避免复制代码块片段时把代码围栏等结构一并带入剪贴板。
 */
function isNodeContentFullySelected(
    doc: PMNode,
    offset: number,
    node: PMNode,
    from: number,
    to: number,
): boolean {
    if (node.isTextblock) {
        return from <= offset + 1 && to >= offset + node.nodeSize - 1;
    }

    let firstText = Infinity;
    let lastText = -Infinity;
    node.descendants((child, pos) => {
        if (child.isText && child.text) {
            const start = offset + 1 + pos;
            firstText = Math.min(firstText, start);
            lastText = Math.max(lastText, start + child.text.length);
        }
        return true;
    });

    if (firstText === Infinity) {
        return from <= offset && to >= offset + node.nodeSize;
    }
    return from <= firstText && to >= lastText;
}

/**
 * 将当前选区序列化为 Markdown：
 *   • 单元格选区（CellSelection）只输出所选单元格重建的表格；
 *   • 表格节点选区输出完整表格，表格内的文本选区只输出纯文本（类似 Excel）；
 *   • 完整选中的节点保留其 Markdown 结构；
 *   • 部分选中的节点只输出所选范围的纯文本，避免粘贴时产生嵌套结构。
 */
export function serializeSelectionAsMarkdown(editor: Editor): string {
    const { selection, doc } = editor.state;
    if (selection.empty) return '';
    const serializer = (editor.storage as any)?.markdown?.serializer;
    if (!serializer) return '';

    if (selection instanceof CellSelection) {
        const selected = serializeCellSelectionAsMarkdown(editor, selection);
        if (selected) return selected;
    }

    // 行内节点选区（例如图片、行内公式）：按选区切片序列化，
    // 保留这些行内节点的 Markdown。
    if (selection instanceof NodeSelection && selection.node.isInline) {
        const inline = serializer
            .serialize(doc.slice(selection.from, selection.to, true).content)
            .trim();
        if (inline) return inline;
    }

    const parts: string[] = [];

    doc.forEach((node: PMNode, offset: number) => {
        const nodeStart = offset;
        const nodeEnd = offset + node.nodeSize;
        if (nodeEnd <= selection.from || nodeStart >= selection.to) return;

        // 表格需要区分“选中单元格”和“选中单元格内的文字”：
        // 只有 CellSelection（或表格节点选区）才输出表格语法；
        // 表格内部的文本选区按纯文本处理，避免把整张表格结构带入剪贴板。
        const isTable = node.type.name === 'table';
        const isTableNodeSelection =
            selection instanceof NodeSelection && selection.node.type.name === 'table';

        if (!isTable || isTableNodeSelection) {
            if (isNodeContentFullySelected(doc, offset, node, selection.from, selection.to)) {
                const markdown = serializer.serialize(Fragment.from(node)).trim();
                if (markdown) parts.push(markdown);
                return;
            }
        }

        // 部分选中：只复制所选范围内的纯文本，不包含节点类型。
        const selStart = Math.max(selection.from, nodeStart + 1);
        const selEnd = Math.min(selection.to, nodeEnd - 1);
        if (selEnd > selStart) {
            const text = doc.textBetween(selStart, selEnd, '\n', '\n');
            if (text) parts.push(text);
        }
    });

    return parts.join('\n\n').trim();
}

/**
 * 将纯文本按 Markdown 解析后插入编辑器。
 *
 * 代码块内保持纯文本插入；剪贴板内容为表格且光标位于表格内时，
 * 按单元格区域填充（避免嵌套表格）；其余情况按 Markdown 解析插入。
 */
export function insertMarkdownText(editor: Editor, plainText: string): boolean {
    const view = editor.view;
    const storage = editor.storage as any;

    const currentSelection = view.state.selection;
    let inCodeBlock = false;
    for (let d = currentSelection.$from.depth; d > 0; d--) {
        if (currentSelection.$from.node(d).type.name === 'codeBlock') {
            inCodeBlock = true;
            break;
        }
    }

    const parser = storage?.markdown?.parser;

    if (!inCodeBlock && parser) {
        try {
            // 注意：不能把 HTML 字符串交给 insertContent——tiptap-markdown
            // 会重写 insertContentAt 并用 Markdown 解析器再次解析内容，
            // 导致代码块中的空行被当作块分隔符，正文被拆到代码块之外。
            // 这里直接把 HTML 解析为 ProseMirror slice 后替换选区。
            const html = parser.parse(plainText);
            const container = document.createElement('div');
            container.innerHTML = html;

            // 剪贴板内容为单个表格，且粘贴位置在表格内 → 按单元格填充
            const pastedTable = extractSingleTable(view.state.schema, container);
            if (pastedTable) {
                const grid = readTableGrid(pastedTable);
                if (grid && pasteTableGrid(editor, grid)) return true;
            }

            if (insertParsedHtml(editor, container)) return true;
        } catch {
            // 解析失败时回退为纯文本插入
        }
    }

    return insertPlainText(editor, plainText);
}

/** 将解析后的 HTML 以 Markdown 语义插入（单元格选区先折叠到锚点单元格）。 */
function insertParsedHtml(editor: Editor, container: HTMLElement): boolean {
    const view = editor.view;
    let tr = view.state.tr;
    let selection: Selection = view.state.selection;
    if (selection instanceof CellSelection) {
        const $anchor = view.state.doc.resolve(selection.$anchorCell.pos + 1);
        tr = tr.setSelection(Selection.near($anchor, 1));
        selection = tr.selection;
    }
    const $from = selection.$from;

    try {
        // 与 tiptap-markdown 的 inline 处理保持一致：仅当内容为
        // 单个段落时按行内内容插入，其余情况按块级内容插入。
        const onlyChild = container.childElementCount === 1
            ? container.firstElementChild
            : null;
        const inline = onlyChild?.tagName === 'P';
        let slice = PMDOMParser.fromSchema(view.state.schema)
            .parseSlice(inline ? onlyChild! : container, {
                preserveWhitespace: 'full',
                ...(inline ? { context: $from } : {}),
            });
        if (!inline) {
            // parseSlice 返回“开放”切片（openStart/openEnd > 0），
            // 用于行内拼接；块级粘贴需要闭合切片，否则首个块
            // （如标题）会被并入当前段落。
            slice = new PMSlice(slice.content, 0, 0);
        }
        if (slice.size > 0) {
            view.dispatch(
                tr.replaceSelection(slice)
                    .scrollIntoView()
                    .setMeta('paste', true)
                    .setMeta('uiEvent', 'paste'),
            );
            return true;
        }
    } catch {
        // 交给调用方回退为纯文本
    }
    return false;
}

/** 以纯文本形式插入剪贴板内容（单元格选区先折叠到锚点单元格）。 */
function insertPlainText(editor: Editor, plainText: string): boolean {
    const view = editor.view;
    let tr = view.state.tr;
    let selection: Selection = view.state.selection;
    if (selection instanceof CellSelection) {
        const $anchor = view.state.doc.resolve(selection.$anchorCell.pos + 1);
        tr = tr.setSelection(Selection.near($anchor, 1));
        selection = tr.selection;
    }
    tr.replaceWith(selection.from, selection.to, view.state.schema.text(plainText));
    view.dispatch(tr);
    return true;
}

// ─── 表格区域粘贴 ─────────────────────────────────────────────

interface TableGrid {
    rows: number;
    cols: number;
    /** null 表示该位置被合并单元格覆盖 */
    cells: (PMNode | null)[][];
}

/** 读取表格节点在网格中的单元格内容。 */
function readTableGrid(table: PMNode): TableGrid | null {
    try {
        const map = TableMap.get(table);
        if (!map.width || !map.height) return null;
        const seen = new Set<number>();
        const cells: (PMNode | null)[][] = [];
        for (let r = 0; r < map.height; r++) {
            const rowCells: (PMNode | null)[] = [];
            for (let c = 0; c < map.width; c++) {
                const offset = map.map[r * map.width + c];
                if (seen.has(offset)) {
                    rowCells.push(null);
                    continue;
                }
                seen.add(offset);
                rowCells.push(table.nodeAt(offset));
            }
            cells.push(rowCells);
        }
        return { rows: map.height, cols: map.width, cells };
    } catch {
        return null;
    }
}

/** 从解析后的 HTML 容器中提取唯一的表格节点（内容必须仅为一张表格）。 */
function extractSingleTable(schema: any, container: HTMLElement): PMNode | null {
    const meaningful = Array.from(container.childNodes).filter(node => {
        if (node.nodeType === Node.ELEMENT_NODE) return true;
        if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').trim().length > 0;
        return false;
    });
    if (meaningful.length !== 1) return null;
    const only = meaningful[0] as HTMLElement;
    if (only.nodeType !== Node.ELEMENT_NODE || only.tagName !== 'TABLE') return null;

    try {
        const parsed = PMDOMParser.fromSchema(schema).parse(container);
        let table: PMNode | null = null;
        parsed.descendants(node => {
            if (node.type.name === 'table') {
                table = node;
                return false;
            }
            return true;
        });
        return table;
    } catch {
        return null;
    }
}

interface CellPasteTarget {
    tablePos: number;
    table: PMNode;
    startRow: number;
    startCol: number;
    selectionRows: number;
    selectionCols: number;
    isMultiCell: boolean;
}

/** 确定当前选区在表格中的起始单元格。 */
function findCellPasteTarget(state: any): CellPasteTarget | null {
    const selection = state.selection;

    const resolveTable = ($pos: any): { table: PMNode; tablePos: number } | null => {
        for (let d = $pos.depth; d > 0; d--) {
            if ($pos.node(d).type.name === 'table') {
                return { table: $pos.node(d), tablePos: $pos.before(d) };
            }
        }
        return null;
    };

    if (selection instanceof CellSelection) {
        const info = resolveTable(selection.$anchorCell);
        if (!info) return null;
        const map = TableMap.get(info.table);
        const tableStart = info.tablePos + 1;
        try {
            const rect = map.rectBetween(
                selection.$anchorCell.pos - tableStart,
                selection.$headCell.pos - tableStart,
            );
            return {
                ...info,
                startRow: rect.top,
                startCol: rect.left,
                selectionRows: rect.bottom - rect.top,
                selectionCols: rect.right - rect.left,
                isMultiCell: (rect.bottom - rect.top) * (rect.right - rect.left) > 1,
            };
        } catch {
            return null;
        }
    }

    const $from = selection.$from;
    let cellDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
        const name = $from.node(d).type.name;
        if (name === 'tableCell' || name === 'tableHeader') {
            cellDepth = d;
            break;
        }
    }
    if (cellDepth < 0) return null;

    const info = resolveTable($from);
    if (!info) return null;
    const map = TableMap.get(info.table);
    const tableStart = info.tablePos + 1;
    try {
        const rect = map.findCell($from.before(cellDepth) - tableStart);
        return {
            ...info,
            startRow: rect.top,
            startCol: rect.left,
            selectionRows: 1,
            selectionCols: 1,
            isMultiCell: false,
        };
    } catch {
        return null;
    }
}

/**
 * 将剪贴板中的表格按单元格区域填充到目标表格。
 *
 *   • 若存在多单元格选区，其形状必须与复制的表格一致；
 *   • 从选区左上角开始的区域必须能容纳复制的表格；
 *   • 否则弹出通知并放弃粘贴（不产生嵌套表格）。
 *
 * 返回 false 表示粘贴位置不在表格内，由调用方按普通 Markdown 处理。
 */
function pasteTableGrid(editor: Editor, grid: TableGrid): boolean {
    const state = editor.state;
    const target = findCellPasteTarget(state);
    if (!target) return false;

    const destMap = TableMap.get(target.table);
    const fits =
        target.startRow + grid.rows <= destMap.height &&
        target.startCol + grid.cols <= destMap.width;
    const shapeMatches =
        !target.isMultiCell ||
        (target.selectionRows === grid.rows && target.selectionCols === grid.cols);

    if (!fits || !shapeMatches) {
        postMessage({ type: 'showWarning', message: t('table.pasteMismatch') });
        return true;
    }

    const tableStart = target.tablePos + 1;
    let tr = state.tr;
    const written = new Set<number>();

    // 从右下往左上写入，保证事务位置始终对应原始文档
    for (let r = grid.rows - 1; r >= 0; r--) {
        for (let c = grid.cols - 1; c >= 0; c--) {
            const sourceCell = grid.cells[r][c];
            if (!sourceCell) continue;

            const cellPos = tableStart +
                destMap.map[(target.startRow + r) * destMap.width + (target.startCol + c)];
            if (written.has(cellPos)) continue;
            written.add(cellPos);

            const destCell = state.doc.nodeAt(cellPos);
            if (!destCell) continue;

            tr = tr.replaceWith(
                cellPos + 1,
                cellPos + 1 + destCell.content.size,
                sourceCell.content,
            );
        }
    }

    if (!tr.docChanged) return true;

    const firstCellPos = tableStart +
        destMap.map[target.startRow * destMap.width + target.startCol];
    tr.setSelection(Selection.near(tr.doc.resolve(firstCellPos + 1), 1));
    tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste');
    editor.view.dispatch(tr);
    return true;
}

/**
 * 从 TipTap 编辑器提取标题并发送给扩展宿主，用于大纲视图。
 */
export function sendToc(editor: Editor): void {
    const entries: { text: string; level: number; line: number; id: string }[] = [];
    let headingIndex = 0;

    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
            const level = node.attrs.level as number;
            const text = node.textContent;
            const textBefore = editor.state.doc.textBetween(0, pos, '\n', '\n');
            const line = (textBefore.match(/\n/g) || []).length;
            entries.push({ text, level, line, id: `heading-${headingIndex}` });
            headingIndex++;
        }
    });

    postMessage({ type: 'tocChanged', entries });
}

/**
 * 返回元素的可滚动祖先（第一个会滚动的祖先节点），
 * 若不存在则回退到 document.documentElement。
 */
export function getScrollParent(el: HTMLElement): HTMLElement {
    let current: HTMLElement | null = el.parentElement;
    while (current) {
        const style = window.getComputedStyle(current);
        if (/auto|scroll/.test(style.overflowY) && current.scrollHeight > current.clientHeight) {
            return current;
        }
        current = current.parentElement;
    }
    // 默认：若 body 可滚动则返回 body，否则返回 documentElement
    const bodyStyle = window.getComputedStyle(document.body);
    if (/auto|scroll/.test(bodyStyle.overflowY) && document.body.scrollHeight > document.body.clientHeight) {
        return document.body;
    }
    return document.documentElement;
}

/**
 * 通过标题索引滚动到对应标题位置。
 * 考虑吸顶工具栏高度，避免标题被遮挡。
 */
export function scrollToHeading(editor: Editor, headingId: string): void {
    const match = headingId.match(/^heading-(\d+)$/);
    if (!match) return;
    const targetIndex = parseInt(match[1], 10);

    const headingPositions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') headingPositions.push(pos);
    });

    if (targetIndex < 0 || targetIndex >= headingPositions.length) return;
    const pos = headingPositions[targetIndex];

    try {
        const dom = editor.view.domAtPos(pos + 1);
        let element: HTMLElement | null = null;
        if (dom.node instanceof HTMLElement) {
            element = dom.node;
        } else if (dom.node.parentElement) {
            element = dom.node.parentElement;
        }
        if (element) {
            const heading = (element.closest('h1,h2,h3,h4,h5,h6') as HTMLElement) || element;
            const toolbar = document.getElementById('toolbar-wrapper');
            const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
            const scrollParent = getScrollParent(heading);
            const isPageScroll = scrollParent === document.documentElement || scrollParent === document.body;
            const headingRect = heading.getBoundingClientRect();
            const containerRect = isPageScroll
                ? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
                : scrollParent.getBoundingClientRect();
            const currentScroll = isPageScroll
                ? (scrollParent.scrollTop || window.scrollY || document.documentElement.scrollTop)
                : scrollParent.scrollTop;
            const relativeTop = headingRect.top - containerRect.top + 40;
            const targetTop = currentScroll + relativeTop - toolbarHeight - 8;

            scrollParent.scrollTo({ top: targetTop, behavior: 'smooth' });
        }
    } catch {
        editor.commands.scrollIntoView();
    }
}
