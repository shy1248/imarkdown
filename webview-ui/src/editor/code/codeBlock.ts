/**
 * 扩展 @tiptap/extension-code-block：
 *   1. 添加 `language` 属性，同时支持 data-language 和 class="language-xxx"
 *   2. 三次回车退出代码块
 *   3. appendTransaction 守卫，防止跨边界删除时块级节点侵入代码块
 */
import { CodeBlock } from '@tiptap/extension-code-block';
import { mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';

export const CustomCodeBlock = CodeBlock.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            language: {
                default: 'shell',
                parseHTML: (element: HTMLElement) => {
                    // 同时支持 data-language 和 class="language-xxx"。
                    // 此处元素为 <pre> 标签——先检查它，
                    // 再检查内层 <code> 元素（markdown-it 将语言类放在 <code> 而非 <pre> 上）。
                    if (element.hasAttribute('data-language')) {
                        return element.getAttribute('data-language') || null;
                    }
                    // 检查 <pre> 自身的 class（renderHTML 路径）
                    const preMatch = (element.getAttribute('class') || '').match(/language-(\S+)/);
                    if (preMatch) return preMatch[1];
                    // 检查内层 <code> 元素（markdown-it 解析路径）
                    const codeEl = element.querySelector('code');
                    if (codeEl) {
                        if (codeEl.hasAttribute('data-language')) {
                            return codeEl.getAttribute('data-language') || null;
                        }
                        const codeMatch = (codeEl.getAttribute('class') || '').match(/language-(\S+)/);
                        if (codeMatch) return codeMatch[1];
                    }
                    return null;
                },
                renderHTML: (attributes: Record<string, any>) => {
                    if (!attributes.language) return {};
                    return { 'data-language': attributes.language };
                },
            },
        };
    },

    renderHTML({ node, HTMLAttributes }: any) {
        const language = node.attrs.language || null;
        const className = language ? `${this.options.languageClassPrefix}${language}` : null;
        const preAttrs = mergeAttributes(
            this.options.HTMLAttributes,
            HTMLAttributes,
            language ? { 'data-language': language } : {}
        );
        const codeAttrs = mergeAttributes(
            className ? { class: className } : {},
            language ? { 'data-language': language } : {}
        );

        // 如果有语言信息，插入一个真实的 DOM 元素作为语言标签
        if (language) {
            return ['pre', preAttrs, ['div', { class: 'code-language-label', contenteditable: 'false', tabindex: -1 }, language], ['code', codeAttrs, 0]];
        }

        return ['pre', preAttrs, ['code', codeAttrs, 0]];
    },

    addKeyboardShortcuts() {
        return {
            /*
             * 三次回车退出代码块。
             *
             * 当光标（无选区）位于代码块末尾，且最后两个字符均为换行符
             * （即用户已连按两次回车，留下两个空行），再次按回车时应：
             *   1. 删除代码块中那两个尾部换行符。
             *   2. 在代码块后插入新段落并聚焦。
             *
             * 此行为与 VS Code 及大多数现代编辑器一致。
             */
            Enter: () => {
                const { state } = this.editor;
                const { selection } = state;
                const { $from, empty } = selection;
                if (!empty) return false;

                // 查找包含光标的 codeBlock
                let codeBlockDepth = -1;
                for (let d = $from.depth; d >= 0; d--) {
                    if ($from.node(d).type.name === 'codeBlock') {
                        codeBlockDepth = d;
                        break;
                    }
                }
                if (codeBlockDepth < 0) return false;

                const codeBlockEnd = $from.end(codeBlockDepth);
                // 光标必须位于代码块内容的最末尾
                if ($from.pos !== codeBlockEnd) return false;

                // 仅在最后两个字符都是换行符时触发
                // （用户已连按两次回车，现在按第三次）
                const codeNode = $from.node(codeBlockDepth);
                if (!codeNode.textContent.endsWith('\n\n')) return false;

                // 代码块关闭标记之后的绝对位置
                const codeBlockNodeStart = $from.before(codeBlockDepth);
                const afterCodeBlock = codeBlockNodeStart + codeNode.nodeSize;

                this.editor
                    .chain()
                    // 删除两个尾部换行符
                    .deleteRange({ from: codeBlockEnd - 2, to: codeBlockEnd })
                    // 在（已缩减的）代码块后插入段落。
                    // nodeSize 缩减了 2，因此段落开放标记位于 afterCodeBlock - 2。
                    // 光标需再前进 1（+1）才能落在段落内部，
                    // 使 ProseMirror 将 $from.parent 解析为段落节点本身——
                    // 即占位符装饰器所检查的条件。
                    .insertContentAt(afterCodeBlock - 2, { type: 'paragraph' })
                    .focus(afterCodeBlock - 2 + 1)
                    .run();
                return true;
            },
        };
    },

    /*
     * appendTransaction 守卫：每次事务后扫描所有 codeBlock 节点。
     * codeBlock 中只允许包含内联文本/标记。若发现非文本块级子节点
     * （例如跨边界删除时引入的段落节点），将其提取为紧随其后的兄弟段落。
     *
     * 这是最终安全网，覆盖上方键盘处理器无法拦截的情况
     * （如选区恰好结束在关闭边界之前，或通过编辑菜单执行的操作）。
     */
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('codeBlockBoundaryGuard'),
                appendTransaction(transactions, _oldState, newState) {
                    // 仅在文档确实发生变更时运行，避免引发无谓事务
                    // 导致 slashCommand 插件的 view.update 触发并调用 onHide()。
                    if (!transactions.some(tr => tr.docChanged)) return null;

                    const { doc, schema } = newState;
                    const paragraphType = schema.nodes.paragraph;
                    if (!paragraphType) return null;

                    // 收集顶层代码块位置（升序）
                    const codeBlockPositions: number[] = [];
                    doc.forEach((node, offset) => {
                        if (node.type.name === 'codeBlock') codeBlockPositions.push(offset);
                    });
                    if (codeBlockPositions.length === 0) return null;

                    let tr: import('@tiptap/pm/state').Transaction | null = null;

                    // 从后向前处理：对靠后代码块的修改不会影响靠前代码块的位置
                    for (const pos of [...codeBlockPositions].reverse()) {
                        const blockNode = (tr ?? newState.tr).doc.nodeAt(pos);
                        if (!blockNode || blockNode.type.name !== 'codeBlock') continue;

                        // 收集块级"入侵"子节点（代码块只允许内联内容）
                        const intruders: { node: PmNode; childOffset: number }[] = [];
                        blockNode.forEach((child: PmNode, childOffset: number) => {
                            if (!child.isInline && child.type.name !== 'text') {
                                intruders.push({ node: child, childOffset });
                            }
                        });
                        if (intruders.length === 0) continue;

                        if (!tr) tr = newState.tr;

                        // 从后往前删除入侵节点，保持前面的偏移量有效
                        const paragraphs: PmNode[] = [];
                        for (let i = intruders.length - 1; i >= 0; i--) {
                            const { node: intruder, childOffset } = intruders[i];
                            const from = pos + 1 + childOffset;
                            tr.delete(from, from + intruder.nodeSize);
                            const textContent = intruder.textContent;
                            paragraphs.unshift(textContent
                                ? paragraphType.create({}, schema.text(textContent))
                                : paragraphType.create());
                        }

                        // 将提取出的内容作为段落插入到代码块之后
                        const updatedBlock = tr.doc.nodeAt(pos);
                        if (updatedBlock) {
                            tr.insert(pos + updatedBlock.nodeSize, paragraphs);
                        }
                    }

                    return tr;
                },
            }),
        ];
    },
});
