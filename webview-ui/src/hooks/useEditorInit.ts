/**
 * 负责创建和销毁 tiptap Editor 实例，注册编辑器事件监听器、
 * 窗口事件、ResizeObserver 以及初始内容加载。
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { Editor } from '@tiptap/core';
import { migrateMathStrings } from '@tiptap/extension-mathematics';
import { Extensions } from '@tiptap/core';
import { updateTheme, getPendingTheme, getHighlighter } from '../editor/code/codeHighlight';
import { updateImageUrls, sendToc } from '../editor/editorUtils';
import { postMessage, getState } from '../vscode';
import { broadcastAllPanelsClose } from '../editor/editorPanelHelper';
import { initDragAutoScroll } from '../editor/dragAutoScroll';

interface UseEditorInitResult {
    editor: Editor | null;
    editorRef: React.MutableRefObject<Editor | null>;
    suppressRef: React.MutableRefObject<boolean>;
    lastMarkdownRef: React.MutableRefObject<string>;
    webviewChangeTimeoutRef: React.MutableRefObject<number | null>;
    isInitialLoadRef: React.MutableRefObject<boolean>;
    pendingImageInsertRef: React.MutableRefObject<{ pos: number; replaceUploadBlock: boolean } | null>;
    setEditorContent: (editor: Editor, text: string) => void;
}

export function useEditorInit(extensions: Extensions): UseEditorInitResult {
    const [editor, setEditor] = useState<Editor | null>(null);
    const [, forceUpdate] = useState(0);

    const suppressRef = useRef(false);
    const lastMarkdownRef = useRef('');
    const webviewChangeTimeoutRef = useRef<number | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const isInitialLoadRef = useRef(true);
    // 异步图片插入（粘贴/工具栏上传）的待插入上下文
    const pendingImageInsertRef = useRef<{ pos: number; replaceUploadBlock: boolean } | null>(null);

    const setEditorContent = useCallback((ed: Editor, text: string) => {
        suppressRef.current = true;
        // 非首次加载时保存当前光标位置，供 setContent 后恢复
        const isInitial = isInitialLoadRef.current;
        const savedFrom = !isInitial ? ed.state.selection.from : null;
        ed.commands.setContent(text, { emitUpdate: false });
        migrateMathStrings(ed);
        // 非首次加载时恢复光标位置
        if (savedFrom != null) {
            const safePos = Math.min(savedFrom, ed.state.doc.content.size);
            ed.commands.setTextSelection(safePos);
        }
        suppressRef.current = false;
        lastMarkdownRef.current = text;

        isInitialLoadRef.current = false;

        requestAnimationFrame(() => {
            updateImageUrls(ed.view);
            if (ed.view && !ed.isDestroyed) {
                const tr = ed.view.state.tr.setMeta('shikiUpdate', true);
                ed.view.dispatch(tr);
            }
            if (isInitial && ed.view && !ed.isDestroyed) {
                document.body.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
            }
            // 标记内容已加载，允许显示占位符（防止启动时闪烁）
            document.body.setAttribute('data-content-ready', '1');
        });
        sendToc(ed);
    }, []);

    useEffect(() => {
        if (editorRef.current) return;
        const editorElement = document.querySelector('#editor');
        if (!editorElement) return;
        editorElement.innerHTML = '';

        const newEditor = new Editor({
            element: editorElement,
            extensions,
            content: '',
            autofocus: false,
        });

        // ── 编辑器事件处理 ──────────────────────────────────────────────────
        newEditor.on('update', () => {
            if (suppressRef.current) {
                suppressRef.current = false;
                return;
            }
            const storage = newEditor.storage as any;
            const rawMarkdown: string = storage?.markdown?.getMarkdown
                ? storage.markdown.getMarkdown()
                : newEditor.getText();

            // 立即更新 lastMarkdownRef，防抖发送 webviewChanged 消息
            lastMarkdownRef.current = rawMarkdown;
            if (webviewChangeTimeoutRef.current) {
                window.clearTimeout(webviewChangeTimeoutRef.current as any);
            }
            webviewChangeTimeoutRef.current = window.setTimeout(() => {
                postMessage({ type: 'webviewChanged', text: rawMarkdown });
                webviewChangeTimeoutRef.current = null;
            }, 300);
            forceUpdate((n) => n + 1);
            requestAnimationFrame(() => updateImageUrls(newEditor.view));
        });

        // 防抖 TOC 更新
        let tocTimer: ReturnType<typeof setTimeout> | null = null;
        newEditor.on('update', () => {
            if (tocTimer) clearTimeout(tocTimer);
            tocTimer = setTimeout(() => {
                tocTimer = null;
                sendToc(newEditor);
            }, 500);
        });

        newEditor.on('selectionUpdate', () => {
            forceUpdate((n) => n + 1);
        });

        // 图片 MutationObserver——防抖，避免每次按键都进行大量 DOM 扫描
        const root = newEditor.view?.dom;
        if (root) {
            let imageRafId = 0;
            const observer = new MutationObserver((mutations) => {
                const hasImageChange = mutations.some(m =>
                    m.type === 'childList' &&
                    (Array.from(m.addedNodes).some(n => n.nodeName === 'IMG' || (n as HTMLElement).querySelector?.('img')) ||
                     Array.from(m.removedNodes).some(n => n.nodeName === 'IMG' || (n as HTMLElement).querySelector?.('img')))
                );
                if (!hasImageChange) return;
                if (imageRafId) cancelAnimationFrame(imageRafId);
                imageRafId = requestAnimationFrame(() => {
                    imageRafId = 0;
                    updateImageUrls(newEditor.view);
                });
            });
            observer.observe(root, { childList: true, subtree: true });
        }

        editorRef.current = newEditor;
        setEditor(newEditor);

        // ── Ctrl+S 保存快捷键 ───────────────────────────────────────────────
        const handleCtrlS = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                // 先关闭所有打开的编辑面板（放弃未确认的修改）
                broadcastAllPanelsClose();
                if (webviewChangeTimeoutRef.current) {
                    window.clearTimeout(webviewChangeTimeoutRef.current as any);
                    webviewChangeTimeoutRef.current = null;
                }
                // 保存前删除所有空段落，保持编辑器状态与保存文件一致
                const ed = editorRef.current;
                if (ed && !ed.isDestroyed) {
                    const { doc, schema } = ed.state;
                    const emptyParaPositions: number[] = [];
                    doc.forEach((node, offset) => {
                        if (node.type === schema.nodes.paragraph && node.childCount === 0) {
                            emptyParaPositions.push(offset);
                        }
                    });
                    const keepCount = emptyParaPositions.length === doc.childCount ? 1 : 0;
                    const toDelete = emptyParaPositions.slice(0, emptyParaPositions.length - keepCount);
                    if (toDelete.length > 0) {
                        let tr = ed.state.tr;
                        for (let i = toDelete.length - 1; i >= 0; i--) {
                            const pos = toDelete[i];
                            const node = tr.doc.nodeAt(pos);
                            if (node) tr = tr.delete(pos, pos + node.nodeSize);
                        }
                        tr.setMeta('addToHistory', false);
                        ed.view.dispatch(tr);
                        const storage = ed.storage as any;
                        const rawMarkdown: string = storage?.markdown?.getMarkdown
                            ? storage.markdown.getMarkdown()
                            : ed.getText();
                        lastMarkdownRef.current = rawMarkdown;
                    }
                }
                postMessage({ type: 'webviewChanged', text: lastMarkdownRef.current });
            }
        };
        window.addEventListener('keydown', handleCtrlS, true);

        // ── 焦点/可见性监听 ─────────────────────────────────────────────────
        const requestDocRefresh = () => postMessage({ type: 'requestDocumentRefresh' });
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') requestDocRefresh();
        };
        window.addEventListener('focus', requestDocRefresh);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // 窗口重新获焦后修复过期指针光标
        const resetStaleCursor = () => {
            document.body.classList.add('reset-cursor');
            const clearReset = () => {
                document.body.classList.remove('reset-cursor');
                window.removeEventListener('mousemove', clearReset, true);
            };
            window.addEventListener('mousemove', clearReset, true);
        };
        window.addEventListener('focus', resetStaleCursor);

        // 滚动时隐藏拖拽手柄
        let scrollTimer: ReturnType<typeof setTimeout> | null = null;
        const handleScroll = () => {
            document.body.setAttribute('data-scrolling', '1');
            if (scrollTimer) clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                document.body.removeAttribute('data-scrolling');
                scrollTimer = null;
            }, 300);
        };
        window.addEventListener('scroll', handleScroll, true);

        // ── 工具栏宽度 & 高度同步 ────────────────────────────────────────────
        const editorEl = document.getElementById('editor');
        const toolbarWrapper = document.getElementById('toolbar-wrapper');
        let resizeObserver: ResizeObserver | null = null;
        if (editorEl && toolbarWrapper) {
            const syncToolbar = () => {
                const w = editorEl.offsetWidth;
                toolbarWrapper.style.setProperty('--toolbar-width', `${w}px`);
                const h = toolbarWrapper.offsetHeight;
                document.documentElement.style.setProperty('--toolbar-height', `${h}px`);
            };
            syncToolbar();
            resizeObserver = new ResizeObserver(syncToolbar);
            resizeObserver.observe(editorEl);
            resizeObserver.observe(toolbarWrapper);
        }

        // ── 初始内容加载 ────────────────────────────────────────────────────
        const cleanupDragAutoScroll = initDragAutoScroll();
        const pendingTheme = getPendingTheme();
        const loadContent = () => {
            const pendingText = lastMarkdownRef.current || getState()?.text;
            if (pendingText && !newEditor.isDestroyed) {
                setEditorContent(newEditor, pendingText);
            }
        };

        if (pendingTheme) {
            // 等待高亮器就绪后再加载内容，确保第一次渲染就应用语法高亮
            updateTheme(pendingTheme, newEditor.view).then(() => {
                loadContent();
                if (!newEditor.isDestroyed && newEditor.view) {
                    const tr = newEditor.view.state.tr.setMeta('shikiUpdate', true);
                    newEditor.view.dispatch(tr);
                }
            });
        } else {
            const restoredText = getState()?.text;
            if (restoredText && !getHighlighter()) {
                if (!lastMarkdownRef.current) lastMarkdownRef.current = restoredText;
                // 等待 documentChanged 通过 onHighlighterReady 延迟执行
            } else {
                loadContent();
            }
        }

        return () => {
            cleanupDragAutoScroll();
            window.removeEventListener('keydown', handleCtrlS, true);
            window.removeEventListener('focus', requestDocRefresh);
            window.removeEventListener('focus', resetStaleCursor);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('scroll', handleScroll, true);
            resizeObserver?.disconnect();
            newEditor.destroy();
            editorRef.current = null;
        };
    }, [extensions, setEditorContent]);

    return {
        editor,
        editorRef,
        suppressRef,
        lastMarkdownRef,
        webviewChangeTimeoutRef,
        isInitialLoadRef,
        pendingImageInsertRef,
        setEditorContent,
    };
}