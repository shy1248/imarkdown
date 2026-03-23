/**
 * 防止两个独立链接因中间文本被删除而合并
 *
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction, EditorState } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Mapping } from '@tiptap/pm/transform';

// ---------------------------------------------------------------------------
// LinkBoundaryGuard
//
// 防止两个原本独立的链接节点在其间的纯文本被删除后（例如按 Backspace）合并为一个。
//
// 策略：每次文档发生变更的事务后，比较新旧状态的链接范围集合。
// 若新状态中某个链接范围覆盖了旧状态中两个或多个不连续的链接范围，
// 则在合并边界处插入一个不带链接标记的零宽空格（U+200B）将它们重新分隔。
// ---------------------------------------------------------------------------
export const LinkBoundaryGuard = Extension.create({
    name: 'linkBoundaryGuard',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('linkBoundaryGuard'),
                appendTransaction(
                    transactions: readonly Transaction[],
                    oldState: EditorState,
                    newState: EditorState,
                ) {
                    if (!transactions.some(tr => tr.docChanged)) return null;
                    if (transactions.some(tr => tr.getMeta('linkBoundaryGuard'))) return null;

                    const linkMarkType = newState.schema.marks.link;
                    if (!linkMarkType) return null;

                    // 收集旧状态的链接范围：{ from, to, href }
                    type LinkRange = { from: number; to: number; href: string };
                    const oldRanges: LinkRange[] = [];
                    oldState.doc.descendants((node: PmNode, pos: number) => {
                        if (!node.isText) return;
                        const linkMark = node.marks.find(m => m.type.name === 'link');
                        if (!linkMark) return;
                        oldRanges.push({ from: pos, to: pos + node.nodeSize, href: linkMark.attrs.href ?? '' });
                    });

                    if (oldRanges.length < 2) return null;

                    // 将相同 href 的连续范围合并为单个区间，
                    // 以便识别原始的"链接孤岛"
                    const mergedOld: LinkRange[] = [];
                    for (const r of oldRanges) {
                        const last = mergedOld[mergedOld.length - 1];
                        if (last && last.href === r.href && last.to === r.from) {
                            last.to = r.to;
                        } else {
                            mergedOld.push({ ...r });
                        }
                    }

                    // 收集新状态的链接范围
                    const newRanges: LinkRange[] = [];
                    newState.doc.descendants((node: PmNode, pos: number) => {
                        if (!node.isText) return;
                        const linkMark = node.marks.find(m => m.type.name === 'link');
                        if (!linkMark) return;
                        newRanges.push({ from: pos, to: pos + node.nodeSize, href: linkMark.attrs.href ?? '' });
                    });

                    // 合并新状态中连续的链接范围
                    const mergedNew: LinkRange[] = [];
                    for (const r of newRanges) {
                        const last = mergedNew[mergedNew.length - 1];
                        if (last && last.href === r.href && last.to === r.from) {
                            last.to = r.to;
                        } else {
                            mergedNew.push({ ...r });
                        }
                    }

                    // 对每个新的合并链接范围，通过事务映射找出它覆盖了哪些旧链接范围
                    const mapping = new Mapping();
                    for (const tr of transactions) {
                        mapping.appendMapping(tr.mapping);
                    }

                    // 需要在新状态中插入零宽分隔符的位置列表
                    const insertPositions: number[] = [];

                    for (const nr of mergedNew) {
                        // 将新状态的范围边界映射回旧状态的位置
                        const oldFrom = mapping.invert().map(nr.from, -1);
                        const oldTo   = mapping.invert().map(nr.to,    1);

                        // 统计旧状态中有多少个独立的链接范围落在 [oldFrom, oldTo] 内
                        const covering = mergedOld.filter(
                            or => or.href === nr.href && or.from >= oldFrom && or.to <= oldTo
                        );
                        if (covering.length < 2) continue;

                        // 原来有多个独立范围，现在合并为一个，
                        // 在每个内部边界插入零宽空格将它们重新分隔
                        for (let i = 0; i + 1 < covering.length; i++) {
                            const boundaryOld = covering[i].to;
                            const boundaryNew = mapping.map(boundaryOld, -1);
                            if (boundaryNew > nr.from && boundaryNew < nr.to) {
                                insertPositions.push(boundaryNew);
                            }
                        }
                    }

                    if (insertPositions.length === 0) return null;

                    const tr = newState.tr;
                    // 倒序处理，避免前面的插入使后面的位置偏移
                    for (const pos of insertPositions.sort((a, b) => b - a)) {
                        const zwsp = newState.schema.text('\u200B');
                        tr.insert(pos, zwsp);
                        tr.removeMark(pos, pos + 1, linkMarkType);
                    }
                    tr.setMeta('linkBoundaryGuard', true);
                    return tr;
                },
            }),
        ];
    },
});
