/**
 * 提供 `indent` 和 `outdent` 命令，适用于所有可缩进节点：
 *   • 列表项  (bulletList / orderedList) → sinkListItem / liftListItem
 *   • 任务项  (taskList)                 → sinkListItem / liftListItem
 *   • 引用块  (blockquote)               → 嵌套/解除 blockquote
 * 光标不在可缩进位置时优雅降级（无操作）。
 *
 * 额外行为：
 *   - 在编辑器 DOM 元素上注册捕获阶段 keydown 监听器，
 *     拦截 Tab/Shift+Tab 并映射到 indent/outdent 命令，
 *     阻止 VS Code 焦点陷阱抢夺焦点。
 *   - 在 window.__imarkdownTabHandler 上挂载全局回调，
 *     供 webviewHtml.ts 中捕获阶段的 Tab 拦截器调用。
 */
import { Extension } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        indentOutdent: {
            /** 增加缩进层级（列表项下沉或嵌套引用块） */
            indent: () => ReturnType;
            /** 减少缩进层级（列表项提升或取消嵌套引用块） */
            outdent: () => ReturnType;
        };
    }
}

export const IndentOutdent = Extension.create({
    name: 'indentOutdent',

    addCommands() {
        return {
            indent:
                () =>
                ({ state, commands }: { state: EditorState; commands: any }) => {
                    const { $from } = state.selection;
                    for (let d = $from.depth; d >= 0; d--) {
                        const node = $from.node(d);
                        if (node.type.name === 'listItem') {
                            return commands.sinkListItem('listItem');
                        }
                        if (node.type.name === 'taskItem') {
                            return commands.sinkListItem('taskItem');
                        }
                        if (node.type.name === 'blockquote') {
                            return commands.wrapIn('blockquote');
                        }
                    }
                    return false;
                },

            outdent:
                () =>
                ({ state, commands }: { state: EditorState; commands: any }) => {
                    const { $from } = state.selection;
                    for (let d = $from.depth; d >= 0; d--) {
                        const node = $from.node(d);
                        if (node.type.name === 'listItem') {
                            return commands.liftListItem('listItem');
                        }
                        if (node.type.name === 'taskItem') {
                            return commands.liftListItem('taskItem');
                        }
                        if (node.type.name === 'blockquote') {
                            return commands.lift('blockquote');
                        }
                    }
                    return false;
                },
        };
    },

    onCreate() {
        // 注册全局回调，供 webviewHtml.ts 中捕获阶段的 Tab 拦截器调用 indent/outdent。
        // 该捕获监听器已调用 preventDefault + stopImmediatePropagation，
        // 阻止 VS Code 抢夺焦点，因此 ProseMirror 的正常事件链被绕过，
        // 需从此处直接驱动命令。
        // 返回 true 表示已处理（缩进/反缩进），false 表示无缩进节点、应让事件继续传递。
        const editor = this.editor;
        (window as any).__imarkdownTabHandler = (shiftKey: boolean): boolean => {
            const { $from } = editor.state.selection;
            for (let d = $from.depth; d >= 0; d--) {
                const name = $from.node(d).type.name;
                if (name === 'listItem' || name === 'taskItem' || name === 'blockquote') {
                    if (shiftKey) {
                        editor.commands.outdent();
                    } else {
                        editor.commands.indent();
                    }
                    return true; // 已处理——webviewHtml.ts 可安全 stopImmediatePropagation
                }
            }
            return false; // 不在可缩进节点内——让事件继续传递到 ProseMirror
        };

        // 同时直接在编辑器 DOM 元素上注册（捕获阶段）。
        // 此监听器在捕获遍历（document → ... → editorDOM）期间触发，
        // 先于 ProseMirror 自身的冒泡阶段 keydown 监听器，
        // 也先于 VS Code 焦点陷阱转移焦点。
        // 注意：webviewHtml.ts 的 document 级捕获监听器已先行调用 __imarkdownTabHandler，
        // 若返回 true 则 stopImmediatePropagation，不会再到达此处；
        // 若返回 false（不在可缩进节点内）则此处不应再拦截（让 ProseMirror 处理）。
        const dom = this.editor.view.dom;
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;
            // 仅在光标处于可缩进节点内时拦截
            const { $from } = editor.state.selection;
            let indentable = false;
            for (let d = $from.depth; d >= 0; d--) {
                const name = $from.node(d).type.name;
                if (name === 'listItem' || name === 'taskItem' || name === 'blockquote') {
                    indentable = true;
                    break;
                }
            }
            if (!indentable) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.shiftKey) {
                editor.commands.outdent();
            } else {
                editor.commands.indent();
            }
        };
        dom.addEventListener('keydown', handler, true /* 捕获阶段 */);
        (this as any)._tabHandler = handler;
    },

    onDestroy() {
        delete (window as any).__imarkdownTabHandler;
        const dom = this.editor.view.dom;
        if ((this as any)._tabHandler) {
            dom.removeEventListener('keydown', (this as any)._tabHandler, true);
        }
    },
});
