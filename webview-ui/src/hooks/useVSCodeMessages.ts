/**
 * 注册所有来自 VS Code 扩展宿主的消息处理器，集中管理消息分发逻辑。
 */
import { useEffect, useRef } from 'react';
import { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { updateTheme, getHighlighter, onHighlighterReady } from '../editor/code/codeHighlight';
import { updateImageUrls, sendToc, scrollToHeading } from '../editor/editorUtils';
import { getExportHtml } from '../editor/exportHtml';
import { postMessage, onMessage, setState, markHandlersReady } from '../vscode';
import type { PathCompletionItem } from '../editor/markdown/pathCompletion';
import { routeDomPathCompletionResult } from '../editor/shared/domPathCompletion';

interface UseVSCodeMessagesProps {
    editorRef: React.MutableRefObject<Editor | null>;
    lastMarkdownRef: React.MutableRefObject<string>;
    webviewChangeTimeoutRef: React.MutableRefObject<number | null>;
    suppressRef: React.MutableRefObject<boolean>;
    isInitialLoadRef: React.MutableRefObject<boolean>;
    pendingImageInsertRef: React.MutableRefObject<{ pos: number; replaceUploadBlock: boolean } | null>;
    pathCompRequestIdRef: React.MutableRefObject<string>;
    pathCompItemsRef: React.MutableRefObject<PathCompletionItem[]>;
    pathCompActiveIndexRef: React.MutableRefObject<number>;
    setPathCompItems: (items: PathCompletionItem[]) => void;
    setPathCompActiveIndex: (idx: number) => void;
    setPathCompVisible: (v: boolean) => void;
    applyPathCompletionRef: React.MutableRefObject<(item: PathCompletionItem) => void>;
    setEditorContent: (editor: Editor, text: string) => void;
}

export function useVSCodeMessages({
    editorRef,
    lastMarkdownRef,
    webviewChangeTimeoutRef,
    suppressRef,
    isInitialLoadRef,
    pendingImageInsertRef,
    pathCompRequestIdRef,
    pathCompItemsRef,
    pathCompActiveIndexRef,
    setPathCompItems,
    setPathCompActiveIndex,
    setPathCompVisible,
    applyPathCompletionRef,
    setEditorContent,
}: UseVSCodeMessagesProps) {

    useEffect(() => {
        const cleanups = [
            onMessage('documentChanged', (msg) => {
                const text = msg.text;
                // 始终持久化到状态，用于恢复
                setState({ text });
                if (!editorRef.current) {
                    lastMarkdownRef.current = text;
                    return;
                }
                // 若高亮器未就绪，延迟渲染直到就绪
                if (!getHighlighter()) {
                    lastMarkdownRef.current = text;
                    onHighlighterReady(() => {
                        const ed = editorRef.current;
                        if (ed && !ed.isDestroyed) setEditorContent(ed, text);
                    });
                    return;
                }
                setEditorContent(editorRef.current, text);
                lastMarkdownRef.current = text;
            }),

            onMessage('fontChanged', (msg) => {
                let fontFamily = msg.fontFamily || 'monospace';
                if (!fontFamily.trim()) fontFamily = 'monospace';
                let codeBlockFontFamily = msg.codeBlockFontFamily || msg.fontFamily || 'monospace';
                if (!codeBlockFontFamily.trim()) codeBlockFontFamily = 'monospace';

                // 计算 <pre> 的整数像素行高，避免小数行盒子产生 1px 高亮间隙
                const lhProp = getComputedStyle(document.documentElement)
                    .getPropertyValue('--pm-line-height').trim();
                const currentLineHeight = lhProp ? parseFloat(lhProp) : 1.5;
                const preLineHeight = Math.ceil(msg.fontSize * currentLineHeight);

                const styleEl = document.getElementById('font-size-style');
                if (styleEl) {
                    styleEl.textContent = `
            .ProseMirror { font-family: ${fontFamily} !important; font-size: ${msg.fontSize}px !important; }
            .ProseMirror code { font-family: ${codeBlockFontFamily} !important; }
            .ProseMirror :not(pre) > code { font-size: 0.9em !important; }
            .ProseMirror pre, .ProseMirror pre code { font-family: ${codeBlockFontFamily} !important; font-size: ${msg.fontSize}px !important; line-height: ${preLineHeight}px !important; }
          `;
                }
            }),

            onMessage('editorLayoutChanged', (msg) => {
                const layoutEl = document.getElementById('editor-layout-style');
                if (layoutEl) {
                    const maxW = msg.maxWidth || '100%';
                    const minW = typeof msg.minWidth === 'number'
                        ? `${msg.minWidth < 800 ? 800 : msg.minWidth > 1200 ? 1200 : msg.minWidth}px`
                        : (msg.minWidth || '800px');
                    const pad = typeof msg.padding === 'number'
                        ? `${msg.padding < 50 ? 50 : msg.padding > 100 ? 100 : msg.padding}px`
                        : (msg.padding || '50px');
                    layoutEl.textContent = `#editor { max-width: ${maxW}; min-width: ${minW}; margin: 0 auto; padding: 0 ${pad}; box-sizing: border-box; }`;
                }
                // 将行高作为 CSS 自定义属性传播
                if (msg.lineHeight) {
                    document.documentElement.style.setProperty('--pm-line-height', String(msg.lineHeight));
                    const lhEl = document.getElementById('line-height-style');
                    if (lhEl) {
                        lhEl.textContent = `.ProseMirror { line-height: ${msg.lineHeight} !important; }`;
                    }
                    // 同步 <pre> 的整数像素行高
                    const fontSizeStyleEl = document.getElementById('font-size-style');
                    if (fontSizeStyleEl) {
                        const proseMirrorEl = document.querySelector('.ProseMirror') as HTMLElement | null;
                        const currentFontSize = proseMirrorEl
                            ? parseFloat(getComputedStyle(proseMirrorEl).fontSize)
                            : NaN;
                        if (!isNaN(currentFontSize) && currentFontSize > 0) {
                            const preLineHeight = Math.ceil(currentFontSize * msg.lineHeight);
                            fontSizeStyleEl.textContent = fontSizeStyleEl.textContent!.replace(
                                /line-height:\s*[\d.]+px\s*!important/g,
                                `line-height: ${preLineHeight}px !important`,
                            );
                        }
                    }
                }
                // 更新节点间距
                const blockS = msg.blockSpacing || msg.inlineSpacing || msg.nodeSpacing;
                if (blockS) {
                    const spacingEl = document.getElementById('node-spacing-style');
                    if (spacingEl) {
                        const bS = blockS || '1.5em';
                        spacingEl.textContent = [
                            `.ProseMirror p { margin: ${bS} 0; }`,
                            `.ProseMirror ul, .ProseMirror ol { margin: 0; }`,
                            `.ProseMirror li { margin: 0; }`,
                            `.ProseMirror li > p { margin: 0; }`,
                            `.ProseMirror h1 { margin-top: calc(${bS} * 1.4); margin-bottom: calc(${bS} * 0.4); }`,
                            `.ProseMirror h2 { margin-top: calc(${bS} * 1.2); margin-bottom: calc(${bS} * 0.3); }`,
                            `.ProseMirror h3 { margin-top: ${bS}; margin-bottom: calc(${bS} * 0.2); }`,
                            `.ProseMirror blockquote { margin: ${bS} 0; }`,
                            `.ProseMirror pre { margin: ${bS} 0; }`,
                            `.ProseMirror hr { margin: ${bS} 0; }`,
                            `.ProseMirror .tableWrapper { margin: ${bS} 0; }`,
                            `.ProseMirror figure.image-resize-container { margin: ${bS} 0; }`,
                            `.ProseMirror .tiptap-mathematics-block-container { margin: ${bS} 0; }`,
                        ].join('\n');
                    }
                }
            }),

            onMessage('themeColorChanged', (msg) => {
                if (msg.themeKind) document.body.setAttribute('data-theme', msg.themeKind);
                if (msg.shikiTheme && typeof msg.shikiTheme === 'object') {
                    updateTheme(msg.shikiTheme, editorRef.current?.view);
                }
            }),

            onMessage('baseUriChanged', (msg) => {
                if (typeof msg.baseUri === 'string') {
                    (window as any).__imarkdownBaseUri = msg.baseUri;
                    if (editorRef.current) updateImageUrls(editorRef.current.view);
                }
            }),

            onMessage('insertImage', (msg) => {
                if (!editorRef.current || !msg.src) return;
                if (typeof msg.baseUri === 'string') {
                    (window as any).__imarkdownBaseUri = msg.baseUri;
                }
                const ed = editorRef.current;
                const { state, view } = ed;
                const { schema } = state;
                const imageType = schema.nodes.image;
                const paragraphType = schema.nodes.paragraph;
                if (!imageType || !paragraphType) return;

                const imageNode = imageType.create({ src: msg.src, alt: msg.altText || '' });
                const emptyPara = paragraphType.create();

                const pending = pendingImageInsertRef.current;
                pendingImageInsertRef.current = null;

                let insertPos: number;
                let tr = state.tr;

                if (pending?.replaceUploadBlock && pending.pos >= 0) {
                    const blockNode = state.doc.nodeAt(pending.pos);
                    if (blockNode && blockNode.type.name === 'imageUploadBlock') {
                        tr = tr.replaceWith(pending.pos, pending.pos + blockNode.nodeSize, [imageNode, emptyPara]);
                        insertPos = pending.pos;
                    } else {
                        const $anchor = state.selection.$anchor;
                        insertPos = $anchor.after($anchor.depth > 0 ? 1 : $anchor.depth);
                        insertPos = Math.min(insertPos, state.doc.content.size);
                        tr = tr.insert(insertPos, [imageNode, emptyPara]);
                    }
                } else {
                    insertPos = pending?.pos ?? (() => {
                        const $anchor = state.selection.$anchor;
                        return $anchor.after($anchor.depth > 0 ? 1 : $anchor.depth);
                    })();
                    insertPos = Math.min(insertPos, state.doc.content.size);
                    tr = tr.insert(insertPos, [imageNode, emptyPara]);
                }

                try {
                    tr.setSelection(Selection.near(tr.doc.resolve(insertPos + imageNode.nodeSize + 1)));
                } catch { /* 忽略位置越界 */ }
                view.dispatch(tr);
                view.focus();
                setTimeout(() => {
                    if (editorRef.current) updateImageUrls(editorRef.current.view);
                }, 50);
            }),

            onMessage('requestExportHtml', async () => {
                if (!editorRef.current) return;
                const html = await getExportHtml(editorRef.current);
                postMessage({ type: 'exportHtmlResponse', html });
            }),

            onMessage('requestCopyMarkdown', () => {
                const editor = editorRef.current;
                let md = lastMarkdownRef.current;
                if (editor) {
                    const { selection, doc } = editor.state;
                    const { from, to, empty } = selection;
                    if (!empty) {
                        try {
                            const storage = editor.storage as any;
                            const serializer = storage?.markdown?.serializer;
                            if (serializer) {
                                const slice = doc.slice(from, to, true);
                                md = serializer.serialize(slice.content).trim();
                            }
                        } catch {
                            // 任何错误均回退到整文档 Markdown
                        }
                    }
                }
                postMessage({ type: 'copyMarkdownResponse', markdown: md });
            }),

            onMessage('requestCopyPlainText', () => {
                const editor = editorRef.current;
                if (!editor) {
                    postMessage({ type: 'copyPlainTextResponse', text: '' });
                    return;
                }
                const { selection, doc } = editor.state;
                const { from, to, empty } = selection;
                // 选区为空时复制整篇文档纯文本
                const text = empty
                    ? doc.textBetween(0, doc.content.size, '\n', '\n')
                    : doc.textBetween(from, to, '\n', '\n');
                postMessage({ type: 'copyPlainTextResponse', text });
            }),

            onMessage('scrollToHeading', (msg) => {
                if (!editorRef.current || !msg.headingId) return;
                scrollToHeading(editorRef.current, msg.headingId);
            }),

            onMessage('requestTocRefresh', () => {
                if (editorRef.current) sendToc(editorRef.current);
            }),

            onMessage('pathCompletionResult', (msg) => {
                const items: PathCompletionItem[] = msg.items ?? [];
                // 优先路由到 DOM input 场景（link/image 面板输入框）
                if (routeDomPathCompletionResult(msg.requestId, items)) return;
                // 否则走 ProseMirror 编辑器场景
                if (msg.requestId !== pathCompRequestIdRef.current) return;
                setPathCompItems(items);
                setPathCompActiveIndex(0);
                setPathCompVisible(items.length > 0);
            }),

            onMessage('lineNumberConfigChanged', (msg) => {
                const show = !!msg.showLineNumbers;
                document.body.classList.toggle('show-line-numbers', show);
                const ed = editorRef.current;
                if (ed && !ed.isDestroyed && ed.view) {
                    const tr = ed.view.state.tr.setMeta('shikiUpdate', true);
                    ed.view.dispatch(tr);
                }
            }),
        ];

        markHandlersReady();
        // 所有处理器注册完毕后，通知扩展 webview 已就绪
        postMessage({ type: 'initialized' });

        return () => cleanups.forEach((fn) => fn());
    }, []);
}
