/**
 * 仅当光标位于 Markdown 链接或图片 URL 槽内时，
 * 触发本地路径补全菜单：
 *
 *   [text](|          ← 链接
 *   ![alt](|          ← 图片
 *   [text](./some|    ← 链接中的部分路径
 *
 * 其他位置不触发补全。
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
// PathCompletionItem 的权威定义在 shared/pathCompleter.ts，此处 re-export 保持外部导入路径不变
export type { PathCompletionItem } from '../shared/domPathCompletion';

export interface PathCompletionCallbacks {
    onShow: (coords: { left: number; top: number; bottom: number }, prefix: string) => void;
    onHide: () => void;
    onUpdate: (coords: { left: number; top: number; bottom: number }, prefix: string) => void;
    onNavigate: (direction: 1 | -1) => void;
    onConfirm: () => void;
    isVisible: () => boolean;
    getRange: () => { from: number; to: number } | null;
    setRange: (range: { from: number; to: number } | null) => void;
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────

/**
 * 给定当前段落节点的完整文本和光标在该节点内的偏移量，
 * 检测光标是否在 Markdown 链接/图片 URL 槽内：
 * ](  ...  |  其中 | 是光标，且 ]( 之前有匹配的 [
 * （图片可在 [ 前加 !）。
 *
 * 返回 { prefix, prefixStart }，其中：
 *   prefix      = "(" 到光标之间的文本（正在输入的 URL）
 *   prefixStart = 前缀在 nodeText 中的字符索引（紧随 "(" 之后）
 *
 * 若光标不在此类槽内则返回 null。
 */
function extractMarkdownLinkPrefix(
    nodeText: string,
    cursorOffset: number,
): { prefix: string; prefixStart: number } | null {
    // 仅操作光标之前的文本
    const textToCursor = nodeText.slice(0, cursorOffset);

    // 反向扫描，找到最近一个未匹配的 '('
    let depth = 0;
    let parenIdx = -1;
    for (let i = textToCursor.length - 1; i >= 0; i--) {
        const ch = textToCursor[i];
        if (ch === ')') { depth++; }
        else if (ch === '(') {
            if (depth > 0) { depth--; }
            else { parenIdx = i; break; }
        }
    }
    if (parenIdx === -1) return null;

    // '(' 必须紧跟在 ']' 之后 → Markdown 链接/图片语法
    if (parenIdx === 0 || textToCursor[parenIdx - 1] !== ']') return null;

    // ']' 之前必须有匹配的 '[...]'（图片可选前置 '!'）
    // 从 ']' 反向扫描，找到匹配的 '['
    const closeBracket = parenIdx - 1; // ']' 的索引
    let bracketDepth = 0;
    let openBracket = -1;
    for (let i = closeBracket; i >= 0; i--) {
        const ch = textToCursor[i];
        if (ch === ']') { bracketDepth++; }
        else if (ch === '[') {
            bracketDepth--;
            if (bracketDepth === 0) { openBracket = i; break; }
        }
    }
    if (openBracket === -1) return null; // 未找到匹配的 '['

    // '(' 到光标之间的文本即为正在输入的 URL 前缀
    const prefix = textToCursor.slice(parenIdx + 1);

    // 若前缀像 HTTP/S URL 或锚点则拒绝
    if (/^https?:\/\//i.test(prefix)) return null;
    if (prefix.startsWith('#')) return null;
    if (/^[a-z][a-z0-9+\-.]*:/i.test(prefix)) return null; // 任意协议

    return { prefix, prefixStart: parenIdx + 1 };
}

// -- 扩展 ----------------------------------------------------------------

export function createPathCompletionExtension(callbacks: PathCompletionCallbacks) {
    return Extension.create({
        name: 'pathCompletion',

        addProseMirrorPlugins() {
            let localVisible = false;
            const pluginKey = new PluginKey<boolean>('pathCompletion');

            return [
                new Plugin({
                    key: pluginKey,

                    state: {
                        init: () => false,
                        apply(tr, _prev) {
                            return tr.getMeta('backslashEscape') === true;
                        },
                    },

                    props: {
                        handleKeyDown(_view, event) {
                            if (!localVisible) return false;
                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                callbacks.onNavigate(1);
                                return true;
                            }
                            if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                callbacks.onNavigate(-1);
                                return true;
                            }
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                callbacks.onConfirm();
                                return true;
                            }
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                localVisible = false;
                                callbacks.onHide();
                                return true;
                            }
                            return false;
                        },
                    },

                    view() {
                        // 全局 mousedown 处理器：若点击目标在补全菜单 DOM 之外则隐藏补全。
                        // 在 ProseMirror 移动光标之前触发，因此通过原生事件目标检查，
                        // 而非依赖 view.update（对纯文本点击有效，但对图片或按钮等
                        // 非文本元素的点击无效）。
                        const onGlobalMouseDown = (e: MouseEvent) => {
                            if (!localVisible) return;
                            const target = e.target as Node | null;
                            if (!target) return;
                            // 通过类名查找菜单根元素
                            const menu = document.querySelector('.path-completion-dropdown');
                            if (menu && menu.contains(target)) return; // 点击菜单内部 → 保持开启
                            // 点击菜单外部 → 关闭
                            localVisible = false;
                            callbacks.onHide();
                        };
                        // 在捕获阶段绑定，以便在 ProseMirror 自身处理器的
                        // stopPropagation 之前获取事件。
                        document.addEventListener('mousedown', onGlobalMouseDown, true);

                        return {
                            update(view) {
                                const { $from } = view.state.selection;
                                if (!$from.parent.isTextblock) {
                                    if (localVisible) { localVisible = false; callbacks.onHide(); }
                                    return;
                                }

                                // 不在代码块、表格单元格或其他不支持链接插入的
                                // 特殊节点内触发。
                                const blockedNodeTypes = new Set([
                                    'codeBlock', 'code',
                                ]);
                                let insideBlocked = false;
                                for (let d = $from.depth; d >= 0; d--) {
                                    if (blockedNodeTypes.has($from.node(d).type.name)) {
                                        insideBlocked = true;
                                        break;
                                    }
                                }
                                if (insideBlocked) {
                                    if (localVisible) { localVisible = false; callbacks.onHide(); }
                                    return;
                                }

                                const wasEscaped = pluginKey.getState(view.state);
                                if (wasEscaped) {
                                    if (localVisible) { localVisible = false; callbacks.onHide(); }
                                    return;
                                }

                                const nodeText = $from.parent.textContent;
                                const cursorOffset = $from.parentOffset;
                                const result = extractMarkdownLinkPrefix(nodeText, cursorOffset);

                                if (!result) {
                                    if (localVisible) { localVisible = false; callbacks.onHide(); }
                                    return;
                                }

                                const { prefix, prefixStart } = result;
                                const blockStart = $from.start();
                                const rangeFrom = blockStart + prefixStart;
                                const rangeTo = blockStart + cursorOffset;
                                callbacks.setRange({ from: rangeFrom, to: rangeTo });

                                const coords = view.coordsAtPos($from.pos);

                                if (localVisible) {
                                    callbacks.onUpdate(coords, prefix);
                                } else {
                                    localVisible = true;
                                    callbacks.onShow(coords, prefix);
                                }
                            },

                            destroy() {
                                document.removeEventListener('mousedown', onGlobalMouseDown, true);
                                localVisible = false;
                                callbacks.onHide();
                            },
                        };
                    },
                }),
            ];
        },
    });
}
