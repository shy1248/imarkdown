/**
 * 将编辑器选区的空/非空状态同步给扩展宿主。
 *
 * 扩展宿主通过 `imarkdown.hasSelection` 上下文键在“有高亮选中内容”时
 * 隐藏 webview 右键菜单中的“使用纯文本模式打开”和“导出为 HTML”。
 * 仅在状态变化时发送消息，避免频繁往返。
 */
import type { Editor } from '@tiptap/core';
import { postMessage } from '../vscode';

let lastHasSelection: boolean | null = null;

/** 通知扩展宿主当前选区是否非空（重复状态会被忽略）。 */
export function notifySelectionState(editor: Editor | null | undefined): void {
    if (!editor || editor.isDestroyed) return;
    const hasSelection = !editor.state.selection.empty;
    if (hasSelection === lastHasSelection) return;
    lastHasSelection = hasSelection;
    postMessage({ type: 'selectionChanged', hasSelection });
}

/** 清除缓存并通知扩展宿主“无选中内容”（编辑器销毁时调用）。 */
export function resetSelectionState(): void {
    lastHasSelection = false;
    postMessage({ type: 'selectionChanged', hasSelection: false });
}
