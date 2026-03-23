/**
 * 封装拖拽手柄相关的 refs、中间件和回调，
 * 以稳定引用暴露给 DragHandle 组件，避免不必要的重渲染。
 */
import { useRef, useMemo, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';

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
    const dragFirstLineMidRef = useRef<number | null>(null);

    // 稳定的 floating-ui 中间件：在调用时从 dragFirstLineMidRef 读取最新值
    const dragMiddleware = useMemo(() => ({
        name: 'firstLineMid',
        fn({ y, elements }: { y: number; elements: { floating: HTMLElement } }) {
            const mid = dragFirstLineMidRef.current;
            if (mid == null) return {};
            // 将页面绝对坐标转换为浮动元素 offsetParent 的坐标空间
            const floatingParent = (elements.floating.offsetParent as HTMLElement) ?? document.body;
            const parentRect = floatingParent.getBoundingClientRect();
            const buttonHalfH = elements.floating.offsetHeight / 2;
            const newY = mid - parentRect.top + (floatingParent as HTMLElement).scrollTop - buttonHalfH;
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
        // 计算悬停节点第一行文本的垂直中点，将手柄对齐到第一行中心（Notion 风格）。
        // 规则：
        //   1. 始终使用节点 DOM 自身的 lineHeight（不查询内部子元素），
        //      避免 blockquote 内含标题时行高异常偏大。
        //   2. 若 lineHeight 为 'normal' / NaN（如 <hr>），回退到编辑器
        //      容器（.ProseMirror）的 lineHeight，与代码块行为保持一致。
        //   3. 若节点自身高度小于一行文本行高（如 <hr>），直接用节点
        //      的视觉中心（rect.top + rect.height / 2），避免按钮偏移。
        dragFirstLineMidRef.current = null;
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
            dragFirstLineMidRef.current = rect.top + rect.height / 2;
        } else {
            dragFirstLineMidRef.current = rect.top + lh / 2;
        }
    }, []); // 空依赖：所有可变值均通过稳定 ref 读取

    return { dragNodePosRef, dragMiddleware, dragComputePositionConfig, onDragNodeChange };
}
