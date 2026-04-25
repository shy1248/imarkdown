import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { t } from '../../i18n';
import { generatePanelId, broadcastPanelOpen, isPanelCancelKey, isPanelSaveKey, onAllPanelsClose } from '../editorPanelHelper';
import { PathCompleter } from '../shared/domPathCompletion';

export interface LinkInsertOptions {
    onInsert: (text: string, url: string) => void;
}

// ── 插件状态 ─────────────────────────────────────────────────────────────

interface LinkWidgetState {
    /** 文档中挂件锚点位置。null = 隐藏。 */
    anchor: number | null;
    /**
     * 设置后进入"setLink 模式"：存储原始选区范围。
     * 确认时对该范围应用 setLink，而非插入新文本。
     */
    selectionRange: { from: number; to: number } | null;
    /** 预填显示文本。在 setLink/编辑模式下为选中文本。 */
    prefillText: string;
    /** 预填 URL。在编辑已有链接时设置。 */
    prefillUrl: string;
}

export const LINK_WIDGET_KEY = new PluginKey<LinkWidgetState>('linkWidget');

// ── 挂件 DOM 构建 ────────────────────────────────────────────────────────────

function buildWidget(
    ws: LinkWidgetState,
    options: LinkInsertOptions,
    getEditor: () => import('@tiptap/core').Editor | null,
): Decoration {
    const wrap = document.createElement('span');
    wrap.contentEditable = 'false';
    wrap.style.display = 'block';

    const block = document.createElement('div');
    block.className = 'link-insert-block';
    block.setAttribute('data-link-insert', '');
    // 始终添加隔离类，确保样式不从父节点继承（下划线/粗体/斜体等）
    block.classList.add('link-insert-isolation');

    const icon = document.createElement('div');
    icon.className = 'link-insert-icon';
    icon.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>`;

    const form = document.createElement('div');
    form.className = 'link-insert-form';

    // 文本字段——在 setLink 模式下隐藏（选区已提供文本）
    const textGroup = document.createElement('div');
    textGroup.className = 'link-insert-field';
    const textLabel = document.createElement('label');
    textLabel.textContent = t('linkInsert.text');
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'link-insert-input';
    textInput.placeholder = t('linkInsert.textPlaceholder');
    textGroup.appendChild(textLabel);
    textGroup.appendChild(textInput);

    const urlGroup = document.createElement('div');
    urlGroup.className = 'link-insert-field';
    const urlLabel = document.createElement('label');
    urlLabel.textContent = t('linkInsert.url');
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'link-insert-input link-insert-input-url';
    urlInput.placeholder = t('linkInsert.urlPlaceholder');
    urlGroup.appendChild(urlLabel);
    urlGroup.appendChild(urlInput);

    form.appendChild(textGroup);
    form.appendChild(urlGroup);

    const actions = document.createElement('div');
    actions.className = 'link-insert-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'inline-edit-btn inline-edit-btn-apply';
    confirmBtn.textContent = '✓';
    confirmBtn.title = t('Confirm (Enter)');

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'inline-edit-btn inline-edit-btn-cancel';
    cancelBtn.textContent = '✕';
    cancelBtn.title = t('Cancel (Esc)');

    // "移除链接"按钮——仅在编辑已有链接时显示
    const unlinkBtn = document.createElement('button');
    unlinkBtn.type = 'button';
    unlinkBtn.className = 'inline-edit-btn inline-edit-btn-unlink';
    unlinkBtn.textContent = t('linkInsert.unlink');
    unlinkBtn.title = t('linkInsert.unlink');

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);

    const body = document.createElement('div');
    body.className = 'link-insert-body';
    body.appendChild(icon);
    body.appendChild(form);
    body.appendChild(actions);
    block.appendChild(body);
    wrap.appendChild(block);

    // ── 模式初始化 ──────────────────────────────────────────────────────────
    // isSetLinkMode：存在文本选区 → 对其应用/更新链接标记
    const isSetLinkMode = !!ws.selectionRange;
    // isEditMode：编辑已有链接（同时有 selectionRange 和 prefillUrl）
    const isEditMode = isSetLinkMode && !!ws.prefillUrl;

    // 文本输入框始终显示；有选区时预填充
    if (ws.prefillText) {
        textInput.value = ws.prefillText;
    }
    if (ws.prefillUrl) {
        urlInput.value = ws.prefillUrl;
    }

    // 仅在编辑已有链接时显示"移除链接"按钮
    if (isEditMode) {
        actions.appendChild(unlinkBtn);
    }

    // ── 事件处理 ────────────────────────────────────────────────────────────
    const closeWidget = () => {
        const editor = getEditor();
        if (!editor) return;
        document.body.classList.remove('link-widget-open');
        editor.view.dispatch(
            editor.view.state.tr.setMeta(LINK_WIDGET_KEY, { type: 'close' }),
        );
    };

    const doConfirm = () => {
        const url = urlInput.value.trim();
        if (!url) { urlInput.focus(); return; }

        const editor = getEditor();
        if (!editor) return;

        closeWidget();

        if (isSetLinkMode && ws.selectionRange) {
            // 对原始选区应用/更新链接标记。
            // 如果用户修改了显示文本，先替换选区文本。
            const { from, to } = ws.selectionRange;
            const newText = textInput.value.trim();
            const originalText = ws.prefillText;
            if (newText && newText !== originalText) {
                // 替换文本后，对新范围应用链接标记
                editor.chain()
                    .focus()
                    .setTextSelection({ from, to })
                    .insertContent(newText)
                    .setTextSelection({ from, to: from + newText.length })
                    .setLink({ href: url })
                    .run();
            } else {
                editor.chain()
                    .focus()
                    .setTextSelection({ from, to })
                    .setLink({ href: url })
                    .run();
            }
        } else {
            const text = textInput.value.trim() || url;
            options.onInsert(text, url);
        }
    };

    const doCancel = (skipFocus = false) => {
        const editor = getEditor();
        if (!editor) return;
        closeWidget();
        // Ctrl+S 路径（skipFocus=true）：不主动 focus/setTextSelection，
        // 避免 focus() 触发的 scrollIntoView 导致页面跳转。
        if (!skipFocus) {
            if (isSetLinkMode && ws.selectionRange) {
                editor.chain().focus().setTextSelection(ws.selectionRange).run();
            } else {
                editor.commands.focus();
            }
        }
    };

    const doUnlink = () => {
        const editor = getEditor();
        if (!editor || !ws.selectionRange) return;
        closeWidget();
        const { from, to } = ws.selectionRange;
        editor.chain()
            .focus()
            .setTextSelection({ from, to })
            .unsetLink()
            .run();
    };

    confirmBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation(); doConfirm();
    });
    cancelBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation(); doCancel();
    });
    unlinkBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation(); doUnlink();
    });

    // ── 路径补全 ──────────────────────────────────────────────────────────
    const pathCompleter = new PathCompleter(urlInput);

    // 监听全局面板关闭事件（由 Ctrl+S 保存逻辑触发）
    const cleanupAllPanelsClose = onAllPanelsClose((skipFocus) => doCancel(skipFocus));

    const handleKeyDown = (e: KeyboardEvent) => {
        // 若路径补全下拉框可见，让 PathCompleter 的捕获阶段处理器优先；
        // 此处只拦截补全不可见时的 Enter/Escape。
        if (e.target === urlInput && pathCompleter.isVisible) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); e.stopPropagation(); doConfirm();
        } else if (isPanelCancelKey(e)) {
            // Escape 或 Ctrl+Z：取消并关闭面板
            e.preventDefault(); e.stopPropagation(); doCancel();
        } else if (isPanelSaveKey(e)) {
            // Ctrl+S：关闭面板放弃修改，不主动 focus（skipFocus=true），
            // 不阻止事件传播以便保存逻辑继续
            doCancel(true);
        }
    };
    textInput.addEventListener('keydown', handleKeyDown);
    urlInput.addEventListener('keydown', handleKeyDown);

    // 自动聚焦：
    // - 无选区（纯插入）：聚焦文本输入框，让用户输入链接标签
    // - 有选区（设置/编辑链接）：聚焦 URL 输入框（文本已预填）
    requestAnimationFrame(() => {
        // 标记 body，让 CSS 在链接挂件获焦时隐藏编辑器光标。
        // 在 closeWidget() 中移除。
        document.body.classList.add('link-widget-open');
        if (isSetLinkMode || ws.prefillText) {
            urlInput.focus();
        } else {
            textInput.focus();
        }
    });

    return Decoration.widget(ws.anchor!, wrap, {
        side: 1,
        stopEvent: () => true,
        key: 'link-widget',
        destroy: () => {
            pathCompleter.destroy();
            cleanupAllPanelsClose();
        },
    });
}

// ── Tiptap 扩展 ──────────────────────────────────────────────────────────────

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        linkInsertWidget: {
            /** 在当前光标位置打开链接插入面板（无选区） */
            insertLinkBlock: (prefillText?: string) => ReturnType;
            /**
             * 为没有现有链接的文本选区打开链接插入面板。
             * 选中文本预填为链接标签；焦点落在 URL 输入框。
             */
            insertLinkBlockForSelection: () => ReturnType;
            /**
             * 为已含链接的选区以编辑模式打开链接插入面板。
             * 显示文本和已有 URL 均预填。
             */
            insertLinkBlockForEdit: (prefillUrl: string) => ReturnType;
        };
    }
}

export function linkInsert(options: LinkInsertOptions) {
    let _editor: import('@tiptap/core').Editor | null = null;

    // ── 互斥状态（在所有 buildWidget 调用间共享）─────────
    let _linkPanelId: string | null = null;
    const handleOtherPanelOpen = (e: Event) => {
        if (!_linkPanelId) return;
        if ((e as CustomEvent).detail?.id !== _linkPanelId) {
            // 其他面板已打开——关闭链接挂件
            if (_editor) {
                document.body.classList.remove('link-widget-open');
                _editor.view.dispatch(
                    _editor.view.state.tr.setMeta(LINK_WIDGET_KEY, { type: 'close' }),
                );
            }
            _linkPanelId = null;
        }
    };
    window.addEventListener('editor-panel-open', handleOtherPanelOpen);

    // 监听全局面板关闭事件（由 Ctrl+S 保存逻辑触发）——
    // 作为 buildWidget 内部 onAllPanelsClose 的补充安全网
    const handleAllPanelsClose = () => {
        if (!_linkPanelId) return;
        if (_editor) {
            document.body.classList.remove('link-widget-open');
            _editor.view.dispatch(
                _editor.view.state.tr.setMeta(LINK_WIDGET_KEY, { type: 'close' }),
            );
        }
        _linkPanelId = null;
    };
    window.addEventListener('editor-panels-close-all', handleAllPanelsClose);

    /**
     * 仅在链接挂件首次打开时调用（而非每次 decorations() 求值时调用）。
     * 生成新的 panelId 并广播 editor-panel-open 事件，使其他面板关闭。
     */
    function broadcastLinkPanelOpen() {
        _linkPanelId = generatePanelId('link');
        broadcastPanelOpen(_linkPanelId);
    }

    return Extension.create({
        name: 'linkInsertWidget',

        onBeforeCreate() {
            _editor = this.editor;
        },

        addCommands() {
            return {
                insertLinkBlock:
                    (prefillText = '') =>
                        ({ view }: { view: import('@tiptap/pm/view').EditorView }) => {
                            const anchor = view.state.selection.to;
                            broadcastLinkPanelOpen();
                            view.dispatch(
                                view.state.tr.setMeta(LINK_WIDGET_KEY, {
                                    type: 'open',
                                    anchor,
                                    selectionRange: null,
                                    prefillText,
                                    prefillUrl: '',
                                }),
                            );
                            return true;
                        },

                insertLinkBlockForSelection:
                    () =>
                        ({ view }: { view: import('@tiptap/pm/view').EditorView }) => {
                            const { from, to, empty } = view.state.selection;
                            if (empty) return false;
                            // 提取选区的纯文本作为预填标签
                            const selectedText = view.state.doc.textBetween(from, to, ' ');
                            broadcastLinkPanelOpen();
                            view.dispatch(
                                view.state.tr.setMeta(LINK_WIDGET_KEY, {
                                    type: 'open',
                                    anchor: to,
                                    selectionRange: { from, to },
                                    prefillText: selectedText,
                                    prefillUrl: '',
                                }),
                            );
                            return true;
                        },

                insertLinkBlockForEdit:
                    (prefillUrl: string) =>
                        ({ view }: { view: import('@tiptap/pm/view').EditorView }) => {
                            const { from, to, empty } = view.state.selection;
                            if (empty) return false;
                            const selectedText = view.state.doc.textBetween(from, to, ' ');
                            broadcastLinkPanelOpen();
                            view.dispatch(
                                view.state.tr.setMeta(LINK_WIDGET_KEY, {
                                    type: 'open',
                                    anchor: to,
                                    selectionRange: { from, to },
                                    prefillText: selectedText,
                                    prefillUrl,
                                }),
                            );
                            return true;
                        },
            };
        },

        addProseMirrorPlugins() {
            return [
                new Plugin({
                    key: LINK_WIDGET_KEY,

                    state: {
                        init(): LinkWidgetState {
                            return { anchor: null, selectionRange: null, prefillText: '', prefillUrl: '' };
                        },
                        apply(tr, prev): LinkWidgetState {
                            const meta = tr.getMeta(LINK_WIDGET_KEY);
                            if (!meta) {
                                if (prev.anchor != null) {
                                    const mapped = tr.mapping.map(prev.anchor);
                                    const mappedRange = prev.selectionRange
                                        ? {
                                            from: tr.mapping.map(prev.selectionRange.from),
                                            to: tr.mapping.map(prev.selectionRange.to),
                                        }
                                        : null;
                                    return { ...prev, anchor: mapped, selectionRange: mappedRange };
                                }
                                return prev;
                            }
                            if (meta.type === 'close') {
                                _linkPanelId = null;
                                return { anchor: null, selectionRange: null, prefillText: '', prefillUrl: '' };
                            }
                            if (meta.type === 'open') {
                                return {
                                    anchor: meta.anchor,
                                    selectionRange: meta.selectionRange ?? null,
                                    prefillText: meta.prefillText ?? '',
                                    prefillUrl: meta.prefillUrl ?? '',
                                };
                            }
                            return prev;
                        },
                    },

                    props: {
                        handleDOMEvents: {
                            dblclick(view, event) {
                                if (!_editor || !_editor.isEditable) return false;
                                // 解析指针下方的文档位置
                                const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                                if (!pos) return false;
                                const $pos = view.state.doc.resolve(pos.pos);
                                // 检查该位置是否带有链接标记
                                const linkType = view.state.schema.marks.link;
                                if (!linkType) return false;
                                const marks = $pos.marks();
                                const linkMark = marks.find(m => m.type === linkType);
                                if (!linkMark) return false;

                                // 找到链接标记——确定携带同一链接（相同 href）的完整连续范围
                                const parent = $pos.parent;
                                const parentOffset = $pos.parentOffset;
                                const blockStart = $pos.start(); // 文本块的绝对起始位置

                                // 收集同一链接的连续片段
                                let linkFrom = -1;
                                let linkTo = -1;
                                let runStart = -1;
                                let runEnd = -1;
                                const href = linkMark.attrs.href;
                                const hasLink = (child: any) =>
                                    child.isText && child.marks.some((m: any) => m.type === linkType && m.attrs.href === href);

                                parent.forEach((child, childOffset) => {
                                    if (hasLink(child)) {
                                        if (runStart < 0) runStart = childOffset;
                                        runEnd = childOffset + child.nodeSize;
                                    } else {
                                        // 片段结束——检查点击是否在其中
                                        if (runStart >= 0 && parentOffset >= runStart && parentOffset < runEnd) {
                                            linkFrom = blockStart + runStart;
                                            linkTo = blockStart + runEnd;
                                        }
                                        runStart = -1;
                                        runEnd = -1;
                                    }
                                });
                                // 检查最后一个片段
                                if (runStart >= 0 && parentOffset >= runStart && parentOffset <= runEnd) {
                                    linkFrom = blockStart + runStart;
                                    linkTo = blockStart + runEnd;
                                }

                                if (linkFrom < 0 || linkTo < 0) return false;

                                event.preventDefault();
                                event.stopPropagation();

                                // 切换：若链接挂件已打开则关闭
                                const ps = LINK_WIDGET_KEY.getState(view.state);
                                if (ps && ps.anchor != null) {
                                    document.body.classList.remove('link-widget-open');
                                    view.dispatch(
                                        view.state.tr.setMeta(LINK_WIDGET_KEY, { type: 'close' }),
                                    );
                                    _linkPanelId = null;
                                    return true;
                                }

                                // 以编辑模式打开：选中链接文本并预填 URL
                                const selectedText = view.state.doc.textBetween(linkFrom, linkTo, ' ');
                                broadcastLinkPanelOpen();
                                view.dispatch(
                                    view.state.tr.setMeta(LINK_WIDGET_KEY, {
                                        type: 'open',
                                        anchor: linkTo,
                                        selectionRange: { from: linkFrom, to: linkTo },
                                        prefillText: selectedText,
                                        prefillUrl: href,
                                    }),
                                );
                                return true;
                            },
                        },
                        decorations(state) {
                            const ps = LINK_WIDGET_KEY.getState(state);
                            if (!ps || ps.anchor == null) return DecorationSet.empty;
                            const deco = buildWidget(ps, options, () => _editor);
                            return DecorationSet.create(state.doc, [deco]);
                        },
                    },
                }),
            ];
        },
    });
}

// ── 工具函数 ───────────────────────────────────────────────────────────────────

/**
 * 若当前选区包含至少一个链接标记则返回 true。
 */
export function selectionHasLink(editor: import('@tiptap/core').Editor): boolean {
    const { state } = editor;
    const { from, to, empty } = state.selection;
    if (empty) return editor.isActive('link');
    let found = false;
    state.doc.nodesBetween(from, to, (node) => {
        if (found) return false;
        if (node.marks.some(m => m.type.name === 'link')) {
            found = true;
            return false;
        }
    });
    return found;
}