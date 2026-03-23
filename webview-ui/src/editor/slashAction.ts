import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { t } from '../i18n';
import { getAllCommands, type CommandDefined } from './editorCommands';
import { LINK_WIDGET_KEY } from './link/linkInsert';

export function filterSlashCommands(query: string): CommandDefined[] {
    const commands = getAllCommands().filter(cmd => cmd.slashCommand);
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter((cmd) => {
        if (cmd.label.toLowerCase().includes(q)) return true;
        if (cmd.id.toLowerCase().includes(q)) return true;
        if (cmd.desc.toLowerCase().includes(q)) return true;
        return cmd.keywords.some((kw) => kw.includes(q));
    });
}

export interface SlashCommandCallbacks {
    onShow: (coords: { left: number; top: number; bottom: number }, query: string) => void;
    onHide: () => void;
    onUpdate: (query: string) => void;
    onUpdateCoords: (coords: { left: number; top: number; bottom: number }) => void;
    onNavigate: (direction: 1 | -1) => void;
    onConfirm: () => void;
    isVisible: () => boolean;
    getRange: () => { from: number; to: number } | null;
    setRange: (range: { from: number; to: number } | null) => void;
}

export function slashAction(callbacks: SlashCommandCallbacks) {
    return Extension.create({
        name: 'slashCommand',
        addProseMirrorPlugins() {
            let localVisible = false;

            return [
                new Plugin({
                    key: new PluginKey('slashCommand'),
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
                        decorations: (state) => {
                            const decorations: any[] = [];
                            const { $anchor, $from } = state?.selection;
                            if (!$from) return DecorationSet.empty;
                            const isInSpecialBlock = isInSlashBlockedContext($from);
                            if (!isInSpecialBlock && $from.parent.isTextblock) {
                                const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
                                const linkWidgetOpen = LINK_WIDGET_KEY.getState(state)?.anchor != null;
                                if (!textBefore.match(/^@(.*)$/) && $from.parent.textContent.trim() === '' && $from.parent.content.size === 0 && !linkWidgetOpen) {                                    const blockStart = $anchor.before($anchor.depth);
                                    const blockEnd = $anchor.after($anchor.depth);
                                    decorations.push(
                                        Decoration.node(blockStart, blockEnd, {
                                            class: 'empty-paragraph-with-placeholder',
                                            'data-placeholder': t('slash.placeholder'),
                                        })
                                    );
                                }
                            }
                            return DecorationSet.create(state.doc, decorations);
                        },
                    },
                    view(editorView) {
                        let scrollRafId = 0;
                        const scrollHandler = (e: Event) => {
                            const target = e.target as HTMLElement | null;
                            if (target && target.closest?.('.slash-menu')) return;
                            if (!localVisible) return;
                            if (scrollRafId) return;
                            scrollRafId = requestAnimationFrame(() => {                                scrollRafId = 0;
                                if (!localVisible) return;
                                try {
                                    const { $from } = editorView.state.selection;
                                    const coords = editorView.coordsAtPos($from.pos);
                                    const editorRect = editorView.dom.getBoundingClientRect();
                                    const isOffScreen =
                                        coords.top < editorRect.top - 20 ||
                                        coords.bottom > editorRect.bottom + 20 ||
                                        coords.top < 0 ||
                                        coords.bottom > window.innerHeight;
                                    if (isOffScreen) {
                                        callbacks.onUpdateCoords({ left: -9999, top: -9999, bottom: -9999 });
                                    } else {
                                        callbacks.onUpdateCoords(coords);
                                    }
                                } catch {
                                    callbacks.onUpdateCoords({ left: -9999, top: -9999, bottom: -9999 });
                                }
                            });
                        };
                        window.addEventListener('scroll', scrollHandler, true);

                        return {
                            update(view) {
                                const { $from } = view?.state?.selection;
                                const isInSpecialBlock = isInSlashBlockedContext($from);
                                if (!$from.parent.isTextblock || isInSpecialBlock) {
                                    if (localVisible) { localVisible = false; callbacks.onHide(); }
                                    return;
                                }

                                const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
                                // 在其他内容为空的块首输入 @ 时触发
                                const match = textBefore.match(/^\/(.*)$/);
                                if (match) {
                                    const query = match[1] || '';
                                    const blockStart = $from.start();
                                    callbacks.setRange({ from: blockStart, to: blockStart + textBefore.length });
                                    const coords = view.coordsAtPos($from.pos);
                                    if (localVisible) {
                                        callbacks.onUpdate(query);
                                    } else {
                                        localVisible = true;
                                        callbacks.onShow(coords, query);
                                    }
                                } else {
                                    if (localVisible) { localVisible = false; callbacks.onHide(); }
                                }
                            },
                            destroy() {
                                localVisible = false;
                                callbacks.onHide();
                                window.removeEventListener('scroll', scrollHandler, true);
                                if (scrollRafId) cancelAnimationFrame(scrollRafId);
                            },
                        };
                    },
                }),
            ];
        },
    });
}


function isInSlashBlockedContext($from: any) {
    for (let depth = $from.depth; depth > 0; depth--) {
        const nodeType = $from.node(depth).type.name;
        if (nodeType === 'tableCell' ||
            nodeType === 'tableHeader' ||
            nodeType === 'listItem' ||
            nodeType === 'taskItem' ||
            nodeType === 'blockquote' ||
            nodeType === 'codeBlock') {
            return true;
        }
    }
    return false;
}
