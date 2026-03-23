/**
 * 汇聚所有 tiptap 扩展并导出 createExtensions() 工厂函数。
 * 各扩展的具体实现已拆分到独立子目录：
 *   - markdown/   — prosemirror-markdown 补丁、输入规则、缩进/取消缩进
 *   - code/       — 代码块、语法高亮、语言选择器、纯文本复制
 *   - table/      — 表格扩展与控件
 *   - link/       — 链接边界守卫、Markdown 链接输入规则、链接插入面板
 *   - image/      — 图片缩放、图片上传
 *   - math/       — 行内/块级数学公式
 */

// 副作用导入：必须在任何 ProseMirror 扩展注册之前执行
import './markdown/patches';

import StarterKit from '@tiptap/starter-kit';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { TaskItem } from '@tiptap/extension-task-item';
import { Link } from '@tiptap/extension-link';
import { TableRow } from '@tiptap/extension-table-row';
import { Markdown } from 'tiptap-markdown';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { NodeSelection } from '@tiptap/pm/state';

import { CustomInlineMath, CustomBlockMath } from './math/mathematic';
import { ShikiHighlight } from './code/codeHighlight';
import type { SlashCommandCallbacks } from './slashAction';
import { slashAction } from './slashAction';
import type { PathCompletionCallbacks } from './markdown/pathCompletion';
import { createPathCompletionExtension } from './markdown/pathCompletion';
import { imageUpload } from './image/imageUpload';
import { TableControls } from './table/tableControls';
import { linkInsert } from './link/linkInsert';
import { CodeBlockLanguageSelector } from './code/codeLlanguage';
import { createSearchPlugin } from '../components/SearchBar';
import { resizableImage } from './image/resizableImage';
import { CustomCodeBlock } from './code/codeBlock';
import { Table, TableHeader, TableCell, TableDeleteOnBackspace } from './table/tableExtensions';
import { LinkBoundaryGuard } from "./link/linkBoundaryGuard";
import {
    BackslashEscape,
    CustomBold,
    CustomItalic,
    CustomStrike,
    CustomTaskList,
    MarkdownImageInputRule,
    MarkdownLinkInputRule,
} from './markdown/inputRules';
import { IndentOutdent } from './indentOutdent';

export interface ExtensionsConfig {
    resolveImageUrl: (src: string) => string;
    slashCallbacks: SlashCommandCallbacks;
    pathCompletionCallbacks: PathCompletionCallbacks;
    onPasteImage: (dataUrl: string) => void;
    onUploadImages: (files: File[], uploadBlockPos: number) => void;
    onInsertLink: (text: string, url: string) => void;
}

export function createExtensions(config: ExtensionsConfig): { extensions: any[] } {
    const extensions = [
        StarterKit.configure({
            codeBlock: false,
            // 禁用内置 bold/italic/strike——由 Custom* 替换，
            // 避免它们的 inputRules 与我们的产生冲突。
            bold: false,
            italic: false,
            strike: false,
            // 禁用内置 HorizontalRule——由下方 CustomHorizontalRule 替换，
            // 添加 atom: true 以修复 DragHandle 拖拽范围计算。
            horizontalRule: false,
            heading: { levels: [1, 2, 3] },
        }),
        CustomBold,
        CustomItalic,
        CustomStrike,
        BackslashEscape,
        MarkdownImageInputRule,
        MarkdownLinkInputRule,
        LinkBoundaryGuard,
        CustomCodeBlock,
        CodeBlockLanguageSelector,
        ShikiHighlight,
        CustomTaskList,
        TaskItem.configure({ nested: true }),
        // ── 自定义 Link 扩展 ───────────────────────────────────────────────
        // 相对于官方 @tiptap/extension-link 的改动：
        //   1. inclusive: false  — 光标在链接末尾时不继承链接标记
        //   2. openOnClick: false — 普通点击不导航
        //   3. Ctrl/⌘+Click 通过扩展宿主打开链接
        //      （由 webviewHtml.ts 注入的捕获阶段监听器处理）
        //   4. window keydown/keyup 切换 <body> 上的 .ctrl-hover CSS 类，
        //      使光标仅在修饰键按下时显示为指针样式。
        Link.extend({
            inclusive: false,
            addProseMirrorPlugins() {
                return [
                    new Plugin({
                        key: new PluginKey('ctrlClickLink'),
                        view(_editorView) {
                            const onKeyDown = (e: KeyboardEvent) => {
                                if (e.ctrlKey || e.metaKey) {
                                    document.body.classList.add('ctrl-hover');
                                }
                            };
                            const onKeyUp = (e: KeyboardEvent) => {
                                if (!e.ctrlKey && !e.metaKey) {
                                    document.body.classList.remove('ctrl-hover');
                                }
                            };
                            const onBlur = () => document.body.classList.remove('ctrl-hover');
                            window.addEventListener('keydown', onKeyDown);
                            window.addEventListener('keyup', onKeyUp);
                            window.addEventListener('blur', onBlur);
                            return {
                                destroy() {
                                    window.removeEventListener('keydown', onKeyDown);
                                    window.removeEventListener('keyup', onKeyUp);
                                    window.removeEventListener('blur', onBlur);
                                    document.body.classList.remove('ctrl-hover');
                                },
                            };
                        },
                    }),
                ];
            },
        }).configure({ openOnClick: false }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        TableControls,
        TableDeleteOnBackspace,
        linkInsert({ onInsert: config.onInsertLink }),
        imageUpload({ onUpload: config.onUploadImages }),
        resizableImage({
            resolveImageUrl: config.resolveImageUrl,
            onPasteImage: config.onPasteImage,
        }),
        CustomInlineMath.configure({
            katexOptions: { throwOnError: false },
        }),
        CustomBlockMath.configure({
            katexOptions: { throwOnError: false, displayMode: true },
        }),
        slashAction(config.slashCallbacks),
        createPathCompletionExtension(config.pathCompletionCallbacks),
        IndentOutdent,
        // ── 自定义 HorizontalRule 扩展 ──────────────────────────────────────
        // 相对于 StarterKit 内置 HorizontalRule 的改动：
        //   1. atom: true — 使 DragHandle 正确计算拖拽范围
        //      （DragHandle 的 getDragHandleRanges 对非 atom 节点使用
        //        offset = -1，而 HR 的 nodeSize=1，导致范围为空）
        //   2. 补充 Plugin：
        //      a. 单击 HR 建立 NodeSelection（可见选中样式由 CSS 处理）
        //      b. NodeSelection 选中 HR 时，Backspace / Delete 删除该节点
        HorizontalRule.extend({
            atom: true,
            addProseMirrorPlugins() {
                const parentPlugins = this.parent?.() || [];
                return [
                    ...parentPlugins,
                    new Plugin({
                        key: new PluginKey('hrSelection'),
                        props: {
                            handleKeyDown(view, event) {
                                const { state, dispatch } = view;
                                const { selection } = state;
                                if (
                                    !(selection instanceof NodeSelection) ||
                                    selection.node.type.name !== 'horizontalRule'
                                ) return false;
                                if (event.key === 'Backspace' || event.key === 'Delete') {
                                    event.preventDefault();
                                    dispatch(state.tr.deleteSelection());
                                    return true;
                                }
                                return false;
                            },
                            handleClickOn(view, _pos, node, nodePos, event) {
                                if (node.type.name !== 'horizontalRule') return false;
                                event.preventDefault();
                                view.dispatch(
                                    view.state.tr.setSelection(
                                        NodeSelection.create(view.state.doc, nodePos)
                                    )
                                );
                                return true;
                            },
                        },
                    }),
                ];
            },
        }),
        Extension.create({
            name: 'searchHighlight',
            addProseMirrorPlugins() {
                return [createSearchPlugin()];
            },
        }),
        // ── 拖拽落点限制：只允许插入到顶层节点之间 ────────────────────────
        // DragHandle 通过 view.dragging 把拖拽内容交给 PM 原生 drop 处理，
        // PM 会以 posAtCoords 的原始位置（可能在列表项/blockquote 内部）
        // 作为插入点。这里在 handleDrop 阶段将位置提升到 depth=0 的顶层边界，
        // 确保节点始终插入在顶层节点之间。
        Extension.create({
            name: 'topLevelDropOnly',
            addProseMirrorPlugins() {
                return [
                    new Plugin({
                        key: new PluginKey('topLevelDropOnly'),
                        props: {
                            handleDrop(view, event) {
                                // 仅处理来自 DragHandle 的拖拽（view.dragging 存在）
                                if (!view.dragging) return false;
                                const coords = { left: event.clientX, top: event.clientY };
                                const pos = view.posAtCoords(coords);
                                if (!pos) return false;
                                const $pos = view.state.doc.resolve(pos.pos);
                                // 已经在顶层，不干预
                                if ($pos.depth === 0) return false;
                                // 提升到 depth=0 的最近边界：
                                // $pos.before(1) 是当前顶层节点的起始位置
                                // 根据鼠标在节点上半/下半决定插在前面还是后面
                                const topPos = $pos.before(1);
                                const topNode = view.state.doc.nodeAt(topPos);
                                if (!topNode) return false;
                                const topDom = view.nodeDOM(topPos) as HTMLElement | null;
                                let insertPos: number;
                                if (topDom) {
                                    const rect = topDom.getBoundingClientRect();
                                    // 鼠标在节点下半 → 插在节点后面
                                    insertPos = event.clientY > rect.top + rect.height / 2
                                        ? topPos + topNode.nodeSize
                                        : topPos;
                                } else {
                                    insertPos = topPos;
                                }
                                const { slice, move } = view.dragging;
                                const tr = view.state.tr;
                                if (move) {
                                    // 删除原位置内容
                                    const sel = view.state.selection;
                                    tr.deleteRange(sel.from, sel.to);
                                    // 重新计算 insertPos（删除后偏移可能变化）
                                    const mappedPos = tr.mapping.map(insertPos);
                                    tr.insert(mappedPos, slice.content);
                                } else {
                                    tr.insert(insertPos, slice.content);
                                }
                                view.dispatch(tr.scrollIntoView());
                                return true;
                            },
                        },
                    }),
                ];
            },
        }),
        Markdown.configure({
            transformCopiedText: false,
        }),
    ];
    return { extensions };
}
