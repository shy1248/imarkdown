/**
 * 编辑器内联面板互斥的共享辅助模块。
 *
 * 所有内联编辑面板（图片、行内公式、块级公式、链接）都遵循同一规则：
 * 某个面板打开时，其他面板应自动关闭。本模块集中管理面板 ID 生成、
 * 事件广播和监听器注册。
 */

/** 使用给定前缀生成唯一面板 ID。 */
export function generatePanelId(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 广播某个面板已打开（使其他面板关闭自身）。
 */
export function broadcastPanelOpen(panelId: string): void {
    window.dispatchEvent(
        new CustomEvent('editor-panel-open', { detail: { id: panelId } }),
    );
}

/**
 * 注册监听器：当其他面板打开时调用 onClose。
 * 返回用于移除监听器的清理函数。
 */
export function onOtherPanelOpen(
    panelId: string,
    onClose: () => void,
): () => void {
    const handler = (e: Event) => {
        if ((e as CustomEvent).detail?.id !== panelId) {
            onClose();
        }
    };
    window.addEventListener('editor-panel-open', handler);
    return () => window.removeEventListener('editor-panel-open', handler);
}

// ── 全局面板关闭事件 ─────────────────────────────────────────────────────
// 当 Ctrl+S 保存时，所有打开的面板应立即关闭并放弃未确认的修改。

/**
 * 广播所有面板关闭事件。由 Ctrl+S 保存逻辑调用。
 */
export function broadcastAllPanelsClose(): void {
    window.dispatchEvent(new CustomEvent('editor-panels-close-all'));
}

/**
 * 注册监听器：当 broadcastAllPanelsClose() 被调用时执行 onClose。
 * 参数 skipFocus=true 表示本次关闭由 Ctrl+S 触发，面板不应 focus 编辑器
 * （Ctrl+S handler 自己会处理后续逻辑）。
 * 返回用于移除监听器的清理函数。
 */
export function onAllPanelsClose(onClose: (skipFocus: boolean) => void): () => void {
    const handler = () => onClose(true);
    window.addEventListener('editor-panels-close-all', handler);
    return () => window.removeEventListener('editor-panels-close-all', handler);
}

/**
 * 判断按键事件是否为面板取消快捷键（Ctrl+Z 或 Escape）。
 * 返回 true 表示该事件应关闭面板并放弃修改。
 */
export function isPanelCancelKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') return true;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') return true;
    return false;
}

/**
 * 判断按键事件是否为 Ctrl+S / ⌘+S（保存快捷键）。
 * 在面板打开时，Ctrl+S 应关闭面板放弃修改，并允许保存事件继续传播。
 */
export function isPanelSaveKey(e: KeyboardEvent): boolean {
    return (e.ctrlKey || e.metaKey) && e.key === 's';
}
