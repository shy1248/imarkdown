/**
 * 导出所有自定义输入规则/格式化扩展：
 *   - BackslashEscape         — 将 `\*` 等转义序列转换为字面量字符
 *   - CustomBold              — 宽松正则替换官方 Bold inputRule
 *   - CustomItalic            — 宽松正则替换官方 Italic inputRule
 *   - CustomStrike            — 宽松正则替换官方 Strike inputRule
 *   - CustomTaskList          — 扩展 TaskList 以支持混合列表拆分
 *   - MarkdownImageInputRule  — 将 `![alt](url)` 转换为图片节点
 *   - MarkdownLinkInputRule  — 将 `[alt](url)` 转换为连接标记
 */
import { Extension, markInputRule, markPasteRule } from '@tiptap/core';
import { Bold } from '@tiptap/extension-bold';
import { Italic } from '@tiptap/extension-italic';
import { Strike } from '@tiptap/extension-strike';
import { TaskList } from '@tiptap/extension-task-list';
import taskListPlugin from 'markdown-it-task-lists';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction, EditorState } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';



// ---------------------------------------------------------------------------
// BackslashEscape
//
// 在所见即所得编辑器中，输入 `\*` 应产生一个字面量 `*` 字符
//（即反斜杠被消耗，起到与标准 Markdown 相同的转义前缀作用）。
// 若没有此扩展，`\` 会保持可见，用户无法在不触发格式化的情况下输入 *、_ 或 ~。
//
// 此 inputRule 会在用户在反斜杠之后紧接着输入可转义字符时触发，
// 将 `\X` 对删除并仅插入字面量 `X`。
// ---------------------------------------------------------------------------
export const BackslashEscape = Extension.create({
    name: 'backslashEscape',
    addInputRules() {
        // 可转义字符集：*  _  ~  `  /
        return [
            {
                find: /\\([*_~`/])$/,
                handler({ state, range, match }: any) {
                    const char = match[1] as string;
                    const tr = state.tr;
                    tr.replaceWith(range.from, range.to, state.schema.text(char));
                    // 告知 pathCompletion：此字符来自转义序列，不触发路径补全
                    tr.setMeta('backslashEscape', true);
                    return tr;
                },
            } as any,
        ];
    },
});

// ---------------------------------------------------------------------------
// CustomBold / CustomItalic / CustomStrike
//
// 官方 @tiptap/extension-* 的 inputRule 正则要求开头分隔符前有 `(?:^|\s)`，
// 导致 `word**bold**` 永远无法触发。我们用更宽松的正则替换它们。
//
// Italic 的正则也做了收紧：紧接在另一个 `*` 之前或之后的 `*`
// 不被视为斜体分隔符——避免将 `**bold**` 误解析为斜体。
// ---------------------------------------------------------------------------
export const CustomBold = Bold.extend({
    addInputRules() {
        return [
            // **text** — 向后看：开头 ** 前不能有 \ 或 *
            markInputRule({ find: /(?<![\\\*])(\*\*([^*\n]+)\*\*)$/, type: this.type }),
            // __text__（双下划线粗体）
            markInputRule({ find: /(?<![\\_])(__([^_\n]+)__)$/, type: this.type }),
        ];
    },
    addPasteRules() {
        return [
            markPasteRule({ find: /(?<![\\\*])\*\*([^*\n]+)\*\*(?!\*)/g, type: this.type }),
            markPasteRule({ find: /(?<![\\_])__([^_\n]+)__(?!_)/g, type: this.type }),
        ];
    },
});

export const CustomItalic = Italic.extend({
    addInputRules() {
        return [
            // *text* — 前不能有 \ 或 *，后不能紧跟 *
            markInputRule({ find: /(?<![\\\*])(\*([^*\n]+)\*)(?!\*)$/, type: this.type }),
            // _text_（单下划线斜体）
            markInputRule({ find: /(?<![\\_])(_([^_\n]+)_)(?!_)$/, type: this.type }),
        ];
    },
    addPasteRules() {
        return [
            markPasteRule({ find: /(?<![\\\*])\*([^*\n]+)\*(?!\*)/g, type: this.type }),
            markPasteRule({ find: /(?<![\\_])_([^_\n]+)_(?!_)/g, type: this.type }),
        ];
    },
});

export const CustomStrike = Strike.extend({
    addInputRules() {
        return [
            // ~~text~~ — 前不能有 \
            markInputRule({ find: /(?<!\\)(~~([^~\n]+)~~)$/, type: this.type }),
        ];
    },
    addPasteRules() {
        return [
            markPasteRule({ find: /(?<!\\)~~([^~\n]+)~~/g, type: this.type }),
        ];
    },
});

// ---------------------------------------------------------------------------
// CustomTaskList
//
// 扩展 TaskList 以处理混合列表（部分列表项为任务项，部分为普通项）：
// 将混合列表按类型拆分为多个独立的 <ul>，避免普通列表项被吞入 taskList。
// ---------------------------------------------------------------------------
export const CustomTaskList = TaskList.extend({
    addStorage() {
        return {
            markdown: {
                parse: {
                    setup(markdownit: any) {
                        markdownit.use(taskListPlugin);
                    },
                    updateDOM(element: HTMLElement) {
                        // markdown-it-task-lists 会将整个 <ul> 标记为
                        // "contains-task-list"，即使只有部分列表项是任务项。
                        // 我们需要将混合列表拆分，以防普通列表项被吞入 taskList。
                        [...element.querySelectorAll('ul.contains-task-list')].forEach(list => {
                            const items = [...list.children] as HTMLElement[];
                            const allTask = items.every(li => li.classList.contains('task-list-item'));
                            if (allTask) {
                                list.setAttribute('data-type', 'taskList');
                                return;
                            }
                            // 混合列表：按类型将连续列表项分组为不同的 <ul>
                            type Run = { isTask: boolean; items: HTMLElement[] };
                            const runs: Run[] = [];
                            for (const li of items) {
                                const isTask = li.classList.contains('task-list-item');
                                if (!runs.length || runs[runs.length - 1].isTask !== isTask) {
                                    runs.push({ isTask, items: [] });
                                }
                                runs[runs.length - 1].items.push(li);
                            }
                            // 用多个独立 <ul> 替换原始列表
                            const parent = list.parentNode!;
                            for (const run of runs) {
                                const ul = document.createElement('ul');
                                if (run.isTask) ul.setAttribute('data-type', 'taskList');
                                for (const li of run.items) ul.appendChild(li);
                                parent.insertBefore(ul, list);
                            }
                            parent.removeChild(list);
                        });
                    },
                },
            },
        };
    },
});

// ---------------------------------------------------------------------------
// MarkdownImageInputRule
//
// 将内联输入的 `![alt](url)` 转换为图片节点。
// 使用 appendTransaction 跨所有输入方式可靠检测。
// ---------------------------------------------------------------------------
export const MarkdownImageInputRule = Extension.create({
    name: 'markdownImageInputRule',
    addProseMirrorPlugins() {
        // 支持格式：![alt](url)、![alt](url "title")、![alt](url 'title')
        const imagePattern = /!\[([^\]]*)\]\(([^)\s"']+)(?:\s+"([^"]*)"|\s+'([^']*)')?\)/g;
        return [
            new Plugin({
                key: new PluginKey('markdownImageInput'),
                appendTransaction(
                    transactions: readonly Transaction[],
                    _oldState: EditorState,
                    newState: EditorState,
                ) {
                    if (!transactions.some(tr => tr.docChanged)) return null;
                    // 防止重复处理自身产生的事务
                    if (transactions.some(tr => tr.getMeta('markdownImageInput'))) return null;
                    const imageType = newState.schema.nodes.image;
                    const paragraphType = newState.schema.nodes.paragraph;
                    if (!imageType || !paragraphType) return null;

                    const newTr = newState.tr;
                    let changed = false;

                    // 先收集所有匹配（在修改文档前完成遍历）
                    const matches: {
                        from: number;
                        to: number;
                        src: string;
                        alt: string;
                        title: string | null;
                    }[] = [];
                    newState.doc.descendants((node: PmNode, pos: number) => {
                        if (node.type.name === 'codeBlock' || node.type.name === 'code') return false;
                        if (!node.isText) return;
                        const text = node.text!;
                        imagePattern.lastIndex = 0;
                        let match: RegExpExecArray | null;
                        while ((match = imagePattern.exec(text)) !== null) {
                            matches.push({
                                from: pos + match.index,
                                to: pos + match.index + match[0].length,
                                src: match[2],
                                alt: match[1],
                                title: match[3] ?? match[4] ?? null,
                            });
                        }
                    });

                    // 倒序处理，保持位置有效
                    for (const m of matches.reverse()) {
                        const from = newTr.mapping.map(m.from);
                        const to   = newTr.mapping.map(m.to);
                        const imageNode = imageType.create({ src: m.src, alt: m.alt || null, title: m.title });

                        // 解析匹配位置所在段落的边界
                        const $from = newTr.doc.resolve(from);
                        const paraStart = $from.before($from.depth);
                        const paraEnd   = $from.after($from.depth);

                        const paraNode = newTr.doc.nodeAt(paraStart);
                        if (!paraNode) continue;

                        // 段落中图片语法前后的内联内容
                        const contentStart  = paraStart + 1;
                        const beforeContent = paraNode.content.cut(0, from - contentStart);
                        const afterContent  = paraNode.content.cut(to - contentStart);

                        // 构建替换节点序列
                        const replacementNodes: PmNode[] = [];
                        if (beforeContent.size > 0) {
                            replacementNodes.push(paragraphType.create({}, beforeContent));
                        }
                        replacementNodes.push(imageNode);
                        if (afterContent.size > 0) {
                            replacementNodes.push(paragraphType.create({}, afterContent));
                        } else {
                            replacementNodes.push(paragraphType.create());
                        }

                        newTr.replaceWith(paraStart, paraEnd, replacementNodes);

                        // 将光标置于图片节点后面的段落起始处
                        const beforeSize = beforeContent.size > 0 ? replacementNodes[0].nodeSize : 0;
                        const cursorBase = paraStart + beforeSize + imageNode.nodeSize + 1;
                        try {
                            newTr.setSelection(Selection.near(newTr.doc.resolve(cursorBase)));
                        } catch { /* 忽略越界异常 */ }
                        changed = true;
                    }
                    if (changed) newTr.setMeta('markdownImageInput', true);
                    return changed ? newTr : null;
                },
            }),
        ];
    },
});


// ---------------------------------------------------------------------------
// MarkdownLinkInputRule
//
// 将内联输入的 `[text](url)` 转换为链接标记。
// 使用 appendTransaction 在每次按键后可靠检测模式，
// 避免 IME 输入法和多字符输入引发的问题。
// ---------------------------------------------------------------------------
export const MarkdownLinkInputRule = Extension.create({
    name: 'markdownLinkInputRule',
    addProseMirrorPlugins() {
        const linkPattern = /(?<!!)(\[([^\]]+)\]\(([^)\s]+)\))/g;
        return [
            new Plugin({
                key: new PluginKey('markdownLinkInput'),
                appendTransaction(
                    transactions: readonly Transaction[],
                    _oldState: EditorState,
                    newState: EditorState,
                ) {
                    if (!transactions.some(tr => tr.docChanged)) return null;
                    // 防止重复处理自身产生的事务
                    if (transactions.some(tr => tr.getMeta('markdownLinkInput'))) return null;
                    const newTr = newState.tr;
                    let changed = false;
                    newState.doc.descendants((node: PmNode, pos: number) => {
                        // 代码块和内联代码中不做转换
                        if (node.type.name === 'codeBlock' || node.type.name === 'code') return false;
                        if (!node.isText) return;
                        const text = node.text!;
                        linkPattern.lastIndex = 0;
                        let match: RegExpExecArray | null;
                        while ((match = linkPattern.exec(text)) !== null) {
                            const linkText = match[2];
                            const url = match[3];
                            const from = pos + match.index;
                            const to = from + match[0].length;
                            const linkMark = newState.schema.marks.link?.create({ href: url });
                            if (!linkMark) continue;
                            newTr.replaceWith(
                                newTr.mapping.map(from),
                                newTr.mapping.map(to),
                                newState.schema.text(linkText, [linkMark]),
                            );
                            newTr.removeStoredMark(newState.schema.marks.link);
                            changed = true;
                        }
                    });
                    if (changed) newTr.setMeta('markdownLinkInput', true);
                    return changed ? newTr : null;
                },
            }),
        ];
    },
});