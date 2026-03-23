/**
 * 浮动菜单视口溢出调整 hook。
 * 当菜单在视口底部或右侧溢出时，自动调整菜单位置，
 * 使其完全可见。供 SlashMenu 和 PathCompletionMenu 共用。
 */
import { useEffect, type RefObject } from 'react';

interface MenuCoords {
    left: number;
    top: number;
    bottom: number;
}

/**
 * 在菜单渲染后通过 requestAnimationFrame 检测视口溢出并调整位置。
 *
 * @param menuRef   菜单容器的 ref
 * @param visible   菜单是否可见
 * @param coords    锚点坐标（包含 left、top、bottom）
 * @param itemCount 菜单项数量（变化时重新计算位置）
 * @param options   可选配置项
 */
export function useMenuPosition(
    menuRef: RefObject<HTMLElement | null>,
    visible: boolean,
    coords: MenuCoords | null,
    itemCount: number,
    options?: { minLeft?: number },
) {
    useEffect(() => {
        if (!visible || !menuRef.current || !coords) return;
        requestAnimationFrame(() => {
            const menu = menuRef.current!;
            const rect = menu.getBoundingClientRect();
            let newTop = coords.bottom + 4;
            let newLeft = coords.left;
            if (newTop + rect.height > window.innerHeight) {
                newTop = coords.top - rect.height - 4;
            }
            if (newLeft + rect.width > window.innerWidth) {
                newLeft = window.innerWidth - rect.width - 8;
            }
            const minLeft = options?.minLeft ?? 0;
            if (newLeft < minLeft) newLeft = minLeft;
            menu.style.top = `${newTop}px`;
            menu.style.left = `${newLeft}px`;
        });
    }, [visible, coords, itemCount]);
}
