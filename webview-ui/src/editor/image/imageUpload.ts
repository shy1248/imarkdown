import { Node, mergeAttributes } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { t } from '../../i18n';
import { isPanelCancelKey, isPanelSaveKey, onAllPanelsClose } from '../editorPanelHelper';

const MAX_FILES = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export interface ImageUploadOptions {
    onUpload: (files: File[], uploadBlockPos: number) => void;
}

// ── 活跃上传块注册表 ──────────────────────────────────────────────────────
// 因为上传块 container 永远不获得键盘焦点（mousedown 被 preventDefault 阻止），
// 我们使用模块级注册表 + window keydown 监听器来响应 ESC/Ctrl+Z/Ctrl+S。
// 文档中可能同时存在多个上传块，取消时删除最近插入的一个（LIFO 顺序）。
const _activeRemoveFns: (() => void)[] = [];

// 单例 window keydown 监听器——按需注册，所有块共享一个
function handleUploadBlockKeydown(e: KeyboardEvent) {
    if (_activeRemoveFns.length === 0) return;
    if (isPanelCancelKey(e) || isPanelSaveKey(e)) {
        // Ctrl+Z / ESC：移除最近的上传块
        // Ctrl+S：移除但不阻止传播（让保存逻辑继续）
        if (!isPanelSaveKey(e)) e.preventDefault();
        e.stopPropagation();
        const removeFn = _activeRemoveFns[_activeRemoveFns.length - 1];
        removeFn?.();
    }
}
let _windowListenerActive = false;
function ensureWindowListener() {
    if (_windowListenerActive) return;
    _windowListenerActive = true;
    window.addEventListener('keydown', handleUploadBlockKeydown, true);
}
function maybeRemoveWindowListener() {
    if (_activeRemoveFns.length > 0 || !_windowListenerActive) return;
    _windowListenerActive = false;
    window.removeEventListener('keydown', handleUploadBlockKeydown, true);
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        imageUploadBlock: {
            insertImageUpload: () => ReturnType;
            removeImageUpload: () => ReturnType;
        };
    }
}

export function imageUpload(options: ImageUploadOptions) {
    return Node.create({
        name: 'imageUploadBlock',
        group: 'block',
        atom: true,
        selectable: true,
        draggable: false,

        parseHTML() {
            return [{ tag: 'div[data-image-upload]' }];
        },

        renderHTML({ HTMLAttributes }: any) {
            return ['div', mergeAttributes(HTMLAttributes, { 'data-image-upload': '' })];
        },

        addCommands() {
            return {
                insertImageUpload:
                    () =>
                        ({ commands }) => {
                            return commands.insertContent({
                                type: this.name,
                            });
                        },
                removeImageUpload:
                    () =>
                        ({ state, dispatch }) => {
                            const { selection } = state;
                            const { $from } = selection;
                            let pos: number | null = null;
                            state.doc.descendants((node, nodePos) => {
                                if (node.type.name === 'imageUploadBlock' && pos === null) {
                                    if (nodePos <= $from.pos && $from.pos <= nodePos + node.nodeSize) {
                                        pos = nodePos;
                                    }
                                }
                            });
                            if (pos !== null && dispatch) {
                                const node = state.doc.nodeAt(pos);
                                if (node) {
                                    dispatch(state.tr.delete(pos, pos + node.nodeSize));
                                }
                            }
                            return true;
                        },
            };
        },

        addNodeView() {
            return ({ node, getPos, editor }) => {
                const container = document.createElement('div');
                container.className = 'image-upload-block';
                container.setAttribute('data-image-upload', '');
                container.contentEditable = 'false';

                const icon = document.createElement('div');
                icon.className = 'image-upload-icon';
                icon.innerHTML = `<svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                </svg>`;

                const hint = document.createElement('div');
                hint.className = 'image-upload-hint';
                hint.textContent = t('imageUpload.hint');

                const subHint = document.createElement('div');
                subHint.className = 'image-upload-sub-hint';
                subHint.textContent = t('imageUpload.constraints');

                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
                fileInput.multiple = true;
                fileInput.className = 'image-upload-file-input';

                container.appendChild(icon);
                container.appendChild(hint);
                container.appendChild(subHint);
                container.appendChild(fileInput);

                // 辅助函数：移除此上传占位块
                const removeSelf = () => {
                    if (typeof getPos === 'function') {
                        const pos = getPos();
                        if (pos != null) {
                            const tr = editor.state.tr;
                            const nodeAtPos = tr.doc.nodeAt(pos);
                            if (nodeAtPos && nodeAtPos.type.name === 'imageUploadBlock') {
                                tr.delete(pos, pos + nodeAtPos.nodeSize);
                                // 删除后主动将光标定位到最近的文本位置，
                                // 防止 PM 自动 resolve 选区时命中相邻的 atom 节点
                                // （图片、行间公式、HR 等），导致它们被意外选中。
                                // 优先向前查找（上方段落末尾），再向后查找（下方段落开头）。
                                const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
                                const textSel =
                                    TextSelection.findFrom($pos, -1, true) ??
                                    TextSelection.findFrom($pos, 1, true);
                                if (textSel) tr.setSelection(textSel);
                                editor.view.dispatch(tr);
                            }
                        }
                    }
                };

                // 注册到活跃上传块列表，确保 window keydown 监听器可响应 ESC/Ctrl+Z/Ctrl+S
                _activeRemoveFns.push(removeSelf);
                ensureWindowListener();
                // 监听全局面板关闭事件（由 Ctrl+S 保存逻辑触发）
                const cleanupAllPanelsClose = onAllPanelsClose(() => removeSelf());

                // 校验并处理文件
                const processFiles = (fileList: FileList | File[]) => {
                    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));

                    if (files.length === 0) return;

                    if (files.length > MAX_FILES) {
                        alert(t('imageUpload.tooMany'));
                        return;
                    }

                    const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
                    if (oversized.length > 0) {
                        alert(t('imageUpload.tooLarge'));
                        return;
                    }

                    // 传入此上传块的当前位置，以便调用方在上传完成后
                    // 将其替换为真实的图片节点。
                    // 此处不移除自身 — 由调用方在插入图片后处理。
                    const blockPos = typeof getPos === 'function' ? getPos() ?? -1 : -1;
                    options.onUpload(files, blockPos);
                };

                container.addEventListener('mousedown', (e) => {
                    if (e.target === fileInput) return;
                    e.preventDefault();
                    e.stopPropagation();
                    fileInput.click();
                });

                fileInput.addEventListener('change', () => {
                    if (fileInput.files && fileInput.files.length > 0) {
                        processFiles(fileInput.files);
                    }
                    fileInput.value = '';
                });

                // 拖放 — 使用捕获阶段以优先于 ProseMirror 处理
                container.addEventListener('dragenter', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    container.classList.add('drag-over');
                }, true);

                container.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    container.classList.add('drag-over');
                }, true);

                container.addEventListener('dragleave', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    container.classList.remove('drag-over');
                }, true);

                container.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    container.classList.remove('drag-over');
                    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                        processFiles(e.dataTransfer.files);
                    }
                }, true);

                // Backspace / Delete 直接删除上传块（由 PM 传递过来的键盘事件）
                // ESC / Ctrl+Z / Ctrl+S 由模块级 window keydown 监听器处理
                container.addEventListener('keydown', (e) => {
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                        e.preventDefault();
                        removeSelf();
                    }
                });

                return {
                    dom: container,
                    stopEvent(event: Event) {
                        return true;
                    },
                    ignoreMutation() {
                        return true;
                    },
                    update(updatedNode) {
                        return updatedNode.type.name === 'imageUploadBlock';
                    },
                    destroy() {
                        // 从活跃列表中注销，防止 keydown 监听器在节点销毁后仍尝试操作
                        const idx = _activeRemoveFns.indexOf(removeSelf);
                        if (idx !== -1) _activeRemoveFns.splice(idx, 1);
                        maybeRemoveWindowListener();
                        cleanupAllPanelsClose();
                    },
                };
            };
        },

        // 确保此节点不出现在 Markdown 输出中
        addStorage() {
            return {};
        },
    });
}
