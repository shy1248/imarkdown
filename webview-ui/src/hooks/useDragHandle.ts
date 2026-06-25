/**
 * 封装拖拽手柄相关的 refs、中间件和回调，
 * 以稳定引用暴露给 DragHandle 组件，避免不必要的重渲染。
 */
import { useRef, useMemo, useCallback, useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { computePosition } from '@floating-ui/dom';

export interface DragHandleHook {
    /** 当前悬停节点的文档位置 */
    dragNodePosRef: React.MutableRefObject<number>;
    /** 稳定的 floating-ui 中间件（对齐手柄到第一行中点） */
    dragMiddleware: object;
    /** 传给 DragHandle.computePositionConfig */
    dragComputePositionConfig: object;
    /** 传给 DragHandle.onNodeChange */
    onDragNodeChange: (args: { node: PmNode | null; pos: number }) => void;
}

export function useDragHandle(editorRef: React.MutableRefObject<Editor | null>): DragHandleHook {
    const dragNodePosRef = useRef<number>(-1);
    /**
     * 从参考元素顶部到对齐点的 Y 偏移（像素），而非视口绝对坐标。
     * 普通节点 = lineHeight / 2，矮节点（如 <hr>）= 节点高度 / 2。
     * 使用相对偏移量确保滚动后位置计算始终正确。
     */
    const dragFirstLineOffsetRef = useRef<number>(12);

    // 稳定的 floating-ui 中间件：基于 state.rects.reference（始终最新）+ 缓存的相对偏移量
    const dragMiddleware = useMemo(() => ({
        name: 'firstLineMid',
        fn(state: { x: number; y: number; rects: { reference: { x: number; y: number; width: number; height: number } }; elements: { floating: HTMLElement } }) {
            // state.rects.reference.y 在每次 computePosition 调用时实时获取，始终反映当前滚动位置
            const refY = state.rects.reference.y;
            const offset = dragFirstLineOffsetRef.current;
            const floatingParent = (state.elements.floating.offsetParent as HTMLElement) ?? document.body;
            const parentRect = floatingParent.getBoundingClientRect();
            const buttonHalfH = state.elements.floating.offsetHeight / 2;
            const mid = refY + offset;
            const newY = mid - parentRect.top + floatingParent.scrollTop - buttonHalfH;
            return { y: newY };
        },
    }), []);

    // 稳定的 computePositionConfig：已 memoized，避免 DragHandle 的 useEffect
    // 在每次渲染时重新运行
    const dragComputePositionConfig = useMemo(() => ({
        placement: 'left-start' as const,
        strategy: 'absolute' as const,
        middleware: [dragMiddleware],
    }), [dragMiddleware]);

    // 稳定的 onNodeChange 回调：所有可变状态均通过 ref 访问
    const onDragNodeChange = useCallback(({ node, pos }: { node: PmNode | null; pos: number }) => {
        dragNodePosRef.current = pos;
        // 计算对齐点到参考元素顶部的 Y 偏移量（像素）。
        // 规则：
        //   1. 始终使用节点 DOM 自身的 lineHeight（不查询内部子元素），
        //      避免 blockquote 内含标题时行高异常偏大。
        //   2. 若 lineHeight 为 'normal' / NaN（如 <hr>），回退到编辑器
        //      容器（.ProseMirror）的 lineHeight，与代码块行为保持一致。
        //   3. 若节点自身高度小于一行文本行高（如 <hr>），直接用节点
        //      的视觉中心，避免按钮偏移。
        dragFirstLineOffsetRef.current = 12; // 默认回退值
        if (node == null || pos < 0 || !editorRef.current) return;
        const dom = editorRef.current.view.nodeDOM(pos) as HTMLElement | null;
        if (!dom) return;
        const rect = dom.getBoundingClientRect();
        // 优先取节点 DOM 自身的 lineHeight
        let lh = parseFloat(getComputedStyle(dom).lineHeight);
        if (!lh || isNaN(lh)) {
            // 回退：取编辑器容器（.ProseMirror）的 lineHeight，与代码块行为一致
            const proseMirror = editorRef.current.view.dom as HTMLElement;
            lh = parseFloat(getComputedStyle(proseMirror).lineHeight);
        }
        if (!lh || isNaN(lh)) lh = 24; // 兜底值
        // 节点矮于一行文本（如 <hr>）→ 按节点视觉中心对齐
        if (rect.height < lh) {
            dragFirstLineOffsetRef.current = rect.height / 2;
        } else {
            dragFirstLineOffsetRef.current = lh / 2;
        }
    }, []); // 空依赖：所有可变值均通过稳定 ref 读取

    /**
     * 直接调用 floating-ui computePosition 重算手柄位置。
     * 绕过 DragHandlePlugin mousemove 的 targetNode !== currentNode 守卫，
     * 确保滚动后同一节点上的手柄也能正确定位。
     */
    const repositionHandle = useCallback(() => {
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed) return;
        const handle = document.querySelector('.drag-handle') as HTMLElement | null;
        if (!handle) return;
        // 仅在手柄可见时重算（隐藏状态下下次 showHandle 会自然触发）
        if (handle.style.visibility === 'hidden') return;
        const pos = dragNodePosRef.current;
        if (pos < 0) return;
        const dom = ed.view.nodeDOM(pos) as HTMLElement | null;
        if (!dom) return;

        computePosition(
            { getBoundingClientRect: () => dom.getBoundingClientRect() },
            handle,
            dragComputePositionConfig as Parameters<typeof computePosition>[2],
        ).then((val) => {
            Object.assign(handle.style, {
                left: `${val.x}px`,
                top: `${val.y}px`,
            });
        });
    }, [dragComputePositionConfig]);

    // 监听滚动容器的 scroll 事件：滚动停止后重算手柄位置
    useEffect(() => {
        const root = document.getElementById('root');
        if (!root) return;

        let scrollTimer: ReturnType<typeof setTimeout> | null = null;
        const onScroll = () => {
            if (scrollTimer) clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                scrollTimer = null;
                repositionHandle();
            }, 100);
        };
        root.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            root.removeEventListener('scroll', onScroll);
            if (scrollTimer) clearTimeout(scrollTimer);
        };
    }, [repositionHandle]);

    return { dragNodePosRef, dragMiddleware, dragComputePositionConfig, onDragNodeChange };
}
