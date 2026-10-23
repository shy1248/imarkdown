/**
 * vscode.ts webview 通信桥接的测试。
 * 测试环境没有 acquireVsCodeApi，应回退到内存实现。
 */
import { describe, it, expect, vi } from 'vitest';
import { getState, markHandlersReady, onMessage, postMessage, setState } from '../vscode';

describe('vscode bridge', () => {
    it('缺少 acquireVsCodeApi 时 postMessage 不应抛错', () => {
        expect(() => postMessage({ type: 'noop' })).not.toThrow();
    });

    it('getState / setState 应在内存中往返', () => {
        setState({ text: 'hello' });
        expect(getState()).toEqual({ text: 'hello' });
    });

    it('onMessage 应按 type 分发消息', () => {
        const handler = vi.fn();
        const off = onMessage('test-message', handler);
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'test-message', value: 1 } }));
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ type: 'test-message', value: 1 });
        off();
    });

    it('取消订阅后不应再收到消息', () => {
        const handler = vi.fn();
        const off = onMessage('test-message-2', handler);
        off();
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'test-message-2' } }));
        expect(handler).not.toHaveBeenCalled();
    });

    it('仅在注册后到达的消息应正常分发', () => {
        markHandlersReady();
        const handler = vi.fn();
        onMessage('after-ready', handler);
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'after-ready' } }));
        expect(handler).toHaveBeenCalledTimes(1);
    });
});