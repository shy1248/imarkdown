import { useMemo, Fragment } from 'react';
import { Editor } from '@tiptap/core';
import { getAllCommands, getGroupLabel, type CommandDefined } from '../editor/editorCommands';
import { SearchBar } from './SearchBar';
import { selectionHasLink } from '../editor/link/linkInsert';

interface ToolbarProps {
    editor: Editor | null;
    onCommand: (cmdId: string) => void;
}

// 判断当前编辑器状态下哪些命令处于"激活"状态。
// 仅返回最具体的一组激活命令，避免多个按钮同时高亮造成混乱。
//
// 优先级层级（越高越优先）：
//   1. link / inlineMath  — 光标在链接或行内公式内：仅该按钮高亮
//   2. 行内标记            — bold / italic / strike / code（行内）：显示，段落按钮抑制
//   3. 块级节点类型         — codeBlock / quote / h1-h3 / blockMath / image：显示，段落+列表按钮抑制
//   4. 列表类型            — ul / ol / task：显示，段落按钮抑制
//   5. 段落               — 兜底，仅当其他任何元素均未激活时
function getActiveCommands(editor: Editor): Set<string> {
    const active = new Set<string>();
    try {
        const hasLink       = selectionHasLink(editor);
        const hasInlineMath = editor.isActive('inlineMath');
        const hasBold       = editor.isActive('bold');
        const hasItalic     = editor.isActive('italic');
        const hasStrike     = editor.isActive('strike');
        const hasCodeInl    = editor.isActive('code');
        const hasCodeBlk    = editor.isActive('codeBlock');
        const hasQuote      = editor.isActive('blockquote');
        const hasH1         = editor.isActive('heading', { level: 1 });
        const hasH2         = editor.isActive('heading', { level: 2 });
        const hasH3         = editor.isActive('heading', { level: 3 });
        const hasUl         = editor.isActive('bulletList');
        const hasOl         = editor.isActive('orderedList');
        const hasTask       = editor.isActive('taskList');
        const hasBlockMath  = editor.isActive('blockMath');
        const hasImage      = editor.isActive('image') || editor.isActive('resizableImage');

        // 第 1 层：链接或行内公式 — 抑制其他所有
        if (hasLink) { active.add('link'); return active; }
        if (hasInlineMath) { active.add('inlineMath'); return active; }

        // 第 2 层：行内标记（可组合，如 bold+italic）
        if (hasBold)    active.add('bold');
        if (hasItalic)  active.add('italic');
        if (hasStrike)  active.add('strike');
        if (hasCodeInl) active.add('code');

        // 第 3 层：块级节点类型（codeBlock / blockquote / heading / blockMath / image）
        // 抑制段落和列表按钮。
        if (hasCodeBlk)   active.add('codeblock');
        if (hasQuote)     active.add('quote');
        if (hasH1)        active.add('h1');
        if (hasH2)        active.add('h2');
        if (hasH3)        active.add('h3');
        if (hasBlockMath) active.add('math');
        if (hasImage)     active.add('image');

        const hasBlock = hasCodeBlk || hasQuote || hasH1 || hasH2 || hasH3 || hasBlockMath || hasImage;

        // 第 4 层：列表容器 — 仅当不在更高优先级的块级节点内时
        if (!hasBlock) {
            if (hasUl)   active.add('ul');
            if (hasOl)   active.add('ol');
            if (hasTask) active.add('task');
        }

        const hasList   = hasUl || hasOl || hasTask;
        const hasInline = hasBold || hasItalic || hasStrike || hasCodeInl;

        // 第 5 层：段落 — 仅当其他结构元素均未激活时
        if (!hasBlock && !hasList && !hasInline) {
            if (editor.isActive('paragraph')) active.add('paragraph');
        }
    } catch { /* ignore */ }
    return active;
}

function renderGroup(items: CommandDefined[], editor: Editor | null, onCommand: (id: string) => void, activeSet: Set<string>) {
    return items.map((cmd) => {
        const active = editor ? activeSet.has(cmd.id) : false;
        return (
            <button
                key={cmd.id}
                className={`toolbar-btn${active ? ' is-active' : ''}`}
                data-tooltip={cmd.label}
                data-cmd-id={cmd.id}
                title={cmd.label}
                onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onCommand(cmd.id);
                }}
                dangerouslySetInnerHTML={{ __html: cmd.icon }}
            />
        );
    });
}

export function Toolbar({ editor, onCommand }: ToolbarProps) {
    const grouped = useMemo(() => {
        const commands = getAllCommands();
        const groups: { group: string; label: string; items: CommandDefined[] }[] = [];
        const groupMap = new Map<string, CommandDefined[]>();
        for (const cmd of commands) {
            if (!groupMap.has(cmd.group)) {
                const arr: CommandDefined[] = [];
                groupMap.set(cmd.group, arr);
                groups.push({ group: cmd.group, label: getGroupLabel(cmd.group), items: arr });
            }
            groupMap.get(cmd.group)!.push(cmd);
        }
        return groups;
    }, []);

    return (
        <div id="toolbar-wrapper">
            <div className="toolbar">
                {(() => {
                    const activeSet = editor ? getActiveCommands(editor) : new Set<string>();
                    return grouped.map(({ group, items }, gi) => (
                        <Fragment key={group}>
                            {gi > 0 && <div className="toolbar-divider" />}
                            {renderGroup(items, editor, onCommand, activeSet)}
                        </Fragment>
                    ));
                })()}
                <div className="toolbar-divider" />
                <SearchBar editor={editor} />
            </div>
        </div>
    );
}
