/**
 * 内联编辑按钮栏的测试（src/editor/shared/inlineEditToolbar.ts）。
 */
import { describe, it, expect, vi } from 'vitest';
import { createInlineEditToolbar } from '../editor/shared/inlineEditToolbar';

function mousedown(el: Element): void {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}

describe('createInlineEditToolbar', () => {
    it('应包含确认/取消按钮及正确样式类', () => {
        const bar = createInlineEditToolbar({ onApply: () => {}, onCancel: () => {} });
        expect(bar.classList.contains('inline-edit-buttons')).toBe(true);
        const buttons = bar.querySelectorAll('button');
        expect(buttons).toHaveLength(2);
        expect(buttons[0].classList.contains('inline-edit-btn-apply')).toBe(true);
        expect(buttons[0].textContent).toBe('✓');
        expect(buttons[1].classList.contains('inline-edit-btn-cancel')).toBe(true);
        expect(buttons[1].textContent).toBe('✕');
    });

    it('点击确认/取消应分别触发对应回调', () => {
        const onApply = vi.fn();
        const onCancel = vi.fn();
        const bar = createInlineEditToolbar({ onApply, onCancel });
        const buttons = bar.querySelectorAll('button');
        mousedown(buttons[0]);
        mousedown(buttons[1]);
        expect(onApply).toHaveBeenCalledTimes(1);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('mousedown 应阻止默认行为与冒泡（避免 ProseMirror 移动光标）', () => {
        const bar = createInlineEditToolbar({ onApply: () => {}, onCancel: () => {} });
        const outer = vi.fn();
        document.body.appendChild(bar);
        document.body.addEventListener('mousedown', outer);
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        bar.querySelector('button')!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(outer).not.toHaveBeenCalled();
        document.body.removeEventListener('mousedown', outer);
        bar.remove();
    });

    it('提供 onDelete 时应追加删除按钮', () => {
        const onDelete = vi.fn();
        const bar = createInlineEditToolbar({ onApply: () => {}, onCancel: () => {}, onDelete, deleteLabel: 'Delete' });
        const buttons = bar.querySelectorAll('button');
        expect(buttons).toHaveLength(3);
        expect(buttons[2].textContent).toBe('Delete');
        mousedown(buttons[2]);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('未提供 onDelete 时不应出现删除按钮', () => {
        const bar = createInlineEditToolbar({ onApply: () => {}, onCancel: () => {} });
        expect(bar.querySelectorAll('.inline-edit-btn-unlink')).toHaveLength(0);
    });
});