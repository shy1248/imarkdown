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

// ── 内部工具函数 ────────────────────────────────────────────────────────────
function alignmentDelimiter(align: string | null): string {
    switch (align) {
        case 'left':   return ':---';
        case 'center': return ':---:';
        case 'right':  return '---:';
        default:       return '---';
    }
}

function childNodes(node: any): any[] {
    return node?.content?.content ?? [];
}

function hasSpan(node: any): boolean {
    return node.attrs.colspan > 1 || node.attrs.rowspan > 1;
}

function isMarkdownSerializable(node: any): boolean {
    const rows = childNodes(node);
    const firstRow = rows[0];
    const bodyRows = rows.slice(1);

    if (childNodes(firstRow).some(
        (cell: any) => cell.type.name !== 'tableHeader' || hasSpan(cell) || cell.childCount > 1
    )) {
        return false;
    }

    if (bodyRows.some((row: any) =>
        childNodes(row).some(
            (cell: any) => cell.type.name === 'tableHeader' || hasSpan(cell) || cell.childCount > 1
        )
    )) {
        return false;
    }

    return true;
}

// ── Table：支持 Markdown 对齐语法序列化 ────────────────────────────────────
export const Table = BaseTable.extend({
    addStorage() {
        return {
            markdown: {
                serialize(state: any, node: any, _parent: any) {
                    if (!isMarkdownSerializable(node)) {
                        // 复杂表格（含合并单元格等）降级为纯文本序列化
                        state.write(node.textContent);
                        state.closeBlock(node);
                        return;
                    }
                    state.inTable = true;
                    node.forEach((row: any, _p: any, i: number) => {
                        state.write('| ');
                        row.forEach((col: any, _cp: any, j: number) => {
                            if (j) state.write(' | ');
                            const cellContent = col.firstChild;
                            if (cellContent.textContent.trim()) {
                                state.renderInline(cellContent);
                            }
                        });
                        state.write(' |');
                        state.ensureNewLine();
                        if (!i) {
                            // 根据表头单元格的对齐属性构建分隔行
                            const headerCells = childNodes(row);
                            const delimiterRow = headerCells
                                .map((cell: any) => alignmentDelimiter(cell.attrs.textAlign))
                                .join(' | ');
                            state.write(`| ${delimiterRow} |`);
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
