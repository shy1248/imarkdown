import { t } from "../i18n";

/**
 * 将命令 ID 映射到 tiptap 链式操作，供工具栏和斜杠菜单共同调用。
 *
 */
import { Editor } from '@tiptap/core';
import { selectionHasLink, LINK_WIDGET_KEY } from './link/linkInsert';

export function runEditorCommand(
    editor: Editor,
    cmdId: string,
    extras: {
        emojiPickerAnchorRef: React.MutableRefObject<DOMRect | null>;
        setEmojiAnchor: (rect: DOMRect | null) => void;
    },
): void {
    switch (cmdId) {
        case 'paragraph': editor.chain().focus().setParagraph().run(); break;
        case 'bold':      editor.chain().focus().toggleBold().run(); break;
        case 'italic':    editor.chain().focus().toggleItalic().run(); break;
        case 'strike':    editor.chain().focus().toggleStrike().run(); break;
        case 'code':      editor.chain().focus().toggleCode().run(); break;
        case 'h1':        editor.chain().focus().toggleHeading({ level: 1 }).run(); break;
        case 'h2':        editor.chain().focus().toggleHeading({ level: 2 }).run(); break;
        case 'h3':        editor.chain().focus().toggleHeading({ level: 3 }).run(); break;
        case 'ul':        editor.chain().focus().toggleBulletList().run(); break;
        case 'ol':        editor.chain().focus().toggleOrderedList().run(); break;
        case 'task':      editor.chain().focus().toggleTaskList().run(); break;
        case 'indent':    editor.chain().focus().indent().run(); break;
        case 'outdent':   editor.chain().focus().outdent().run(); break;
        case 'quote':     editor.chain().focus().toggleBlockquote().run(); break;
        case 'codeblock': editor.chain().focus().toggleCodeBlock().run(); break;
        case 'hr':        editor.chain().focus().setHorizontalRule().run(); break;
        case 'table':
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
            break;

        case 'image': {
            const { selection: imgSel } = editor.state;
            if ('node' in imgSel && (imgSel as any).node?.type?.name === 'image') {
                // 已选中图片节点——打开内联编辑面板
                window.dispatchEvent(new CustomEvent('image-edit-request', {
                    detail: { pos: imgSel.from },
                }));
            } else {
                editor.chain().focus().insertImageUpload().run();
            }
            break;
        }

        case 'link': {
            // 切换：若链接组件已打开则关闭
            const linkState = LINK_WIDGET_KEY.getState(editor.state);
            if (linkState && linkState.anchor != null) {
                document.body.classList.remove('link-widget-open');
                editor.view.dispatch(
                    editor.view.state.tr.setMeta(LINK_WIDGET_KEY, { type: 'close' }),
                );
                editor.commands.focus();
                break;
            }
            const { empty } = editor.state.selection;
            if (empty) {
                editor.chain().focus().insertLinkBlock().run();
            } else if (selectionHasLink(editor)) {
                const existingHref = editor.getAttributes('link').href as string ?? '';
                editor.chain().focus().insertLinkBlockForEdit(existingHref).run();
            } else {
                editor.chain().focus().insertLinkBlockForSelection().run();
            }
            break;
        }

        case 'inlineMath': {
            const { selection: inlineSel } = editor.state;
            if ('node' in inlineSel && (inlineSel as any).node?.type?.name === 'inlineMath') {
                window.dispatchEvent(new CustomEvent('math-edit-request', {
                    detail: { pos: inlineSel.from },
                }));
            } else {
                editor.chain().focus().insertInlineMath({ latex: 'E=mc^2' }).run();
            }
            break;
        }

        case 'math': {
            const { selection: blockSel } = editor.state;
            if ('node' in blockSel && (blockSel as any).node?.type?.name === 'blockMath') {
                window.dispatchEvent(new CustomEvent('math-edit-request', {
                    detail: { pos: blockSel.from },
                }));
            } else {
                editor.chain().focus().insertBlockMath({
                    latex: '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
                }).run();
            }
            break;
        }

        case 'emoji': {
            // 切换：通过 ref 读取实时值（闭包中的 state 快照可能过期）
            if (extras.emojiPickerAnchorRef.current) {
                extras.setEmojiAnchor(null);
                break;
            }
            const emojiBtn = document.querySelector('[data-cmd-id="emoji"]') as HTMLElement | null;
            const rect = emojiBtn
                ? emojiBtn.getBoundingClientRect()
                : new DOMRect(window.innerWidth / 2, 48, 0, 0);
            extras.setEmojiAnchor(rect);
            break;
        }
    }
}

/** 用于显示的分组标签 */
const GROUP_LABELS: Record<string, () => string> = {
    style: () => t('slash.group.style'),
    insert: () => t('slash.group.insert'),
};

export function getGroupLabel(group: string): string {
    return GROUP_LABELS[group]?.() || group;
}

export interface CommandDefined {
    id: string;
    label: string;
    desc: string;
    icon: string;
    group: string;
    keywords: string[];
    /** 若为 true，该命令仅显示在 / 命令菜单中，不显示在工具栏 */
    slashCommand?: boolean;
}

export function getAllCommands(): CommandDefined[] {
    return [
        // 样式组 - 标题
        { id: 'h1', label: t('slash.h1'), desc: t('slash.h1.desc'), icon: ICONS.h1, group: 'style', keywords: ['heading', 'h1', '标题', 'title'], slashCommand: true },
        { id: 'h2', label: t('slash.h2'), desc: t('slash.h2.desc'), icon: ICONS.h2, group: 'style', keywords: ['heading', 'h2', '标题'], slashCommand: true },
        { id: 'h3', label: t('slash.h3'), desc: t('slash.h3.desc'), icon: ICONS.h3, group: 'style', keywords: ['heading', 'h3', '标题'], slashCommand: true },
        { id: 'paragraph', label: t('cmd.paragraph'), desc: t('cmd.paragraph.desc'), icon: ICONS.paragraph, group: 'style', keywords: ['paragraph', 'normal', '正文'], slashCommand: false },
        { id: 'bold', label: t('cmd.bold'), desc: t('cmd.bold.desc'), icon: ICONS.bold, group: 'style', keywords: ['bold', 'strong', '加粗'], slashCommand: false },
        { id: 'italic', label: t('cmd.italic'), desc: t('cmd.italic.desc'), icon: ICONS.italic, group: 'style', keywords: ['italic', 'em', '斜体'], slashCommand: false },
        { id: 'strike', label: t('cmd.strike'), desc: t('cmd.strike.desc'), icon: ICONS.strike, group: 'style', keywords: ['strike', 'strikethrough', 's', '删除线'], slashCommand: false },
        { id: 'code', label: t('cmd.code'), desc: t('cmd.code.desc'), icon: ICONS.inlineCode, group: 'style', keywords: ['code', 'inline', '代码', '行内代码'], slashCommand: false },
        // 列表组
        { id: 'ul', label: t('slash.ul'), desc: t('slash.ul.desc'), icon: ICONS.ul, group: 'style', keywords: ['bullet', 'list', 'ul', '列表', '无序'], slashCommand: true },
        { id: 'ol', label: t('slash.ol'), desc: t('slash.ol.desc'), icon: ICONS.ol, group: 'style', keywords: ['ordered', 'list', 'ol', '列表', '有序'], slashCommand: true },
        { id: 'task', label: t('slash.task'), desc: t('slash.task.desc'), icon: ICONS.task, group: 'style', keywords: ['task', 'todo', 'checkbox', '任务', '待办'], slashCommand: true },
        { id: 'outdent', label: t('cmd.outdent'), desc: t('cmd.outdent.desc'), icon: ICONS.outdent, group: 'style', keywords: ['outdent', 'unindent', '减少缩进'], slashCommand: false },
        { id: 'indent', label: t('cmd.indent'), desc: t('cmd.indent.desc'), icon: ICONS.indent, group: 'style', keywords: ['indent', '缩进', '增加缩进'], slashCommand: false },
        // 插入组
        { id: 'quote', label: t('slash.quote'), desc: t('slash.quote.desc'), icon: ICONS.quote, group: 'insert', keywords: ['quote', 'blockquote', '引用'], slashCommand: true },
        { id: 'codeblock', label: t('slash.codeblock'), desc: t('slash.codeblock.desc'), icon: ICONS.code, group: 'insert', keywords: ['code', 'codeblock', '代码'], slashCommand: true },
        { id: 'hr', label: t('slash.hr'), desc: t('slash.hr.desc'), icon: ICONS.hr, group: 'insert', keywords: ['divider', 'hr', 'horizontal', 'rule', '分割', '水平线'], slashCommand: true },
        { id: 'link', label: t('slash.link'), desc: t('slash.link.desc'), icon: ICONS.link, group: 'insert', keywords: ['link', 'url', 'href', '链接', '超链接'], slashCommand: true },
        { id: 'table', label: t('slash.table'), desc: t('slash.table.desc'), icon: ICONS.table, group: 'insert', keywords: ['table', '表格'], slashCommand: true },
        { id: 'image', label: t('slash.image'), desc: t('slash.image.desc'), icon: ICONS.image, group: 'insert', keywords: ['image', 'img', '图片'], slashCommand: true },
        { id: 'inlineMath', label: t('slash.inlineMath'), desc: t('slash.inlineMath.desc'), icon: ICONS.inlineMath, group: 'insert', keywords: ['math', 'formula', 'latex', 'katex', '公式', '数学', '行内'], slashCommand: true },
        { id: 'math', label: t('slash.blockMath'), desc: t('slash.blockMath.desc'), icon: ICONS.blockMath, group: 'insert', keywords: ['math', 'formula', 'latex', 'katex', 'block', '公式', '数学', '行间'], slashCommand: true },
        { id: 'emoji', label: t('slash.emoji'), desc: t('slash.emoji.desc'), icon: ICONS.emoji, group: 'other', keywords: ['emoji', '表情', 'smile'], slashCommand: false },
    ];
}

// SVG 图标辅助函数（18x18 viewBox，描边风格）
const svgIcon = (path: string) =>
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const ICONS = {
    h1: svgIcon('<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 12l3-2v8"/>'),
    h2: svgIcon('<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>'),
    h3: svgIcon('<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/>'),
    paragraph: svgIcon('<path d="M13 4v16"/><path d="M17 4H9.5a4.5 4.5 0 0 0 0 9H13"/>'),
    bold: svgIcon('<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>'),
    italic: svgIcon('<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>'),
    strike: svgIcon('<line x1="5" y1="12" x2="19" y2="12"/><path d="M16 6C16 6 14.5 4 12 4C9.5 4 8 5.5 8 7.5C8 9.5 10 10.5 12 11"/><path d="M8 18C8 18 9.5 20 12 20C14.5 20 16 18.5 16 16.5C16 14.5 14 13.5 12 13"/>'),
    inlineCode: svgIcon('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><line x1="10" y1="2" x2="14" y2="22" opacity="0.4"/>'),
    ul: svgIcon('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/>'),
    ol: svgIcon('<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="4" y="8" font-size="7" fill="currentColor" stroke="none" font-weight="600">1</text><text x="4" y="14" font-size="7" fill="currentColor" stroke="none" font-weight="600">2</text><text x="4" y="20" font-size="7" fill="currentColor" stroke="none" font-weight="600">3</text>'),
    task: svgIcon('<rect x="3" y="5" width="6" height="6" rx="1"/><path d="M4.5 8l1.5 1.5 3-3"/><line x1="13" y1="8" x2="21" y2="8"/><rect x="3" y="14" width="6" height="6" rx="1"/><line x1="13" y1="17" x2="21" y2="17"/>'),
    quote: svgIcon('<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2H5c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-3c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/>'),
    code: svgIcon('<rect x="2" y="4" width="20" height="16" rx="3" ry="3"/><polyline points="8.5 10 6 12 8.5 14"/><polyline points="15.5 10 18 12 15.5 14"/><line x1="11" y1="9" x2="13" y2="15" opacity="0.7"/>'),
    hr: svgIcon('<line x1="3" y1="12" x2="21" y2="12"/>'),
    table: svgIcon('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>'),
    image: svgIcon('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
    link: svgIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    inlineMath: svgIcon('<text x="3" y="18" font-size="20" fill="currentColor" stroke="none" font-style="italic" font-family="serif">∑</text><text x="14" y="10" font-size="14" fill="currentColor" stroke="none" font-family="serif">x²</text>'),
    blockMath: svgIcon('<rect x="2" y="2" width="20" height="20" rx="3" fill="none"/><text x="12" y="16" font-size="13" fill="currentColor" stroke="none" text-anchor="middle" font-style="italic" font-family="serif">∫</text>'),
    emoji: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M15 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-6 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" fill="currentColor"/><path d="M8 15c1.5 1 3.5 1 5 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
    indent: svgIcon('<line x1="21" y1="5" x2="21" y2="19" stroke-width="2.5"/><polyline points="13 8 17 12 13 16"/><line x1="3" y1="12" x2="17" y2="12"/><line x1="3" y1="7" x2="9" y2="7"/><line x1="3" y1="17" x2="9" y2="17"/>'),
    outdent: svgIcon('<line x1="3" y1="5" x2="3" y2="19" stroke-width="2.5"/><polyline points="11 8 7 12 11 16"/><line x1="7" y1="12" x2="21" y2="12"/><line x1="15" y1="7" x2="21" y2="7"/><line x1="15" y1="17" x2="21" y2="17"/>'),
};
