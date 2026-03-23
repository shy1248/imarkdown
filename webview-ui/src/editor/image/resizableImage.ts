import { Image } from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { t } from '../../i18n';
import { generatePanelId, broadcastPanelOpen, onOtherPanelOpen, isPanelCancelKey, isPanelSaveKey, onAllPanelsClose } from '../editorPanelHelper';
import { PathCompleter } from '../shared/domPathCompletion';

export interface ImageResizeOptions {
    resolveImageUrl: (src: string) => string;
    onPasteImage: (dataUrl: string) => void;
}

export function resizableImage(options: ImageResizeOptions) {
    return Image.extend({
        // 将 image 设为块级节点，使其不与周围内容（标题、文本等）共享段落
        inline: false,
        group: 'block',

        // 禁用内置的 ![alt](url) inputRule——
        // 我们在 MarkdownImageInputRule（appendTransaction）中自行处理，
        // 以正确替换整个段落为块级图片节点 + 空段落。
        addInputRules() {
            return [];
        },

        parseHTML() {
            return [
                // 新格式：<figure class="image-block"><img /><figcaption>…</figcaption></figure>
                {
                    tag: 'figure.image-block',
                    getAttrs: (node: HTMLElement | string) => {
                        if (typeof node === 'string') return {};
                        const img = node.querySelector('img');
                        if (!img) return false;
                        // 优先使用 figcaption 文本作为 title；回退到 img 的 title 属性
                        const figcaption = node.querySelector('figcaption');
                        const captionText = figcaption?.textContent?.trim() || null;
                        return {
                            src: img.getAttribute('src'),
                            alt: img.getAttribute('alt'),
                            title: captionText || img.getAttribute('title'),
                            width: img.getAttribute('width') || img.style.width || null,
                            height: img.getAttribute('height') || img.style.height || null,
                        };
                    },
                },
                // 旧格式 / 内联粘贴格式：裸 <img src="...">
                { tag: 'img[src]' },
            ];
        },

        addAttributes() {
            return {
                ...this.parent?.(),
                width: {
                    default: null,
                    parseHTML: (element: HTMLElement) => element.getAttribute('width') || element.style.width || null,
                    renderHTML: (attributes: Record<string, any>) => {
                        if (!attributes.width) return {};
                        return {
                            width: attributes.width, style: `width: ${attributes.width}${String(attributes.width).includes('%')
                                || String(attributes.width).includes('px') ? '' : 'px'}`
                        };
                    },
                },
                height: {
                    default: null,
                    parseHTML: (element: HTMLElement) => element.getAttribute('height') || element.style.height || null,
                    renderHTML: (attributes: Record<string, any>) => {
                        if (!attributes.height) return {};
                        return {
                            height: attributes.height, style: `height: ${attributes.height}${String(attributes.height).includes('%')
                                || String(attributes.height).includes('px') ? '' : 'px'}`
                        };
                    },
                },
            };
        },

        addNodeView() {
            return ({ node, getPos, editor, selected }: any) => {
                const container = document.createElement('figure');
                container.classList.add('image-resize-container');
                // 阻止图片节点的原生拖拽——仅通过左侧拖拽手柄移动节点。
                // ProseMirror 在 NodeSelection 选中时会给 nodeDOM 设置
                // draggable="true" 并监听 dragstart，这里在捕获阶段拦截。
                container.addEventListener('dragstart', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }, true);

                // 图片 + 缩放手柄的容器
                const wrapper = document.createElement('div');
                wrapper.style.display = 'inline-block';
                wrapper.style.position = 'relative';
                wrapper.style.maxWidth = '100%';

                // 图片元素
                const img = document.createElement('img');
                let isDragging = false;
                let isSelected = !!selected;

                // figcaption——仅在设置了 title 时可见（只读展示）
                const figcaption = document.createElement('figcaption');
                figcaption.classList.add('image-caption');

                function updateCaption(n: any) {
                    const title = n.attrs.title || '';
                    figcaption.style.display = title ? '' : 'none';
                    if (figcaption.textContent !== title) figcaption.textContent = title;
                }

                function applySelectedStyle() {
                    img.style.boxShadow = isSelected
                        ? '0 0 0 1px var(--vscode-focusBorder)'
                        : 'none';
                }

                const updateImg = (n: any) => {
                    const src = options.resolveImageUrl(n.attrs.src);
                    if (src && img.src !== src) img.src = src;
                    if (n.attrs.alt) img.alt = n.attrs.alt;
                    else img.removeAttribute('alt');

                    // 拖拽期间跳过样式更新，避免冲突
                    if (!isDragging) {
                        if (n.attrs.width) {
                            const w = String(n.attrs.width);
                            const cssW = w.includes('%') || w.includes('px') ? w : w + 'px';
                            img.style.width = cssW;
                            wrapper.style.width = cssW;
                        } else {
                            img.style.width = '';
                            wrapper.style.width = '';
                        }
                        if (n.attrs.height) {
                            const h = String(n.attrs.height);
                            img.style.height = h.includes('%') || h.includes('px') ? h : h + 'px';
                        } else {
                            img.style.height = 'auto';
                        }
                    }
                    img.style.maxWidth = '100%';
                    img.style.display = 'block';
                    img.style.borderRadius = '4px';
                    img.style.cursor = 'default';
                    img.draggable = false;
                    applySelectedStyle();
                    updateCaption(n);
                };
                updateImg(node);

                // -----------------------------------------------------------
                // 内联编辑面板（双击 / 工具栏请求时显示）
                // 面板是 <figure> 容器内 wrapper/figcaption 的同级元素。
                // ignoreMutation() 告知 ProseMirror 忽略面板内的所有变更，
                // 使 <input> 中的输入不会导致 PM 重建节点。
                // -----------------------------------------------------------
                let isEditing = false;
                let editPanel: HTMLElement | null = null;
                // srcInput 路径补全实例（在 showEditor 中创建，hideEditor 中销毁）
                let _srcPathCompleter: PathCompleter | null = null;
                // 全局面板关闭监听器清理函数（在 showEditor 中注册，hideEditor 中销毁）
                let _cleanupAllPanelsClose: (() => void) | null = null;

                // 此 NodeView 实例的唯一 ID（用于互斥面板）
                const panelId = generatePanelId('image');
                // 监听器：当其他编辑面板打开时关闭本面板
                const cleanupPanelListener = onOtherPanelOpen(panelId, () => {
                    if (isEditing) hideEditor();
                });

                function showEditor() {
                    if (isEditing || !editor.isEditable) return;
                    // 通知其他面板关闭
                    broadcastPanelOpen(panelId);
                    isEditing = true;
                    // 监听全局面板关闭事件（由 Ctrl+S 保存逻辑触发）
                    _cleanupAllPanelsClose = onAllPanelsClose((skipFocus) => {
                        if (isEditing) hideEditor(skipFocus);
                    });

                    editPanel = document.createElement('div');
                    editPanel.classList.add('image-inline-edit');
                    // contentEditable=false：即使在 NodeView DOM 内部，
                    // PM 也不会将此子树视为可编辑文本。
                    editPanel.contentEditable = 'false';

                    // 辅助函数：标签 + 输入行
                    function makeField(labelText: string, value: string, placeholder: string): HTMLInputElement {
                        const field = document.createElement('div');
                        field.classList.add('inline-edit-field');
                        const lbl = document.createElement('label');
                        lbl.textContent = labelText;
                        const inp = document.createElement('input');
                        inp.type = 'text';
                        inp.classList.add('inline-edit-input');
                        inp.value = value || '';
                        inp.placeholder = placeholder;
                        field.appendChild(lbl);
                        field.appendChild(inp);
                        editPanel!.appendChild(field);
                        return inp;
                    }

                    const altInput   = makeField(t('image.edit.alt'),   node.attrs.alt   || '', t('image.edit.altPlaceholder'));
                    const srcInput   = makeField(t('image.edit.src'),   node.attrs.src   || '', t('image.edit.srcPlaceholder'));
                    const titleInput = makeField(t('image.edit.title'), node.attrs.title || '', t('image.edit.titlePlaceholder'));

                    // 按钮栏：✓  ✕  |  删除图片（最右侧）
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
                    deleteBtn.textContent = t('image.delete');
                    deleteBtn.title = t('image.delete');
                    deleteBtn.classList.add('inline-edit-btn', 'inline-edit-btn-unlink');
                    deleteBtn.style.marginLeft = 'auto';

                    btnBar.appendChild(applyBtn);
                    btnBar.appendChild(cancelBtn);
                    btnBar.appendChild(deleteBtn);
                    editPanel.appendChild(btnBar);

                    function applyEdit() {
                        const newSrc   = srcInput.value.trim();
                        const newAlt   = altInput.value.trim();
                        const newTitle = titleInput.value.trim() || null;
                        // 先关闭面板，使 update() 不再被守卫拦截
                        hideEditor();
                        if (typeof getPos === 'function') {
                            const pos = getPos();
                            if (pos != null) {
                                editor.chain().focus().command(({ tr }: any) => {
                                    tr.setNodeMarkup(pos, undefined, {
                                        ...node.attrs,
                                        src: newSrc || node.attrs.src,
                                        alt: newAlt || null,
                                        title: newTitle,
                                    });
                                    return true;
                                }).run();
                            }
                        }
                    }

                    function deleteImage() {
                        hideEditor();
                        if (typeof getPos === 'function') {
                            const pos = getPos();
                            if (pos != null) {
                                editor.chain().focus().command(({ tr }: any) => {
                                    tr.delete(pos, pos + node.nodeSize);
                                    return true;
                                }).run();
                            }
                        }
                    }

                    applyBtn.addEventListener('mousedown',  (e) => { e.preventDefault(); e.stopPropagation(); applyEdit(); });
                    cancelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); hideEditor(); });
                    deleteBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); deleteImage(); });

                    // -- srcInput 的路径补全（使用共用 PathCompleter）-------------------------
                    // PathCompleter 的 keydown 已在捕获阶段处理 ArrowUp/Down/Tab/Enter/Escape，
                    // 此处只需在补全 *不可见* 时处理 Enter/Escape 提交/取消表单。
                    // 通过 pathCompleter.isVisible 属性判断下拉框是否展示。
                    const pathCompleter = new PathCompleter(srcInput);
                    _srcPathCompleter = pathCompleter;

                    [altInput, srcInput, titleInput].forEach(inp => {
                        inp.addEventListener('keydown', (e: KeyboardEvent) => {
                            e.stopPropagation();
                            // 若路径补全下拉框可见，让 PathCompleter 的捕获阶段处理器优先；
                            // 此处只拦截补全不可见时的 Enter/Escape。
                            if (inp === srcInput && pathCompleter.isVisible) return;
                            if (isPanelCancelKey(e)) { e.preventDefault(); hideEditor(); }
                            else if (e.key === 'Enter')  { e.preventDefault(); applyEdit(); }
                            else if (isPanelSaveKey(e)) {
                                // Ctrl+S：关闭面板，不主动 focus 编辑器（skipFocus=true）
                                hideEditor(true);
                            }
                        });
                        // 额外守卫：防止任何 input 事件到达 PM
                        inp.addEventListener('input',            (e) => e.stopPropagation());
                        inp.addEventListener('keypress',         (e) => e.stopPropagation());
                        inp.addEventListener('compositionstart', (e) => e.stopPropagation());
                        inp.addEventListener('compositionend',   (e) => e.stopPropagation());
                        inp.addEventListener('beforeinput',      (e) => e.stopPropagation());
                    });

                    // 阻止 PM 指针事件到达面板
                    editPanel.addEventListener('mousedown', (e) => e.stopPropagation());
                    editPanel.addEventListener('click',     (e) => e.stopPropagation());

                    container.appendChild(editPanel);
                    setTimeout(() => { altInput.focus(); altInput.select(); }, 0);
                }

                function hideEditor(skipFocus = false) {
                    if (!isEditing) return;
                    isEditing = false;
                    // 销毁路径补全实例（会移除所有事件监听并删除下拉框 DOM）
                    _srcPathCompleter?.destroy();
                    _srcPathCompleter = null;
                    // 取消全局面板关闭监听
                    _cleanupAllPanelsClose?.();
                    _cleanupAllPanelsClose = null;
                    if (editPanel) { editPanel.remove(); editPanel = null; }
                    // Ctrl+S 路径（skipFocus=true）：不主动 focus，避免触发页面滚动
                    if (!skipFocus) editor.commands.focus();
                }

                // 监听工具栏 "image-edit-request"
                function handleEditRequest(e: Event) {
                    const detail = (e as CustomEvent).detail as { pos: number };
                    const pos = typeof getPos === 'function' ? getPos() : undefined;
                    if (typeof pos === 'number' && detail?.pos === pos) {
                        if (isEditing) hideEditor(); else showEditor();
                    }
                }
                window.addEventListener('image-edit-request', handleEditRequest);

                // -----------------------------------------------------------
                // 缩放手柄：右下角
                // -----------------------------------------------------------
                const handleCorner = document.createElement('div');
                handleCorner.classList.add('image-resize-handle', 'image-resize-handle-corner');

                let startX: number, startY: number, startW: number, startH: number;
                function setupResize(handle: HTMLElement) {
                    handle.addEventListener('mousedown', (e: MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startX = e.clientX;
                        startY = e.clientY;
                        startW = img.offsetWidth;
                        startH = img.offsetHeight;
                        isDragging = true;

                        const onMouseMove = (ev: MouseEvent) => {
                            if (!isDragging) return;
                            const newW = Math.max(60, startW + (ev.clientX - startX));
                            const newH = Math.max(40, startH + (ev.clientY - startY));
                            img.style.width = newW + 'px';
                            img.style.height = newH + 'px';
                            wrapper.style.width = newW + 'px';
                        };

                        const onMouseUp = (ev: MouseEvent) => {
                            document.removeEventListener('mousemove', onMouseMove);
                            document.removeEventListener('mouseup', onMouseUp);
                            document.removeEventListener('mouseleave', onMouseUp);
                            const finalW = Math.max(60, startW + (ev.clientX - startX));
                            const finalH = Math.max(40, startH + (ev.clientY - startY));
                            isDragging = false;
                            if (typeof getPos === 'function') {
                                const pos = getPos();
                                if (pos != null) {
                                    editor.chain().focus().command(({ tr }: any) => {
                                        const newAttrs: any = { ...node.attrs, width: finalW, height: finalH };
                                        tr.setNodeMarkup(pos, undefined, newAttrs);
                                        return true;
                                    }).run();
                                }
                            }
                        };
                        document.addEventListener('mousemove', onMouseMove);
                        document.addEventListener('mouseup', onMouseUp);
                        document.addEventListener('mouseleave', onMouseUp);
                    });
                }

                setupResize(handleCorner);

                // 单击 → NodeSelection
                img.addEventListener('click', (e: MouseEvent) => {
                    if (isDragging) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (isEditing) return;
                    if (typeof getPos === 'function') {
                        const pos = getPos();
                        if (pos != null) editor.commands.setNodeSelection(pos);
                    }
                });

                // 双击 → 打开编辑面板
                img.addEventListener('dblclick', (e: MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isEditing) hideEditor(); else showEditor();
                });

                wrapper.appendChild(img);
                wrapper.appendChild(handleCorner);
                container.appendChild(wrapper);
                container.appendChild(figcaption);
                return {
                    dom: container,
                    update(updatedNode: any) {
                        if (updatedNode.type.name !== 'image') return false;
                        updateImg(updatedNode);
                        node = updatedNode;
                        return true;
                    },
                    selectNode() {
                        isSelected = true;
                        applySelectedStyle();
                        // PM 的 NodeViewDesc.selectNode() 会在 nodeDOM 上设置
                        // draggable="true" 以支持节点拖放。我们不希望图片可拖拽：
                        // 这会破坏编辑面板 input 中的文本选择（浏览器会启动拖放手势）。
                        // 在 PM 设置后立即移除。
                        container.removeAttribute('draggable');
                    },
                    deselectNode() {
                        isSelected = false;
                        applySelectedStyle();
                        container.removeAttribute('draggable');
                    },
                    // 编辑面板打开时，拦截所有编辑器事件，
                    // 使 PM 无法处理按键/beforeinput 来删除或替换节点。
                    // 与数学 NodeView 的方式一致。
                    stopEvent(event: Event) {
                        if (!isEditing) return false;
                        // 放行 mousedown，使 NodeSelection 仍能生效
                        if (event.type === 'mousedown') return false;
                        return true;
                    },
                    // 忽略所有 DOM 变更——我们手动管理 DOM。
                    ignoreMutation: () => true,
                    destroy() {
                        if (editPanel) { editPanel.remove(); editPanel = null; }
                        window.removeEventListener('image-edit-request', handleEditRequest);
                        cleanupPanelListener();
                    },
                };
            };
        },

        renderHTML({ node, HTMLAttributes }: any) {
            const src = options.resolveImageUrl(node.attrs.src);
            // 渲染为 <figure class="image-block"><img />[<figcaption>…</figcaption>]</figure>
            const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { src });
            const children: any[] = [['img', attrs]];
            if (node.attrs.title) {
                children.push(['figcaption', { class: 'image-caption' }, node.attrs.title]);
            }
            return ['figure', { class: 'image-block' }, ...children];
        },

        // 覆盖 tiptap-markdown 的序列化器，使块级图片节点
        // 序列化时具有正确的块分隔。默认的 prosemirror-markdown
        // 图片序列化器只调用 state.write()（为内联图片设计），
        // 省略了尾部换行，导致下一个节点直接拼接在 ![](url) 之后。
        addStorage() {
            return {
                markdown: {
                    serialize(state: any, node: any) {
                        state.write(
                            '![' + state.esc(node.attrs.alt || '') + '](' +
                            (node.attrs.src || '').replace(/[\(\)]/g, '\\$&') +
                            (node.attrs.title ? ' "' + node.attrs.title.replace(/"/g, '\\"') + '"' : '') +
                            ')'
                        );
                        state.closeBlock(node);
                    },
                    parse: {
                        // 由 markdown-it 处理
                    },
                },
            };
        },

        addProseMirrorPlugins() {
            return [
                new Plugin({
                    key: new PluginKey('imagePaste'),
                    props: {
                        handlePaste(_, event) {
                            const items = event.clipboardData?.items;
                            if (!items) return false;

                            // 若剪贴板同时携带 text/html 或 text/plain
                            // （例如从 Word / 富文本编辑器复制），则图片项
                            // 只是渲染后的位图回退。让 Tiptap 的默认粘贴
                            // 处理器使用更丰富的文本内容。
                            let hasText = false;
                            for (let i = 0; i < items.length; i++) {
                                if (items[i].type === 'text/html' || items[i].type === 'text/plain') {
                                    hasText = true;
                                    break;
                                }
                            }
                            if (hasText) return false;

                            for (let i = 0; i < items.length; i++) {
                                const item = items[i];
                                if (item.type.startsWith('image/')) {
                                    event.preventDefault();
                                    const file = item.getAsFile();
                                    if (!file) continue;

                                    const reader = new FileReader();
                                    reader.onload = () => {
                                        const dataUrl = reader.result as string;
                                        options.onPasteImage(dataUrl);
                                    };
                                    reader.readAsDataURL(file);
                                    return true;
                                }
                            }
                            return false;
                        },
                        handleDrop(_, event) {
                            const files = event.dataTransfer?.files;
                            if (!files || files.length === 0) return false;

                            for (let i = 0; i < files.length; i++) {
                                const file = files[i];
                                if (file.type.startsWith('image/')) {
                                    event.preventDefault();
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                        const dataUrl = reader.result as string;
                                        options.onPasteImage(dataUrl);
                                    };
                                    reader.readAsDataURL(file);
                                    return true;
                                }
                            }
                            return false;
                        },
                    },
                }),
            ];
        },
    });
}
