import { InlineMath, BlockMath } from '@tiptap/extension-mathematics';
import katex from 'katex';
import { t } from '../../i18n';
import { generatePanelId, broadcastPanelOpen, onOtherPanelOpen, isPanelCancelKey, isPanelSaveKey, onAllPanelsClose } from '../editorPanelHelper';

// ---------------------------------------------------------------------------
// 共享：创建数学公式内联编辑面板（在文档流中显示）
// ---------------------------------------------------------------------------
function createMathEditor(opts: {
    latex: string;
    isBlock: boolean;
    anchorEl: HTMLElement;
    onApply: (newLatex: string) => void;
    onCancel: (skipFocus?: boolean) => void;
    onDelete: () => void;
}): HTMLElement {
    const panel = document.createElement('div');
    panel.classList.add('math-inline-edit');
    panel.contentEditable = 'false';

    const input = opts.isBlock
        ? document.createElement('textarea')
        : document.createElement('input');
    if (opts.isBlock) {
        input.classList.add('inline-edit-textarea');
        (input as HTMLTextAreaElement).rows = 3;
    } else {
        input.classList.add('inline-edit-input');
        (input as HTMLInputElement).type = 'text';
        input.style.flex = '1 1 auto';
        input.style.minWidth = '200px';
    }
    input.value = opts.latex;
    panel.appendChild(input);

    // 按钮栏
    const btnBar = document.createElement('div');
    btnBar.classList.add('inline-edit-buttons');

    const applyBtn = document.createElement('button');
    applyBtn.textContent = '✓';
    applyBtn.title = t('Confirm (Enter)');
    applyBtn.classList.add('inline-edit-btn', 'inline-edit-btn-apply');

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕';
    cancelBtn.title = t('Cancel (Esc)');
    cancelBtn.classList.add('inline-edit-btn', 'inline-edit-btn-cancel');

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = t('math.delete');
    deleteBtn.title = t('math.delete');
    deleteBtn.classList.add('inline-edit-btn', 'inline-edit-btn-unlink');
    deleteBtn.style.marginLeft = 'auto';

    btnBar.appendChild(applyBtn);
    btnBar.appendChild(cancelBtn);
    btnBar.appendChild(deleteBtn);
    panel.appendChild(btnBar);

    // 事件处理
    applyBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        opts.onApply(input.value);
    });

    cancelBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        opts.onCancel();
    });

    deleteBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        opts.onDelete();
    });

    input.addEventListener('keydown', ((e: KeyboardEvent) => {
        e.stopPropagation();
        if (isPanelCancelKey(e)) {
            // Escape 或 Ctrl+Z：取消并关闭面板，恢复焦点
            e.preventDefault();
            opts.onCancel();
        } else if (isPanelSaveKey(e)) {
            // Ctrl+S：关闭面板放弃修改，不阻止事件传播以便保存逻辑继续，
            // 且不主动 focus 编辑器（skipFocus=true）
            opts.onCancel(true);
        } else if (!opts.isBlock && e.key === 'Enter') {
            e.preventDefault();
            opts.onApply(input.value);
        } else if (opts.isBlock && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            opts.onApply(input.value);
        }
    }) as EventListener);

    // 阻止事件到达 ProseMirror
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.addEventListener('click', (e) => e.stopPropagation());

    setTimeout(() => {
        input.focus();
        input.select();
    }, 0);

    return panel;
}

// ---------------------------------------------------------------------------
// InlineMath——添加 Markdown 序列化/解析 + 点击编辑 NodeView
// ---------------------------------------------------------------------------
export const CustomInlineMath = InlineMath.extend({
    renderText({ node }: any) {
        return `$${node.attrs?.latex || ''}$`;
    },

    addNodeView() {
        const katexOptions = this.options.katexOptions || {};
        return ({ node: initialNode, getPos, editor: editorInstance }) => {
            let node = initialNode;

            // 容器包含渲染后的数学公式 + 可选的内联编辑面板
            const container = document.createElement('span');
            container.className = 'tiptap-mathematics-container';
            container.style.display = 'inline';

            const wrapper = document.createElement('span');
            wrapper.className = 'tiptap-mathematics-render';
            if (editorInstance.isEditable) {
                wrapper.classList.add('tiptap-mathematics-render--editable');
            }
            wrapper.dataset.type = 'inline-math';
            wrapper.setAttribute('data-latex', node.attrs.latex);
            container.appendChild(wrapper);

            let isEditing = false;
            let editPanel: HTMLElement | null = null;

            // 用于编辑面板互斥的唯一 ID
            const panelId = generatePanelId('inlineMath');
            const cleanupPanelListener = onOtherPanelOpen(panelId, () => {
                if (isEditing) hideEditor();
            });
            // 全局面板关闭监听器清理函数
            let cleanupAllPanelsClose: (() => void) | null = null;

            function renderMath() {
                try {
                    katex.render(node.attrs.latex, wrapper, katexOptions);
                    wrapper.classList.remove('inline-math-error');
                } catch {
                    wrapper.textContent = node.attrs.latex;
                    wrapper.classList.add('inline-math-error');
                }
            }

            function showEditor() {
                if (isEditing || !editorInstance.isEditable) return;
                // 通知其他编辑面板关闭
                broadcastPanelOpen(panelId);
                isEditing = true;
                // 监听全局面板关闭事件（由 Ctrl+S 保存逻辑触发）
                cleanupAllPanelsClose = onAllPanelsClose((skipFocus) => {
                    if (isEditing) hideEditor(skipFocus);
                });
                editPanel = createMathEditor({
                    latex: node.attrs.latex || '',
                    isBlock: false,
                    anchorEl: wrapper,
                    onApply: (newLatex) => {
                        const pos = getPos();
                        if (typeof pos === 'number' && newLatex !== node.attrs.latex) {
                            editorInstance.chain().focus().updateInlineMath({ latex: newLatex, pos }).run();
                        }
                        hideEditor();
                    },
                    onCancel: (skipFocus) => {
                        hideEditor(skipFocus);
                    },
                    onDelete: () => {
                        const pos = getPos();
                        hideEditor();
                        if (typeof pos === 'number') {
                            editorInstance.chain().focus().command(({ tr }: any) => {
                                tr.delete(pos, pos + node.nodeSize);
                                return true;
                            }).run();
                        }
                    },
                });
                container.appendChild(editPanel);
            }

            function hideEditor(skipFocus = false) {
                isEditing = false;
                // 取消全局面板关闭监听
                cleanupAllPanelsClose?.();
                cleanupAllPanelsClose = null;
                if (editPanel) {
                    editPanel.remove();
                    editPanel = null;
                }
                // Ctrl+S 路径（skipFocus=true）：不主动 focus，避免触发页面滚动；
                // 普通取消路径：focus 编辑器，恢复正常光标。
                if (!skipFocus) editorInstance.commands.focus();
            }

            // 单击：设置 ProseMirror NodeSelection 使节点被"选中"
            const handleClick = (event: MouseEvent) => {
                if (isEditing) return;
                event.preventDefault();
                event.stopPropagation();
                const pos = getPos();
                if (typeof pos === 'number') {
                    editorInstance.commands.setNodeSelection(pos);
                }
            };

            // 双击：打开编辑器
            const handleDblClick = (event: Event) => {
                event.preventDefault();
                event.stopPropagation();
                if (isEditing) {
                    hideEditor();
                } else {
                    showEditor();
                }
            };

            // 工具栏 "inlineMath" 按钮在节点被选中时触发此事件
            const handleEditRequest = (e: Event) => {
                const detail = (e as CustomEvent).detail as { pos: number };
                const pos = getPos();
                if (typeof pos === 'number' && detail?.pos === pos) {
                    if (isEditing) hideEditor(); else showEditor();
                }
            };

            wrapper.addEventListener('click', handleClick);
            wrapper.addEventListener('dblclick', handleDblClick);
            window.addEventListener('math-edit-request', handleEditRequest);
            renderMath();

            return {
                dom: container,
                // 仅在编辑时阻止 PM 事件（以便正常点击选中仍可工作）
                stopEvent: (event: Event) => {
                    if (!isEditing) return false;
                    // 始终让 mousedown 到达 PM 以便设置 NodeSelection
                    if (event.type === 'mousedown') return false;
                    return true;
                },
                ignoreMutation: () => true,
                selectNode() {
                    wrapper.classList.add('math-selected');
                },
                deselectNode() {
                    wrapper.classList.remove('math-selected');
                },
                update(updatedNode: any) {
                    if (updatedNode.type.name !== node.type.name) return false;
                    node = updatedNode;
                    wrapper.setAttribute('data-latex', node.attrs.latex);
                    renderMath();
                    return true;
                },
                destroy() {
                    wrapper.removeEventListener('click', handleClick);
                    wrapper.removeEventListener('dblclick', handleDblClick);
                    window.removeEventListener('math-edit-request', handleEditRequest);
                    cleanupPanelListener();
                    if (editPanel) editPanel.remove();
                },
            };
        };
    },

    addStorage() {
        return {
            markdown: {
                serialize(state: any, node: any) {
                    const latex = node.attrs?.latex || '';
                    state.write(`$${latex}$`);
                },
                parse: {
                    setup(this: any, markdownit: any) {
                // 使用 markdown-it 行内规则将 $...$ 转换为 inline-math span
                        markdownit.inline.ruler.after('escape', 'inline_math', (state: any, silent: boolean) => {
                            const src = state.src;
                            const pos = state.pos;
                            // 必须以 $ 开头但不能是 $$
                            if (src.charCodeAt(pos) !== 0x24 /* $ */) return false;
                            if (src.charCodeAt(pos + 1) === 0x24) return false; // 跳过 $$

                            // 查找结束的 $
                            let end = pos + 1;
                            while (end < src.length) {
                                if (src.charCodeAt(end) === 0x24 /* $ */ && src.charCodeAt(end - 1) !== 0x5C /* \ */) {
                                    break;
                                }
                                end++;
                            }
                            if (end >= src.length) return false;
                            const latex = src.slice(pos + 1, end);
                            if (!latex.trim()) return false;

                            if (!silent) {
                                const token = state.push('inline_math', 'span', 0);
                                token.content = latex;
                            }
                            state.pos = end + 1;
                            return true;
                        });

                        markdownit.renderer.rules['inline_math'] = (tokens: any[], idx: number) => {
                            const latex = tokens[idx].content;
                            return `<span data-type="inline-math" data-latex="${escapeHtml(latex)}"></span>`;
                        };
                    },
                },
            },
        };
    },
});

// ---------------------------------------------------------------------------
// BlockMath——添加 Markdown 序列化/解析，保留默认 InputRule
// ---------------------------------------------------------------------------
export const CustomBlockMath = BlockMath.extend({
    renderText({ node }: any) {
        return `$$\n${node.attrs?.latex || ''}\n$$`;
    },

    addNodeView() {
        const katexOptions = this.options.katexOptions || {};
        return ({ node: initialNode, getPos, editor: editorInstance }) => {
            let node = initialNode;

            // 容器包含渲染后的数学公式 + 可选的内联编辑面板
            const container = document.createElement('div');
            container.className = 'tiptap-mathematics-block-container';

            const wrapper = document.createElement('div');
            const innerWrapper = document.createElement('div');
            wrapper.className = 'tiptap-mathematics-render';
            if (editorInstance.isEditable) {
                wrapper.classList.add('tiptap-mathematics-render--editable');
            }
            innerWrapper.className = 'block-math-inner';
            wrapper.dataset.type = 'block-math';
            wrapper.setAttribute('data-latex', node.attrs.latex);
            wrapper.appendChild(innerWrapper);
            container.appendChild(wrapper);

            let isEditing = false;
            let editPanel: HTMLElement | null = null;

            // 用于编辑面板互斥的唯一 ID
            const panelId = generatePanelId('blockMath');
            const cleanupBlockPanelListener = onOtherPanelOpen(panelId, () => {
                if (isEditing) hideEditor();
            });
            // 全局面板关闭监听器清理函数
            let cleanupBlockAllPanelsClose: (() => void) | null = null;

            function renderMath() {
                try {
                    katex.render(node.attrs.latex, innerWrapper, katexOptions);
                    wrapper.classList.remove('block-math-error');
                } catch {
                    innerWrapper.textContent = node.attrs.latex;
                    wrapper.classList.add('block-math-error');
                }
            }

            function showEditor() {
                if (isEditing || !editorInstance.isEditable) return;
                // 通知其他编辑面板关闭
                broadcastPanelOpen(panelId);
                isEditing = true;
                // 监听全局面板关闭事件（由 Ctrl+S 保存逻辑触发）
                cleanupBlockAllPanelsClose = onAllPanelsClose((skipFocus) => {
                    if (isEditing) hideEditor(skipFocus);
                });
                editPanel = createMathEditor({
                    latex: node.attrs.latex || '',
                    isBlock: true,
                    anchorEl: wrapper,
                    onApply: (newLatex) => {
                        const pos = getPos();
                        if (typeof pos === 'number' && newLatex !== node.attrs.latex) {
                            editorInstance.chain().focus().updateBlockMath({ latex: newLatex, pos }).run();
                        }
                        hideEditor();
                    },
                    onCancel: (skipFocus) => {
                        hideEditor(skipFocus);
                    },
                    onDelete: () => {
                        const pos = getPos();
                        hideEditor();
                        if (typeof pos === 'number') {
                            editorInstance.chain().focus().command(({ tr }: any) => {
                                tr.delete(pos, pos + node.nodeSize);
                                return true;
                            }).run();
                        }
                    },
                });
                container.appendChild(editPanel);
            }

            function hideEditor(skipFocus = false) {
                isEditing = false;
                // 取消全局面板关闭监听
                cleanupBlockAllPanelsClose?.();
                cleanupBlockAllPanelsClose = null;
                if (editPanel) {
                    editPanel.remove();
                    editPanel = null;
                }
                // Ctrl+S 路径（skipFocus=true）：不主动 focus，避免触发页面滚动；
                // 普通取消路径：focus 编辑器，恢复正常光标。
                if (!skipFocus) editorInstance.commands.focus();
            }

            // 单击：设置 NodeSelection
            const handleClick = (event: MouseEvent) => {
                if (isEditing) return;
                event.preventDefault();
                event.stopPropagation();
                const pos = getPos();
                if (typeof pos === 'number') {
                    editorInstance.commands.setNodeSelection(pos);
                }
            };

            // 双击：打开编辑器
            const handleDblClick = (event: Event) => {
                event.preventDefault();
                event.stopPropagation();
                if (isEditing) {
                    hideEditor();
                } else {
                    showEditor();
                }
            };

            // 工具栏 "math" 按钮在节点被选中时触发此事件
            const handleEditRequest = (e: Event) => {
                const detail = (e as CustomEvent).detail as { pos: number };
                const pos = getPos();
                if (typeof pos === 'number' && detail?.pos === pos) {
                    if (isEditing) hideEditor(); else showEditor();
                }
            };

            wrapper.addEventListener('click', handleClick);
            wrapper.addEventListener('dblclick', handleDblClick);
            window.addEventListener('math-edit-request', handleEditRequest);
            renderMath();

            return {
                dom: container,
                stopEvent: (event: Event) => {
                    if (!isEditing) return false;
                    if (event.type === 'mousedown') return false;
                    return true;
                },
                ignoreMutation: () => true,
                selectNode() {
                    container.classList.add('math-node-selected');
                    wrapper.classList.add('math-selected');
                },
                deselectNode() {
                    container.classList.remove('math-node-selected');
                    wrapper.classList.remove('math-selected');
                },
                update(updatedNode: any) {
                    if (updatedNode.type.name !== node.type.name) return false;
                    node = updatedNode;
                    wrapper.setAttribute('data-latex', node.attrs.latex);
                    renderMath();
                    return true;
                },
                destroy() {
                    wrapper.removeEventListener('click', handleClick);
                    wrapper.removeEventListener('dblclick', handleDblClick);
                    window.removeEventListener('math-edit-request', handleEditRequest);
                    cleanupBlockPanelListener();
                    if (editPanel) editPanel.remove();
                },
            };
        };
    },

    addStorage() {
        return {
            markdown: {
                serialize(state: any, node: any) {
                    const latex = node.attrs?.latex || '';
                    state.write(`$$\n${latex}\n$$`);
                    state.closeBlock(node);
                },
                parse: {
                    setup(this: any, markdownit: any) {
                        // 使用 markdown-it 块级规则将 $$...$$ 转换为 block-math div
                        markdownit.block.ruler.before('fence', 'block_math', (state: any, startLine: number, endLine: number, silent: boolean) => {
                            const startPos = state.bMarks[startLine] + state.tShift[startLine];
                            const maxPos = state.eMarks[startLine];
                            const lineText = state.src.slice(startPos, maxPos);

                            // 必须以 $$ 开头
                            if (!lineText.startsWith('$$')) return false;

                            // 情况1：单行 $$latex$$
                            if (lineText.length > 4 && lineText.endsWith('$$')) {
                                if (silent) return true;
                                const latex = lineText.slice(2, -2).trim();
                                const token = state.push('block_math', 'div', 0);
                                token.content = latex;
                                token.map = [startLine, startLine + 1];
                                state.line = startLine + 1;
                                return true;
                            }

                            // 情况2：多行——查找结束的 $$
                            let nextLine = startLine + 1;
                            while (nextLine < endLine) {
                                const nPos = state.bMarks[nextLine] + state.tShift[nextLine];
                                const nMax = state.eMarks[nextLine];
                                const nLine = state.src.slice(nPos, nMax).trim();
                                if (nLine === '$$') {
                                    break;
                                }
                                nextLine++;
                            }
                            if (nextLine >= endLine) return false;

                            if (silent) return true;

                            // 收集 $$ 行之间的内容
                            const contentLines: string[] = [];
                            for (let i = startLine + 1; i < nextLine; i++) {
                                const lPos = state.bMarks[i] + state.tShift[i];
                                const lMax = state.eMarks[i];
                                contentLines.push(state.src.slice(lPos, lMax));
                            }
                            const latex = contentLines.join('\n').trim();

                            const token = state.push('block_math', 'div', 0);
                            token.content = latex;
                            token.map = [startLine, nextLine + 1];
                            state.line = nextLine + 1;
                            return true;
                        });

                        markdownit.renderer.rules['block_math'] = (tokens: any[], idx: number) => {
                            const latex = tokens[idx].content;
                            return `<div data-type="block-math" data-latex="${escapeHtml(latex)}"></div>`;
                        };
                    },
                },
            },
        };
    },
});

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
