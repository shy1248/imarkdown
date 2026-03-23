import { Editor } from '@tiptap/core';
import { postMessage } from '../vscode';

/**
 * 将相对图片 URL 解析为绝对 webview URL。
 */
export function resolveImageUrl(src: string): string {
    if (!src) return src;
    const lower = src.toLowerCase();
    if (lower.startsWith('http://') || lower.startsWith('https://') ||
        lower.startsWith('data:') || lower.startsWith('vscode-resource:') ||
        lower.startsWith('vscode-file:')) {
        return src;
    }
    const baseUri = (window as any).__imarkdownBaseUri || '';
    if (!baseUri) return src;
    try { return new URL(src, baseUri).toString(); } catch { return src; }
}

/**
 * 更新编辑器 DOM 中所有图片元素的 URL 为解析后的绝对地址。
 */
export function updateImageUrls(editorView: any): void {
    const root = editorView?.dom;
    if (!root) return;
    root.querySelectorAll('img').forEach((img: HTMLImageElement) => {
        const current = img.getAttribute('src') || '';
        const resolved = resolveImageUrl(current);
        if (resolved && resolved !== img.src) img.src = resolved;
    });
}

/**
 * 从 TipTap 编辑器提取标题并发送给扩展宿主，用于大纲视图。
 */
export function sendToc(editor: Editor): void {
    const entries: { text: string; level: number; line: number; id: string }[] = [];
    let headingIndex = 0;

    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
            const level = node.attrs.level as number;
            const text = node.textContent;
            const textBefore = editor.state.doc.textBetween(0, pos, '\n', '\n');
            const line = (textBefore.match(/\n/g) || []).length;
            entries.push({ text, level, line, id: `heading-${headingIndex}` });
            headingIndex++;
        }
    });

    postMessage({ type: 'tocChanged', entries });
}

/**
 * 返回元素的可滚动祖先（第一个会滚动的祖先节点），
 * 若不存在则回退到 document.documentElement。
 */
function getScrollParent(el: HTMLElement): HTMLElement {
    let current: HTMLElement | null = el.parentElement;
    while (current) {
        const style = window.getComputedStyle(current);
        if (/auto|scroll/.test(style.overflowY) && current.scrollHeight > current.clientHeight) {
            return current;
        }
        current = current.parentElement;
    }
    // 默认：若 body 可滚动则返回 body，否则返回 documentElement
    const bodyStyle = window.getComputedStyle(document.body);
    if (/auto|scroll/.test(bodyStyle.overflowY) && document.body.scrollHeight > document.body.clientHeight) {
        return document.body;
    }
    return document.documentElement;
}

/**
 * 通过标题索引滚动到对应标题位置。
 * 考虑吸顶工具栏高度，避免标题被遮挡。
 */
export function scrollToHeading(editor: Editor, headingId: string): void {
    const match = headingId.match(/^heading-(\d+)$/);
    if (!match) return;
    const targetIndex = parseInt(match[1], 10);

    const headingPositions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') headingPositions.push(pos);
    });

    if (targetIndex < 0 || targetIndex >= headingPositions.length) return;
    const pos = headingPositions[targetIndex];

    try {
        const dom = editor.view.domAtPos(pos + 1);
        let element: HTMLElement | null = null;
        if (dom.node instanceof HTMLElement) {
            element = dom.node;
        } else if (dom.node.parentElement) {
            element = dom.node.parentElement;
        }
        if (element) {
            const heading = (element.closest('h1,h2,h3,h4,h5,h6') as HTMLElement) || element;
            const toolbar = document.getElementById('toolbar-wrapper');
            const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
            const scrollParent = getScrollParent(heading);
            const isPageScroll = scrollParent === document.documentElement || scrollParent === document.body;
            const headingRect = heading.getBoundingClientRect();
            const containerRect = isPageScroll
                ? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
                : scrollParent.getBoundingClientRect();
            const currentScroll = isPageScroll
                ? (scrollParent.scrollTop || window.scrollY || document.documentElement.scrollTop)
                : scrollParent.scrollTop;
            const relativeTop = headingRect.top - containerRect.top;
            const targetTop = currentScroll + relativeTop - toolbarHeight - 8;

            scrollParent.scrollTo({ top: targetTop, behavior: 'smooth' });
        }
    } catch {
        editor.commands.scrollIntoView();
    }
}
