/**
 * editorPanelHelper.ts 的测试 — generatePanelId、broadcastPanelOpen、onOtherPanelOpen
 *
 * 这些测试在 Node/vitest 环境中运行，对 `window` 事件进行了模拟。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePanelId, broadcastPanelOpen, onOtherPanelOpen } from '../editor/editorPanelHelper';

describe('generatePanelId', () => {
    it('应以给定的前缀开头', () => {
        const id = generatePanelId('image');
        expect(id.startsWith('image-')).toBe(true);
    });

    it('应生成唯一 ID', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) {
            ids.add(generatePanelId('test'));
        }
        // 使用 Math.random，100 个 ID 应全部唯一（碰撞概率极低）
        expect(ids.size).toBe(100);
    });

    it('前缀后应包含随机后缀', () => {
        const id = generatePanelId('math');
        const suffix = id.slice('math-'.length);
        expect(suffix.length).toBeGreaterThan(0);
        // 后缀应为字母数字（base36）
        expect(/^[a-z0-9]+$/.test(suffix)).toBe(true);
    });
});

describe('broadcastPanelOpen & onOtherPanelOpen', () => {
    // vitest + jsdom 提供 window 和 CustomEvent
    it('其他面板广播时应调用 onClose', () => {
        const onClose = vi.fn();
        const myPanelId = 'panel-mine';
        const cleanup = onOtherPanelOpen(myPanelId, onClose);

        broadcastPanelOpen('panel-other');
        expect(onClose).toHaveBeenCalledTimes(1);

        cleanup();
    });

    it('同一面板广播时不应调用 onClose', () => {
        const onClose = vi.fn();
        const myPanelId = 'panel-mine';
        const cleanup = onOtherPanelOpen(myPanelId, onClose);

        broadcastPanelOpen(myPanelId);
        expect(onClose).not.toHaveBeenCalled();

        cleanup();
    });

    it('cleanup 后应停止监听', () => {
        const onClose = vi.fn();
        const myPanelId = 'panel-mine';
        const cleanup = onOtherPanelOpen(myPanelId, onClose);

        cleanup();
        broadcastPanelOpen('panel-other');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('应支持多个监听器', () => {
        const onClose1 = vi.fn();
        const onClose2 = vi.fn();
        const cleanup1 = onOtherPanelOpen('panel-1', onClose1);
        const cleanup2 = onOtherPanelOpen('panel-2', onClose2);

        // 面板 3 打开 → 面板 1 和 2 均应关闭
        broadcastPanelOpen('panel-3');
        expect(onClose1).toHaveBeenCalledTimes(1);
        expect(onClose2).toHaveBeenCalledTimes(1);

        cleanup1();
        cleanup2();
    });

    it('只应通知其他面板，不通知自身', () => {
        const onClose1 = vi.fn();
        const onClose2 = vi.fn();
        const cleanup1 = onOtherPanelOpen('panel-1', onClose1);
        const cleanup2 = onOtherPanelOpen('panel-2', onClose2);

        // 面板 1 广播 → 只有面板 2 应关闭
        broadcastPanelOpen('panel-1');
        expect(onClose1).not.toHaveBeenCalled();
        expect(onClose2).toHaveBeenCalledTimes(1);

        cleanup1();
        cleanup2();
    });
});
