/**
 * 编辑器布局配置的共享常量与解析函数（纯函数）。
 * 扩展宿主（editorProvider / webviewHtml）都从这里取值，避免多处重复定义。
 */

export type EditorLayout = 'compact' | 'moderate' | 'loose';

export interface LayoutSpacing {
    /** 段落、列表等行内间距 */
    inline: string;
    /** pre、blockquote、表格等块级间距 */
    block: string;
}

export const LAYOUT_SPACING: Record<EditorLayout, LayoutSpacing> = {
    compact:  { inline: '0.3em', block: '0.5em' },
    moderate: { inline: '0.5em', block: '0.85em' },
    loose:    { inline: '0.8em', block: '1.3em' },
};

export const MIN_WIDTH = { default: 800, min: 800, max: 1200 } as const;
export const PADDING = { default: 50, min: 50, max: 100 } as const;

export function clampMinWidth(value: number | undefined | null): number {
    if (typeof value !== 'number' || isNaN(value)) return MIN_WIDTH.default;
    return Math.min(MIN_WIDTH.max, Math.max(MIN_WIDTH.min, value));
}

export function clampPadding(value: number | undefined | null): number {
    if (typeof value !== 'number' || isNaN(value)) return PADDING.default;
    return Math.min(PADDING.max, Math.max(PADDING.min, value));
}

/** 根据布局名称取间距，未知值回退到 moderate。 */
export function getLayoutSpacing(layout: string | undefined | null): LayoutSpacing {
    return LAYOUT_SPACING[(layout ?? '') as EditorLayout] ?? LAYOUT_SPACING.moderate;
}
