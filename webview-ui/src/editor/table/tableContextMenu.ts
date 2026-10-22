/**
 * 表格行/列拖动手柄的右键菜单。
 *
 * 菜单覆盖 VS Code webview 的默认右键菜单，包含：
 *   • 剪切 / 复制 / 粘贴；
 *   • 插入行/列（插入到当前行/列之前）、删除行/列；
 *   • 列手柄额外提供对齐菜单项（居左 / 居中 / 居右）。
 */
import { Editor } from '@tiptap/core';
import { EditorView } from '@tiptap/pm/view';
import { TableMap } from '@tiptap/pm/tables';
import { t } from '../../i18n';
import { onMessage, postMessage } from '../../vscode';
import { insertMarkdownText, serializeSelectionAsMarkdown } from '../editorUtils';

export type TableHandleKind = 'row' | 'col';
export type ColumnAlignment = 'left' | 'center' | 'right';

export interface TableContextMenuOptions {
    editor: Editor;
    view: EditorView;
    tablePos: number;
    kind: TableHandleKind;
    row: number;
    col: number;
    x: number;
    y: number;
}

let activeMenu: HTMLElement | null = null;
let disposeGlobalHandlers: (() => void) | null = null;

/** 关闭当前打开的表格右键菜单。 */
export function closeTableContextMenu(): void {
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
    }
    if (disposeGlobalHandlers) {
        disposeGlobalHandlers();
        disposeGlobalHandlers = null;
    }
}

// ─── 剪贴板 ───────────────────────────────────────────────

async function writeClipboard(text: string): Promise<void> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
    } catch {
        // 回退到扩展宿主（vscode.env.clipboard）
    }
    postMessage({ type: 'clipboardWrite', text });
}

async function readClipboard(): Promise<string> {
    try {
        if (navigator.clipboard?.readText) {
            return await navigator.clipboard.readText();
        }
    } catch {
        // 回退到扩展宿主（vscode.env.clipboard）
    }
    return new Promise<string>((resolve) => {
        const requestId = `clipboard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let settled = false;
        let dispose: () => void = () => { /* noop */ };
        let timer = 0;
        const finish = (text: string) => {
            if (settled) return;
            settled = true;
            dispose();
            window.clearTimeout(timer);
            resolve(text);
        };
        dispose = onMessage('clipboardText', (msg) => {
            if (msg.requestId !== requestId) return;
            finish(typeof msg.text === 'string' ? msg.text : '');
        });
        timer = window.setTimeout(() => finish(''), 2000);
        postMessage({ type: 'readClipboard', requestId });
    });
}

// ─── 列对齐 ───────────────────────────────────────────────

/** 为整列（表头 + 所有数据单元格）设置对齐方式。 */
export function applyColumnAlignment(
    view: EditorView,
    tablePos: number,
    colIndex: number,
    alignment: ColumnAlignment,
): void {
    const tableNode = view.state.doc.nodeAt(tablePos);
    if (!tableNode) return;
    const map = TableMap.get(tableNode);
    const tableStart = tablePos + 1;
    const tr = view.state.tr;
    const visited = new Set<number>();

    for (let row = 0; row < map.height; row++) {
        const pos = tableStart + map.map[row * map.width + colIndex];
        if (visited.has(pos)) continue;
        visited.add(pos);
        const node = view.state.doc.nodeAt(pos);
        if (node && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) {
            tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                textAlign: alignment,
            });
        }
    }

    if (tr.docChanged) {
        view.dispatch(tr);
        view.focus();
    }
}

// ─── 菜单构建 ─────────────────────────────────────────────

function createMenuItem(label: string, onSelect: () => void): HTMLElement {
    const item = document.createElement('div');
    item.className = 'table-context-menu-item';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1;
    item.textContent = label;
    item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeTableContextMenu();
        onSelect();
    });
    return item;
}

function createSeparator(): HTMLElement {
    const separator = document.createElement('div');
    separator.className = 'table-context-menu-separator';
    return separator;
}

/**
 * 显示表格手柄的右键菜单。
 */
export function showTableContextMenu(options: TableContextMenuOptions): void {
    closeTableContextMenu();

    const { editor, view, tablePos, kind, col, x, y } = options;

    const menu = document.createElement('div');
    menu.className = 'table-context-menu';
    menu.setAttribute('role', 'menu');
    menu.contentEditable = 'false';
    // 保持编辑器选区与焦点不被菜单抢走
    menu.addEventListener('mousedown', (event) => event.preventDefault());
    // 阻止菜单内的右键再次触发手柄菜单
    menu.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });

    const copySelection = async () => {
        const markdown = serializeSelectionAsMarkdown(editor);
        if (markdown) {
            await writeClipboard(markdown);
        }
    };

    const cutSelection = async () => {
        await copySelection();
        if (kind === 'row') {
            editor.chain().focus().deleteRow().run();
        } else {
            editor.chain().focus().deleteColumn().run();
        }
    };

    const pasteSelection = async () => {
        const text = await readClipboard();
        if (!text) return;
        editor.view.focus();
        insertMarkdownText(editor, text);
    };

    const insertBefore = () => {
        if (kind === 'row') {
            editor.chain().focus().addRowBefore().run();
        } else {
            editor.chain().focus().addColumnBefore().run();
        }
    };

    const deleteCurrent = () => {
        if (kind === 'row') {
            editor.chain().focus().deleteRow().run();
        } else {
            editor.chain().focus().deleteColumn().run();
        }
    };

    menu.appendChild(createMenuItem(t('table.cut'), () => { void cutSelection(); }));
    menu.appendChild(createMenuItem(t('table.copy'), () => { void copySelection(); }));
    menu.appendChild(createMenuItem(t('table.paste'), () => { void pasteSelection(); }));
    menu.appendChild(createSeparator());
    menu.appendChild(createMenuItem(
        kind === 'row' ? t('table.insertRow') : t('table.insertCol'),
        insertBefore,
    ));
    menu.appendChild(createMenuItem(
        kind === 'row' ? t('table.deleteRow') : t('table.deleteCol'),
        deleteCurrent,
    ));

    // ── 列对齐（仅列手柄，直接作为一级菜单项）──
    if (kind === 'col') {
        menu.appendChild(createSeparator());

        const alignments: Array<{ value: ColumnAlignment; label: string }> = [
            { value: 'left', label: t('table.alignLeft') },
            { value: 'center', label: t('table.alignCenter') },
            { value: 'right', label: t('table.alignRight') },
        ];
        for (const item of alignments) {
            menu.appendChild(createMenuItem(item.label, () => {
                applyColumnAlignment(view, tablePos, col, item.value);
            }));
        }
    }

    document.body.appendChild(menu);

    // 限制在视口内
    const rect = menu.getBoundingClientRect();
    const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
    const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    activeMenu = menu;

    const onPointerDown = (event: MouseEvent) => {
        if (activeMenu && event.target instanceof Node && activeMenu.contains(event.target)) return;
        closeTableContextMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') closeTableContextMenu();
    };
    const onWindowChange = () => closeTableContextMenu();

    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('blur', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);

    disposeGlobalHandlers = () => {
        document.removeEventListener('mousedown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', onWindowChange);
        window.removeEventListener('blur', onWindowChange);
        window.removeEventListener('scroll', onWindowChange, true);
    };
}
