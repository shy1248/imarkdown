/**
 * 内联编辑面板的通用按钮栏（✓ / ✕ / 删除）。
 * 图片、公式等内联编辑面板共用该实现，避免重复创建按钮与事件绑定。
 */
import { t } from '../../i18n';

export interface InlineEditToolbarActions {
    onApply: () => void;
    onCancel: () => void;
    /** 省略时不显示删除按钮 */
    onDelete?: () => void;
    /** 删除按钮文案，默认取 image.delete */
    deleteLabel?: string;
}

/** 阻止面板内的 mousedown 影响到 ProseMirror 的光标定位。 */
function bindButton(btn: HTMLButtonElement, handler: () => void): void {
    btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handler();
    });
}

/**
 * 创建内联编辑面板的按钮栏。
 * 返回的元素可直接 append 到面板容器中。
 */
export function createInlineEditToolbar(actions: InlineEditToolbarActions): HTMLElement {
    const btnBar = document.createElement('div');
    btnBar.classList.add('inline-edit-buttons');

    const applyBtn = document.createElement('button');
    applyBtn.textContent = '✓';
    applyBtn.title = t('Confirm (Enter)');
    applyBtn.classList.add('inline-edit-btn', 'inline-edit-btn-apply');
    bindButton(applyBtn, actions.onApply);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕';
    cancelBtn.title = t('Cancel (Esc)');
    cancelBtn.classList.add('inline-edit-btn', 'inline-edit-btn-cancel');
    bindButton(cancelBtn, actions.onCancel);

    btnBar.appendChild(applyBtn);
    btnBar.appendChild(cancelBtn);

    if (actions.onDelete) {
        const deleteBtn = document.createElement('button');
        const label = actions.deleteLabel ?? t('image.delete');
        deleteBtn.textContent = label;
        deleteBtn.title = label;
        deleteBtn.classList.add('inline-edit-btn', 'inline-edit-btn-unlink');
        deleteBtn.style.marginLeft = 'auto';
        bindButton(deleteBtn, actions.onDelete);
        btnBar.appendChild(deleteBtn);
    }

    return btnBar;
}
