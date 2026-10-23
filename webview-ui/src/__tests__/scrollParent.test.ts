/**
 * getScrollParent 的测试（src/editor/editorUtils.ts）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getScrollParent } from '../editor/editorUtils';

/** jsdom 中 scrollHeight/clientHeight 为只读 0，这里按需伪造。 */
function mockScrollable(el: HTMLElement, overflowY: string, scrollable: boolean): void {
    el.style.overflowY = overflowY;
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: scrollable ? 200 : 100, configurable: true });
}

describe('getScrollParent', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        document.body.removeAttribute('style');
    });

    it('应返回最近的纵向可滚动祖先', () => {
        const outer = document.createElement('div');
        const inner = document.createElement('div');
        const target = document.createElement('div');
        mockScrollable(outer, 'auto', true);
        outer.appendChild(inner);
        inner.appendChild(target);
        document.body.appendChild(outer);

        expect(getScrollParent(target)).toBe(outer);
    });

    it('内容未溢出时不应视为可滚动父级', () => {
        const parent = document.createElement('div');
        const target = document.createElement('div');
        mockScrollable(parent, 'auto', false);
        parent.appendChild(target);
        document.body.appendChild(parent);

        expect(getScrollParent(target)).not.toBe(parent);
    });

    it('overflow 为 visible 时不应视为可滚动父级', () => {
        const parent = document.createElement('div');
        const target = document.createElement('div');
        mockScrollable(parent, 'visible', true);
        parent.appendChild(target);
        document.body.appendChild(parent);

        expect(getScrollParent(target)).not.toBe(parent);
    });

    it('无可滚动祖先且 body 不可滚动时应回退到 documentElement', () => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        expect(getScrollParent(target)).toBe(document.documentElement);
    });

    it('body 可滚动时应返回 body', () => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        mockScrollable(document.body, 'auto', true);
        expect(getScrollParent(target)).toBe(document.body);
    });
});