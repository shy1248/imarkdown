import { useState, useEffect, useCallback, useRef } from 'react';
import { Editor } from '@tiptap/core';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { t } from '../i18n';

const searchPluginKey = new PluginKey('searchHighlight');

const CLOSE_ANIMATION_MS = 200;

interface SearchBarProps {
    editor: Editor | null;
}

const ICONS = {
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
    down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

function findAllMatches(editor: Editor, query: string): { from: number; to: number }[] {
    if (!query) return [];
    const results: { from: number; to: number }[] = [];
    const doc = editor.state.doc;
    const lowerQuery = query.toLowerCase();
    doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        const text = node.text.toLowerCase();
        let idx = 0;
        while (true) {
            const found = text.indexOf(lowerQuery, idx);
            if (found === -1) break;
            results.push({ from: pos + found, to: pos + found + query.length });
            idx = found + 1;
        }
    });
    return results;
}

export function createSearchPlugin() {
    return new Plugin({
        key: searchPluginKey,
        state: {
            init() {
                return { decorations: DecorationSet.empty, matches: [] as { from: number; to: number }[], activeIndex: -1 };
            },
            apply(tr, prev) {
                const meta = tr.getMeta(searchPluginKey);
                if (meta) {
                    const { matches, activeIndex } = meta as { matches: { from: number; to: number }[]; activeIndex: number };
                    const decos = matches.map((m, i) =>
                        Decoration.inline(m.from, m.to, {
                            class: i === activeIndex ? 'search-match search-match-active' : 'search-match',
                        })
                    );
                    return { decorations: DecorationSet.create(tr.doc, decos), matches, activeIndex };
                }
                if (tr.docChanged && prev.matches.length > 0) {
                    return {
                        decorations: prev.decorations.map(tr.mapping, tr.doc),
                        matches: prev.matches.map(m => ({ from: tr.mapping.map(m.from), to: tr.mapping.map(m.to) })),
                        activeIndex: prev.activeIndex,
                    };
                }
                return prev;
            },
        },
        props: {
            decorations(state) { return this.getState(state)?.decorations ?? DecorationSet.empty; },
        },
    });
}

export function SearchBar({ editor }: SearchBarProps) {
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState<{ from: number; to: number }[]>([]);
    const [activeIndex, setActiveIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const matchesRef = useRef(matches);
    const activeIndexRef = useRef(activeIndex);
    matchesRef.current = matches;
    activeIndexRef.current = activeIndex;

    const updateDecorations = useCallback((newMatches: { from: number; to: number }[], newActiveIndex: number) => {
        if (!editor) return;
        editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, { matches: newMatches, activeIndex: newActiveIndex }));
    }, [editor]);

    const clearDecorations = useCallback(() => {
        if (!editor) return;
        editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, { matches: [], activeIndex: -1 }));
    }, [editor]);

    useEffect(() => {
        if (!editor || !open) return;
        if (!query) { setMatches([]); setActiveIndex(-1); clearDecorations(); return; }
        const found = findAllMatches(editor, query);
        setMatches(found);
        const idx = found.length > 0 ? 0 : -1;
        setActiveIndex(idx);
        updateDecorations(found, idx);
        if (found.length > 0) scrollToMatch(editor, found[0]);
    }, [query, open, editor]);

    useEffect(() => {
        if (!editor || !open || !query) return;
        const handler = () => {
            const found = findAllMatches(editor, query);
            setMatches(found);
            setActiveIndex(prev => {
                const newIdx = found.length > 0 ? Math.min(prev < 0 ? 0 : prev, found.length - 1) : -1;
                updateDecorations(found, newIdx >= 0 ? newIdx : -1);
                return newIdx >= 0 ? newIdx : -1;
            });
        };
        editor.on('update', handler);
        return () => { editor.off('update', handler); };
    }, [editor, open, query, updateDecorations]);

    function scrollToMatch(ed: Editor, match: { from: number; to: number }) {
        try {
            const { state, view } = ed;
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, match.from)));
        } catch { /* ignore */ }
        requestAnimationFrame(() => {
            try {
                const activeEl = document.querySelector('.search-match-active') as HTMLElement | null;
                if (activeEl) { activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
                const coords = editor?.view.coordsAtPos(match.from);
                if (coords) {
                    const target = document.documentElement.scrollTop + coords.top - window.innerHeight / 3;
                    document.documentElement.scrollTo({ top: target, behavior: 'smooth' });
                }
            } catch { /* ignore */ }
        });
    }

    function goToMatch(newIndex: number) {
        const currentMatches = matchesRef.current;
        if (!editor || currentMatches.length === 0) return;
        const idx = ((newIndex % currentMatches.length) + currentMatches.length) % currentMatches.length;
        setActiveIndex(idx);
        updateDecorations(currentMatches, idx);
        scrollToMatch(editor, currentMatches[idx]);
    }

    function startClose(focusEditor = true) {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        setClosing(true);
        clearDecorations();
        closeTimerRef.current = setTimeout(() => {
            setOpen(false); setClosing(false); setQuery(''); setMatches([]); setActiveIndex(-1);
            closeTimerRef.current = null;
            if (focusEditor && editor) editor.commands.focus(undefined, { scrollIntoView: false });
        }, CLOSE_ANIMATION_MS);
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Escape') { startClose(true); }
        else if (e.key === 'Enter') {
            e.preventDefault();
            goToMatch(e.shiftKey ? activeIndexRef.current - 1 : activeIndexRef.current + 1);
        }
    }

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                if (open && !closing) { startClose(true); }
                else if (!open) {
                    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
                    setClosing(false); setOpen(true);
                    setTimeout(() => inputRef.current?.focus(), 0);
                }
            }
            if (e.key === 'Escape' && open && !closing) startClose(true);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, closing, editor]);

    const wrapperClass = ['search-bar-wrapper', open ? 'search-bar-wrapper--open' : '', closing ? 'search-bar-wrapper--closing' : ''].filter(Boolean).join(' ');

    return (
        <div className={wrapperClass}>
            {!open && (
                <button
                    className="toolbar-btn search-toggle-btn"
                    title={t('search.placeholder')}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
                        setClosing(false); setOpen(true);
                        setTimeout(() => inputRef.current?.focus(), 0);
                    }}
                    dangerouslySetInnerHTML={{ __html: ICONS.search }}
                />
            )}
            {open && (
                <div className={`search-bar${closing ? ' search-bar--closing' : ''}`}>
                    <span className="search-bar-icon" dangerouslySetInnerHTML={{ __html: ICONS.search }} />
                    <input
                        ref={inputRef}
                        className="search-bar-input"
                        type="text"
                        placeholder={t('search.placeholder')}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        autoFocus
                    />
                    <span className="search-bar-count">
                        {query ? (matches.length > 0 ? `${activeIndex + 1}/${matches.length}` : t('search.noResults')) : ''}
                    </span>
                    <button className="search-bar-btn" title={t('search.prev')} disabled={matches.length === 0}
                        onMouseDown={(e) => { e.preventDefault(); goToMatch(activeIndexRef.current - 1); }}
                        dangerouslySetInnerHTML={{ __html: ICONS.up }} />
                    <button className="search-bar-btn" title={t('search.next')} disabled={matches.length === 0}
                        onMouseDown={(e) => { e.preventDefault(); goToMatch(activeIndexRef.current + 1); }}
                        dangerouslySetInnerHTML={{ __html: ICONS.down }} />
                    <button className="search-bar-btn" title="Close"
                        onMouseDown={(e) => { e.preventDefault(); startClose(true); }}
                        dangerouslySetInnerHTML={{ __html: ICONS.close }} />
                </div>
            )}
        </div>
    );
}
