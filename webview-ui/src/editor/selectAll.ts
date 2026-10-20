/**
 * Ctrl/Cmd+A 全选行为统一为“从文档头部到文档尾部的文本选区”。
 *
 * 直接使用浏览器原生全选（或由 VS Code webview 宿主抢先处理）时，
 * 只有 DOM 选区发生变化，ProseMirror 的 `state.selection` 不会更新，导致：
 *   • 右键点击后高亮消失
 *   • Delete / Backspace 无法删除内容
 *
 * 这里始终构造与“手动从头拖选到尾”完全一致的 TextSelection，并：
 *   • 通过 `window.__imarkdownSelectAllHandler` 供 webviewHtml.ts 的
 *     捕获阶段监听器调用（绕过宿主对快捷键的抢占）；
 *   • 在编辑器 DOM 捕获阶段自行拦截 Ctrl/Cmd+A；
 *   • 将 ProseMirror 自身产生的 AllSelection 归一化为等效文本选区。
 */
import { Extension } from '@tiptap/core';
import { AllSelection, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

/** 构造覆盖整个文档的文本选区（等价于手动从文档头部选到尾部）。 */
export function createDocumentTextSelection(doc: PMNode): TextSelection | null {
    const from = Selection.atStart(doc).from;
    const to = Selection.atEnd(doc).to;
    if (from >= to) return null;
    return TextSelection.create(doc, from, to);
}

/** 判断键盘事件是否为全选快捷键（Ctrl/Cmd+A，且焦点不在输入控件上）。 */
function isSelectAllEvent(event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
    if (event.key !== 'a' && event.key !== 'A') return false;
    const target = event.target as HTMLElement | null;
    if (!target || !target.tagName) return true;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    return true;
}

/** 将编辑器选区设置为整篇文档（与手动全选一致）。 */
function selectWholeDocument(view: EditorView): boolean {
    const selection = createDocumentTextSelection(view.state.doc);
    if (!selection) return false;
    view.dispatch(view.state.tr.setSelection(selection));
    view.focus();
    return true;
}

export const SelectAllDocument = Extension.create({
    name: 'selectAllDocument',

    addProseMirrorPlugins() {
        // ProseMirror 的 Mod-a 绑定产生 AllSelection。它与常规文本选区的
        // 表现不一致（右键后高亮消失、Backspace 无法删除），这里归一化为
        // 与手动全选完全一致的 TextSelection。
        const normalizeAllSelection = new Plugin({
            key: new PluginKey('normalizeAllSelection'),
            appendTransaction: (transactions, _oldState, newState) => {
                if (!(newState.selection instanceof AllSelection)) return null;
                if (!transactions.some((tr) => tr.selectionSet)) return null;
                const selection = createDocumentTextSelection(newState.doc);
                if (!selection) return null;
                return newState.tr.setSelection(selection);
            },
        });

        // 在视图创建时（同步）注册全局回调与 DOM 捕获监听器。
        const selectAllHandler = new Plugin({
            key: new PluginKey('selectAllDocumentHandler'),
            view(view) {
                // 供 webviewHtml.ts 的 document 捕获阶段监听器调用。
                const globalHandler = () => selectWholeDocument(view);
                (window as any).__imarkdownSelectAllHandler = globalHandler;

                // 直接在编辑器 DOM 上捕获：先于 ProseMirror 的冒泡阶段处理器执行。
                const handler = (event: KeyboardEvent) => {
                    if (!isSelectAllEvent(event)) return;
                    if (!selectWholeDocument(view)) return;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                };
                view.dom.addEventListener('keydown', handler, true /* 捕获阶段 */);

                return {
                    destroy() {
                        view.dom.removeEventListener('keydown', handler, true);
                        if ((window as any).__imarkdownSelectAllHandler === globalHandler) {
                            delete (window as any).__imarkdownSelectAllHandler;
                        }
                    },
                };
            },
        });

        return [normalizeAllSelection, selectAllHandler];
    },
});
