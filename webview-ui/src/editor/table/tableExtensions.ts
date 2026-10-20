/**
 * 导出以下经过扩展/定制的表格相关组件：
 *   - TableHeader  — 添加 textAlign 属性支持
 *   - TableCell    — 添加 textAlign 属性支持
 *   - TableDeleteOnBackspace — 空表格按退格/Delete 删除整个表格
 *   - Table        — 支持 Markdown 对齐语法序列化
 */
import { Extension } from '@tiptap/core';
import { Table as BaseTable } from '@tiptap/extension-table';
import { TableHeader as BaseTableHeader } from '@tiptap/extension-table-header';
import { TableCell as BaseTableCell } from '@tiptap/extension-table-cell';
import { TableMap } from '@tiptap/pm/tables';

// ── TableHeader：支持 textAlign 属性 ───────────────────────────────────────
export const TableHeader = BaseTableHeader.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            textAlign: {
                default: null,
                parseHTML: (element: HTMLElement) => {
                    const style = element.getAttribute('style') || '';
                    const match = style.match(/text-align:\s*(left|center|right)/i);
                    return match ? match[1].toLowerCase() : null;
                },
                renderHTML: (attributes: Record<string, any>) => {
                    if (!attributes.textAlign) return {};
                    return { style: `text-align: ${attributes.textAlign}` };
                },
            },
        };
    },
});

// ── TableCell：支持 textAlign 属性 ─────────────────────────────────────────
export const TableCell = BaseTableCell.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            textAlign: {
                default: null,
                parseHTML: (element: HTMLElement) => {
                    const style = element.getAttribute('style') || '';
                    const match = style.match(/text-align:\s*(left|center|right)/i);
                    return match ? match[1].toLowerCase() : null;
                },
                renderHTML: (attributes: Record<string, any>) => {
                    if (!attributes.textAlign) return {};
                    return { style: `text-align: ${attributes.textAlign}` };
                },
            },
        };
    },
});

// ── TableDeleteOnBackspace：空表格按退格/Delete 删除整个表格 ────────────────
export const TableDeleteOnBackspace = Extension.create({
    name: 'tableDeleteOnBackspace',
    addKeyboardShortcuts() {
        const handleDelete = () => {
            if (!this.editor.isActive('table')) return false;
            const $from = this.editor?.state?.selection?.$from;
            let tablePos = null;
            let tableNode = null;
            for (let depth = $from.depth; depth > 0; depth--) {
                const node = $from.node(depth);
                if (node.type.name === 'table') {
                    tableNode = node;
                    tablePos = $from.before(depth);
                    break;
                }
            }
            if (!tableNode) return false;
            let allEmpty = true;
            tableNode.descendants((child: any) => {
                if (child.type.name === 'tableCell' || child.type.name === 'tableHeader') {
                    if (child.textContent.trim().length > 0) {
                        allEmpty = false;
                        return false;
                    }
                }
            });
            if (allEmpty) {
                this.editor.chain().focus().deleteTable().run();
                return true;
            }
            return false;
        };

        return {
            Backspace: handleDelete,
            Delete: handleDelete,
        };
    },
});

// ── TableCellHardBreak：单元格内换行统一使用 <br/> ────────────────────────
// GFM 表格单元格无法表示多个段落；若在单元格内按 Enter 产生新段落，
// 序列化时表格结构易被破坏。这里将单元格内直接子级段落中的 Enter
// 改为插入硬换行（序列化为 <br/>），与“单元格换行 = <br/>”保持一致。
export const TableCellHardBreak = Extension.create({
    name: 'tableCellHardBreak',
    addKeyboardShortcuts() {
        return {
            Enter: () => {
                const { $from } = this.editor.state.selection;
                // 仅处理单元格内直接子级的段落（列表/代码块内的 Enter 保持原行为）
                if ($from.parent.type.name !== 'paragraph' || $from.depth < 2) return false;
                const parent = $from.node($from.depth - 1);
                if (parent.type.name !== 'tableCell' && parent.type.name !== 'tableHeader') {
                    return false;
                }
                return this.editor.commands.setHardBreak();
            },
        };
    },
});

// ── 内部工具函数 ────────────────────────────────────────────────────────────
function alignmentDelimiter(align: string | null): string {
    switch (align) {
        case 'left':   return ':---';
        case 'center': return ':---:';
        case 'right':  return '---:';
        default:       return '---';
    }
}

/**
 * 将单元格内容渲染为单行 Markdown 文本。
 *
 * GFM 表格要求每个单元格的内容位于同一行，因此：
 *   • 单元格内的多个段落用 <br/> 连接；
 *   • 硬换行产生的换行符同样替换为 <br/>。
 *
 * 渲染过程中会临时清空输出缓冲，同时清除 `delim`——否则位于引用块/列表中的
 * 表格会把 `> ` 等块级前缀写进单元格内容。
 */
function renderCellInline(state: any, cell: any): string {
    const parts: string[] = [];
    // 单元格内的硬换行始终输出 <br/>（包括位于单元格末尾的换行，
    // 默认序列化器会丢弃末尾的硬换行）
    const nodes = state.nodes;
    const prevHardBreak = nodes?.hardBreak;
    if (nodes) nodes.hardBreak = (s: any) => s.write('<br/>');

    try {
        cell.forEach((child: any) => {
            if (child.isTextblock) {
                const prevOut = state.out;
                const prevDelim = state.delim;
                state.out = '';
                state.delim = undefined;
                try {
                    state.renderInline(child);
                    parts.push(state.out);
                } finally {
                    state.out = prevOut;
                    state.delim = prevDelim;
                }
            } else {
                parts.push(child.textContent);
            }
        });
    } finally {
        if (nodes) nodes.hardBreak = prevHardBreak;
    }

    return parts.join('<br/>').replace(/\r?\n/g, '<br/>');
}

interface TableGrid {
    width: number;
    /** 单元格网格；null 表示该位置被合并单元格覆盖，输出空单元格占位 */
    rows: (any | null)[][];
}

/**
 * 构建用于序列化的表格网格。
 * 优先使用 TableMap（可正确处理行列合并）；若表格结构异常导致
 * TableMap 无法构建，则按行/单元格直接组织，保证仍输出表格语法。
 */
function buildTableGrid(node: any): TableGrid | null {
    try {
        const map = TableMap.get(node);
        if (map.width > 0 && map.height > 0) {
            const rows: (any | null)[][] = [];
            const seen = new Set<number>();
            for (let row = 0; row < map.height; row++) {
                const cells: (any | null)[] = [];
                for (let col = 0; col < map.width; col++) {
                    const offset = map.map[row * map.width + col];
                    const cell = node.nodeAt(offset);
                    if (!cell || seen.has(offset)) {
                        cells.push(null);
                    } else {
                        seen.add(offset);
                        cells.push(cell);
                    }
                }
                rows.push(cells);
            }
            return { width: map.width, rows };
        }
    } catch {
        // 继续使用结构化降级方案
    }

    const rows: any[][] = [];
    node.forEach((row: any) => {
        const cells: any[] = [];
        row.forEach((cell: any) => cells.push(cell));
        rows.push(cells);
    });
    if (!rows.length) return null;

    const width = rows.reduce((max, cells) => Math.max(max, cells.length), 0);
    if (!width) return null;
    return {
        width,
        rows: rows.map((cells) => {
            const padded: (any | null)[] = [...cells];
            while (padded.length < width) padded.push(null);
            return padded;
        }),
    };
}

// ── Table：支持 Markdown 对齐语法序列化 ────────────────────────────────────
export const Table = BaseTable.extend({
    addStorage() {
        return {
            markdown: {
                serialize(state: any, node: any, _parent: any) {
                    const grid = buildTableGrid(node);
                    if (!grid) {
                        state.closeBlock(node);
                        return;
                    }

                    state.inTable = true;

                    grid.rows.forEach((cells, row) => {
                        state.write('|');
                        for (let col = 0; col < grid.width; col++) {
                            const cell = cells[col];
                            if (!cell) {
                                state.write('  |');
                                continue;
                            }
                            state.write(' ');
                            state.write(renderCellInline(state, cell));
                            state.write(' |');
                        }
                        state.ensureNewLine();

                        if (!row) {
                            // 根据表头单元格的对齐属性构建分隔行
                            const delimiterRow: string[] = [];
                            for (let col = 0; col < grid.width; col++) {
                                delimiterRow.push(
                                    alignmentDelimiter(cells[col]?.attrs?.textAlign ?? null)
                                );
                            }
                            state.write(`| ${delimiterRow.join(' | ')} |`);
                            state.ensureNewLine();
                        }
                    });
                    state.closeBlock(node);
                    state.inTable = false;
                },
                parse: {
                    // 由 markdown-it 处理
                },
            },
        };
    },
});
