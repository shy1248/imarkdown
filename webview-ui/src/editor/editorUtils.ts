import { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { postMessage } from '../vscode';

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
 * 将当前选区序列化为 Markdown：
 *   • 单元格选区（CellSelection）只输出所选单元格重建的表格；
 *   • 其他选区按 `doc.slice` 的内容序列化（整表节点选择会得到完整表格）。
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

    return serializer.serialize(doc.slice(selection.from, selection.to, true).content).trim();
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
function getScrollParent(el: HTMLElement): HTMLElement {
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
