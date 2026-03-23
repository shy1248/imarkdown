import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DragHandle from '@tiptap/extension-drag-handle-react'
import { TextSelection } from '@tiptap/pm/state';
import { createExtensions } from './editor/editorExtensions';
import { SlashMenu } from './components/SlashMenu';
import { PathCompletionMenu } from './components/PathCompletionMenu';
import { Toolbar } from './components/Toolbar';
import { EmojiPicker } from './components/EmojiPicker';
import { filterSlashCommands, SlashCommandCallbacks } from './editor/slashAction';
import type { PathCompletionCallbacks, PathCompletionItem } from './editor/markdown/pathCompletion';
import { registerDomPathCompletionBridge } from './editor/shared/domPathCompletion';
import { runEditorCommand } from './editor/editorCommands';
import { useEditorInit } from './hooks/useEditorInit';
import { useVSCodeMessages } from './hooks/useVSCodeMessages';
import { useDragHandle } from './hooks/useDragHandle';
import { t } from './i18n';
import { postMessage } from './vscode';
import { resolveImageUrl } from './editor/editorUtils';

import './styles/editor.css';
import './styles/toolbar.css';
import './styles/slash.css';
import './styles/link.css';
import './styles/image.css';
import './styles/table.css';
import './styles/code.css';
import './styles/math.css';
import 'katex/dist/katex.min.css';
import './styles/emoji.css';
import './styles/search.css';
import './styles/drag.css';


export default function App() {
    // ── Emoji 选择器状态 ──────────────────────────────────────────────────────
    const [emojiPickerAnchor, setEmojiPickerAnchor] = useState<DOMRect | null>(null);
    const emojiPickerAnchorRef = useRef<DOMRect | null>(null);
    const setEmojiAnchor = useCallback((rect: DOMRect | null) => {
        emojiPickerAnchorRef.current = rect;
        setEmojiPickerAnchor(rect);
    }, []);

    // ── 斜杠命令菜单状态 ──────────────────────────────────────────────────────
    const [slashVisible, setSlashVisible] = useState(false);
    const [slashQuery, setSlashQuery] = useState('');
    const [slashCoords, setSlashCoords] = useState<{ left: number; top: number; bottom: number } | null>(null);
    const [slashActiveIndex, setSlashActiveIndex] = useState(0);
    const slashRangeRef = useRef<{ from: number; to: number } | null>(null);
    // 使用 ref，确保 ProseMirror 插件回调始终访问最新状态
    const slashVisibleRef = useRef(false);
    const slashQueryRef = useRef('');
    const slashActiveIndexRef = useRef(0);
    useEffect(() => { slashVisibleRef.current = slashVisible; }, [slashVisible]);
    useEffect(() => { slashQueryRef.current = slashQuery; }, [slashQuery]);
    useEffect(() => { slashActiveIndexRef.current = slashActiveIndex; }, [slashActiveIndex]);
    // 稳定的 executeSlashCommand ref
    const executeSlashCommandRef = useRef<(id: string) => void>(() => { });
    // 斜杠命令回调，只创建一次，始终通过 ref 读取最新状态
    const slashCallbacks = useMemo<SlashCommandCallbacks>(() => ({
        onShow: (coords, query) => {
            setSlashCoords(coords);
            setSlashQuery(query);
            setSlashActiveIndex(0);
            setSlashVisible(true);
        },
        onHide: () => {
            setSlashVisible(false);
            slashRangeRef.current = null;
        },
        onUpdate: (query) => {
            setSlashQuery(query);
            setSlashActiveIndex(0);
        },
        onUpdateCoords: (coords) => {
            setSlashCoords(coords);
        },
        onNavigate: (direction) => {
            setSlashActiveIndex((prev) => {
                const items = filterSlashCommands(slashQueryRef.current);
                if (items.length === 0) return 0;
                return (prev + direction + items.length) % items.length;
            });
        },
        onConfirm: () => {
            const items = filterSlashCommands(slashQueryRef.current);
            if (items.length > 0 && slashActiveIndexRef.current < items.length) {
                executeSlashCommandRef.current(items[slashActiveIndexRef.current].id);
            }
        },
        isVisible: () => slashVisibleRef.current,
        getRange: () => slashRangeRef.current,
        setRange: (range) => { slashRangeRef.current = range; },
    }), []);

    // ── 路径补全状态 ──────────────────────────────────────────────────────────
    const [pathCompVisible, setPathCompVisible] = useState(false);
    const [pathCompItems, setPathCompItems] = useState<PathCompletionItem[]>([]);
    const [pathCompCoords, setPathCompCoords] = useState<{ left: number; top: number; bottom: number } | null>(null);
    const [pathCompActiveIndex, setPathCompActiveIndex] = useState(0);
    const pathCompRangeRef = useRef<{ from: number; to: number } | null>(null);
    const pathCompVisibleRef = useRef(false);
    const pathCompActiveIndexRef = useRef(0);
    const pathCompItemsRef = useRef<PathCompletionItem[]>([]);
    // 保存待处理的 requestId，用于丢弃过期响应
    const pathCompRequestIdRef = useRef('');
    useEffect(() => { pathCompVisibleRef.current = pathCompVisible; }, [pathCompVisible]);
    useEffect(() => { pathCompActiveIndexRef.current = pathCompActiveIndex; }, [pathCompActiveIndex]);
    useEffect(() => { pathCompItemsRef.current = pathCompItems; }, [pathCompItems]);

    // applyPathCompletion 的稳定 ref（避免 pathCompCallbacks 中的旧闭包）
    const applyPathCompletionRef = useRef<(item: PathCompletionItem) => void>(() => { });
    // DOM input 场景下的 apply 回调（由桥接注册，优先于 PM 场景）
    const pathCompInputApplyRef = useRef<((item: PathCompletionItem) => void) | null>(null);

    // 供 ProseMirror 插件使用的稳定回调
    const pathCompCallbacks = useMemo<PathCompletionCallbacks>(() => ({
        onShow: (coords, prefix) => {
            const id = `pc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            pathCompRequestIdRef.current = id;
            setPathCompCoords(coords);
            setPathCompItems([]);
            setPathCompActiveIndex(0);
            setPathCompVisible(false);
            postMessage({ type: 'requestPathCompletion', prefix, requestId: id });
        },
        onHide: () => {
            setPathCompVisible(false);
            pathCompRangeRef.current = null;
            pathCompRequestIdRef.current = '';
            pathCompInputApplyRef.current = null;
        },
        onUpdate: (coords, prefix) => {
            const id = `pc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            pathCompRequestIdRef.current = id;
            setPathCompCoords(coords);
            setPathCompActiveIndex(0);
            postMessage({ type: 'requestPathCompletion', prefix, requestId: id });
        },
        onNavigate: (direction) => {
            setPathCompActiveIndex((prev) => {
                const len = pathCompItemsRef.current.length;
                if (len === 0) return 0;
                return (prev + direction + len) % len;
            });
        },
        onConfirm: () => {
            const items = pathCompItemsRef.current;
            const idx = pathCompActiveIndexRef.current;
            if (items.length === 0) return;
            const item = idx >= 0 && idx < items.length ? items[idx] : items[0];
            applyPathCompletionRef.current(item);
        },
        isVisible: () => pathCompVisibleRef.current,
        getRange: () => pathCompRangeRef.current,
        setRange: (range) => { pathCompRangeRef.current = range; },
    }), []);

    // ── 扩展（只创建一次，避免重复初始化） ────────────────────────────────────
    const { extensions } = useMemo(() => createExtensions({
        resolveImageUrl,
        slashCallbacks,
        pathCompletionCallbacks: pathCompCallbacks,
        onPasteImage: (dataUrl: string) => {
            const ed = editorRef.current;
            if (ed) {
                const $anchor = ed.state.selection.$anchor;
                pendingImageInsertRef.current = {
                    pos: $anchor.after($anchor.depth > 0 ? 1 : $anchor.depth),
                    replaceUploadBlock: false,
                };
            }
            postMessage({ type: 'pasteImage', dataUrl });
        },
        onUploadImages: (files: File[], uploadBlockPos: number) => {
            pendingImageInsertRef.current = {
                pos: uploadBlockPos,
                replaceUploadBlock: uploadBlockPos >= 0,
            };
            for (const file of files) {
                const reader = new FileReader();
                reader.onload = () => {
                    postMessage({ type: 'pasteImage', dataUrl: reader.result as string });
                };
                reader.readAsDataURL(file);
            }
        },
        onInsertLink: (text: string, url: string) => {
            const ed = editorRef.current;
            if (!ed || !url) return;
            ed.chain().focus().insertContent({
                type: 'text',
                text: text || url,
                marks: [{ type: 'link', attrs: { href: url } }],
            }).run();
        },
    }), []);

    // ── 编辑器初始化 ──────────────────────────────────────────────────────────
    const {
        editor,
        editorRef,
        suppressRef,
        lastMarkdownRef,
        webviewChangeTimeoutRef,
        isInitialLoadRef,
        pendingImageInsertRef,
        setEditorContent,
    } = useEditorInit(extensions);

    // ── VS Code 消息处理 ──────────────────────────────────────────────────────
    useVSCodeMessages({
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
    });

    // ── 拖拽手柄 ──────────────────────────────────────────────────────────────
    const { dragNodePosRef, dragComputePositionConfig, onDragNodeChange } = useDragHandle(editorRef);

    // ── DOM input 路径补全桥接（供 PathCompleter 通过桥接驱动 React 菜单）────
    useEffect(() => {
        return registerDomPathCompletionBridge({
            show(coords, items, onApply) {
                // 记录本次补全的 apply 回调（写回 input.value）
                pathCompInputApplyRef.current = onApply;
                setPathCompCoords(coords);
                setPathCompItems(items);
                setPathCompActiveIndex(0);
                setPathCompVisible(true);
            },
            hide() {
                setPathCompVisible(false);
                pathCompInputApplyRef.current = null;
            },
            isVisible() {
                return pathCompVisibleRef.current;
            },
            navigate(direction) {
                setPathCompActiveIndex((prev) => {
                    const len = pathCompItemsRef.current.length;
                    if (len === 0) return 0;
                    return (prev + direction + len) % len;
                });
            },
            confirm() {
                const items = pathCompItemsRef.current;
                const idx = pathCompActiveIndexRef.current;
                if (items.length === 0) return;
                const item = idx >= 0 && idx < items.length ? items[idx] : items[0];
                applyPathCompletionRef.current(item);
            },
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── 斜杠命令执行 ──────────────────────────────────────────────────────────
    const executeSlashCommand = useCallback((cmdId: string) => {
        const ed = editorRef.current;
        const range = slashRangeRef.current;
        if (!ed || !range) return;
        ed.chain().focus().deleteRange(range).run();
        setSlashVisible(false);
        slashRangeRef.current = null;
        runEditorCommand(ed, cmdId, { emojiPickerAnchorRef, setEmojiAnchor });
    }, [setEmojiAnchor]);
    useEffect(() => { executeSlashCommandRef.current = executeSlashCommand; }, [executeSlashCommand]);

    // ── 路径补全应用 ──────────────────────────────────────────────────────────
    const applyPathCompletion = useCallback((item: PathCompletionItem) => {
        // DOM input 场景（link/image 面板输入框）：写回 input.value
        if (pathCompInputApplyRef.current) {
            pathCompInputApplyRef.current(item);
            return;
        }
        // ProseMirror 编辑器场景：写入文档
        const ed = editorRef.current;
        const range = pathCompRangeRef.current;
        if (!ed || !range) return;
        ed.chain().focus().deleteRange(range).insertContent({ type: 'text', text: item.label }).run();
        if (!item.isDir) {
            setPathCompVisible(false);
            pathCompRangeRef.current = null;
        }
    }, []);
    useEffect(() => { applyPathCompletionRef.current = applyPathCompletion; }, [applyPathCompletion]);

    // ── 工具栏命令执行 ────────────────────────────────────────────────────────
    const executeToolbarCommand = useCallback((cmdId: string) => {
        const ed = editorRef.current;
        if (!ed) return;
        if (cmdId !== 'emoji') ed.chain().focus().run();
        runEditorCommand(ed, cmdId, { emojiPickerAnchorRef, setEmojiAnchor });
    }, [setEmojiAnchor]);

    // ── JSX ───────────────────────────────────────────────────────────────────
    return (
        <>
            <Toolbar editor={editor} onCommand={executeToolbarCommand} />
            <div id="editor" />
            <DragHandle
                editor={editor!}
                nested={false}
                onNodeChange={onDragNodeChange}
                computePositionConfig={dragComputePositionConfig}
            >
                <div className="node-action-buttons">
                    <button
                        className="node-action-btn"
                        title={t('drag.insertBelow')}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            const ed = editorRef.current;
                            if (!ed) return;
                            const pos = dragNodePosRef.current;
                            if (pos < 0) return;
                            const $pos = ed.state.doc.resolve(pos);
                            const node = $pos.nodeAfter;
                            if (!node) return;
                            const insertAt = pos + node.nodeSize;
                            const { state, view } = ed;
                            const paragraphType = state.schema.nodes.paragraph;
                            if (!paragraphType) return;
                            // 步骤 A：静默将选区移到 insertAt，不加入撤销历史
                            const selTr = state.tr
                                .setSelection(TextSelection.near(state.doc.resolve(insertAt)))
                                .setMeta('addToHistory', false);
                            view.dispatch(selTr);
                            // 步骤 B：插入新段落（独立事务，有自己的撤销条目）
                            const insertState = view.state;
                            const newNode = paragraphType.create();
                            const insertTr = insertState.tr.insert(insertAt, newNode);
                            insertTr.setSelection(TextSelection.near(insertTr.doc.resolve(insertAt + 1)));
                            view.dispatch(insertTr.scrollIntoView());
                            view.focus();
                        }}
                    >
                        +
                    </button>
                    <button className="node-action-btn drag-btn" title={t('drag.reorder')}>
                        ⠿
                    </button>
                </div>
            </DragHandle>
            {emojiPickerAnchor && (
                <EmojiPicker
                    anchorRect={emojiPickerAnchor}
                    onSelect={(em) => {
                        setEmojiAnchor(null);
                        const ed = editorRef.current;
                        if (ed) ed.chain().focus().insertContent({ type: 'text', text: em }).run();
                    }}
                    onClose={() => setEmojiAnchor(null)}
                />
            )}
            <SlashMenu
                visible={slashVisible}
                query={slashQuery}
                coords={slashCoords}
                activeIndex={slashActiveIndex}
                onSelect={executeSlashCommand}
            />
            <PathCompletionMenu
                visible={pathCompVisible}
                items={pathCompItems}
                coords={pathCompCoords}
                activeIndex={pathCompActiveIndex}
                onSelect={applyPathCompletion}
            />
            <style id="font-size-style" />
        </>
    );
}
