import { useEffect, useRef, useMemo } from 'react';
import { type CommandDefined, getGroupLabel } from '../editor/editorCommands';
import { filterSlashCommands } from '../editor/slashAction';
import { useMenuPosition } from '../hooks/useMenuPosition';
import { t } from '../i18n';

interface SlashMenuProps {
    visible: boolean;
    query: string;
    coords: { left: number; top: number; bottom: number } | null;
    activeIndex: number;
    onSelect: (cmdId: string) => void;
}

export function SlashMenu({ visible, query, coords, activeIndex, onSelect }: SlashMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const items = filterSlashCommands(query);

    // 按原始顺序分组
    const grouped = useMemo(() => {
        const groups: { group: string; items: CommandDefined[] }[] = [];
        const groupMap = new Map<string, CommandDefined[]>();
        for (const item of items) {
            if (!groupMap.has(item.group)) {
                const arr: CommandDefined[] = [];
                groupMap.set(item.group, arr);
                groups.push({ group: item.group, items: arr });
            }
            groupMap.get(item.group)!.push(item);
        }
        return groups;
    }, [items]);

    // 将当前激活项滚动到可视范围
    useEffect(() => {
        if (!visible || !menuRef.current) return;
        const activeEl = menuRef.current.querySelector('.slash-menu-item.active');
        activeEl?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, visible]);

    // 渲染后视口溢出调整
    useMenuPosition(menuRef, visible, coords, items.length);

    if (!visible || !coords) return null;

    const style: React.CSSProperties = {
        left: coords.left,
        top: coords.top,
    };

    // 平铺索引计数器，用于计算激活状态
    let flatIndex = 0;

    return (
        <div ref={menuRef} className={`slash-menu${visible ? ' is-visible' : ''}`} style={style}>
            {items.length === 0 ? (
                <div className="slash-menu-empty">{t('slash.noMatch')}</div>
            ) : (
                grouped.map(({ group, items: groupItems }) => (
                    <div key={group} className="slash-menu-group">
                        <div className="slash-menu-group-label">{getGroupLabel(group)}</div>
                        {groupItems.map((cmd) => {
                            const idx = flatIndex++;
                            return (
                                <div
                                    key={cmd.id}
                                    className={`slash-menu-item${idx === activeIndex ? ' active' : ''}`}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onSelect(cmd.id);
                                    }}
                                >
                                    <div
                                        className="slash-menu-item-icon"
                                        dangerouslySetInnerHTML={{ __html: cmd.icon }}
                                    />
                                    <div className="slash-menu-item-label">{cmd.label}</div>
                                </div>
                            );
                        })}
                    </div>
                ))
            )}
        </div>
    );
}
