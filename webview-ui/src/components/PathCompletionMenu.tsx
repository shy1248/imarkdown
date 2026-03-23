import { useEffect, useRef } from 'react';
import type { PathCompletionItem } from '../editor/markdown/pathCompletion';
import { useMenuPosition } from '../hooks/useMenuPosition';

interface PathCompletionMenuProps {
    visible: boolean;
    items: PathCompletionItem[];
    coords: { left: number; top: number; bottom: number } | null;
    activeIndex: number;
    onSelect: (item: PathCompletionItem) => void;
}

export function PathCompletionMenu({
    visible,
    items,
    coords,
    activeIndex,
    onSelect,
}: PathCompletionMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    // 将当前激活项滚动到可视范围
    useEffect(() => {
        if (!visible || !menuRef.current) return;
        const activeEl = menuRef.current.querySelector('.path-completion-item.active');
        activeEl?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, visible]);

    // 视口溢出调整
    useMenuPosition(menuRef, visible, coords, items.length, { minLeft: 4 });

    if (!visible || !coords) return null;

    const style: React.CSSProperties = {
        position: 'fixed',
        left: coords.left,
        top: coords.bottom + 4,
        zIndex: 9999,
    };

    return (
        <div
            ref={menuRef}
            className="path-completion-dropdown"
            style={style}
        >
            {items.length === 0 ? null : items.map((item, idx) => (
                <div
                    key={item.label}
                    className={`path-completion-item${idx === activeIndex ? ' active' : ''}`}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelect(item);
                    }}
                >
                    <span className="path-completion-icon">{item.isDir ? '📁' : '📄'}</span>
                    <span className="path-completion-label" title={item.label}>
                        {(() => {
                            const parts = item.label.replace(/\\/g, '/').split('/').filter(Boolean);
                            const name = parts.at(-1) ?? item.label;
                            return item.isDir ? name + '/' : name;
                        })()}
                    </span>
                </div>
            ))}
        </div>
    );
}
