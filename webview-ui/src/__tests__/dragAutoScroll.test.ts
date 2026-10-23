/**
 * 拖拽自动滚动速度曲线的测试（src/editor/dragAutoScroll.ts）。
 */
import { describe, it, expect } from 'vitest';
import { computeSpeed } from '../editor/dragAutoScroll';

describe('computeSpeed', () => {
    const ZONE = 200;

    it('贴近边缘时应达到最大速度', () => {
        expect(computeSpeed(0, ZONE)).toBe(28);
        expect(computeSpeed(-10, ZONE)).toBe(28);
    });

    it('到达触发区边界时应为最小速度', () => {
        expect(computeSpeed(ZONE, ZONE)).toBe(6);
        expect(computeSpeed(ZONE * 2, ZONE)).toBe(6);
    });

    it('距离越近速度应单调不减', () => {
        const samples = Array.from({ length: 11 }, (_, i) => computeSpeed((ZONE / 10) * i, ZONE));
        for (let i = 1; i < samples.length; i++) {
            expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]);
        }
    });

    it('结果应落在 [MIN_SPEED, MAX_SPEED] 区间内', () => {
        for (const d of [0, 1, 10, 50, 100, 199, 200, 500]) {
            const speed = computeSpeed(d, ZONE);
            expect(speed).toBeGreaterThanOrEqual(6);
            expect(speed).toBeLessThanOrEqual(28);
        }
    });

    it('zone 非正时应回退到最小速度（避免除零）', () => {
        expect(computeSpeed(10, 0)).toBe(6);
        expect(computeSpeed(10, -5)).toBe(6);
    });
});