/**
 * 编辑器布局配置解析函数的测试套件（src/utils/editorLayout.ts）。
 */
import * as assert from 'assert';
import {
    clampMinWidth,
    clampPadding,
    getLayoutSpacing,
    LAYOUT_SPACING,
    MIN_WIDTH,
    PADDING,
} from '../utils/editorLayout';

describe('clampMinWidth', () => {
    it('缺省/非法值应回退到默认值', () => {
        assert.strictEqual(clampMinWidth(undefined), MIN_WIDTH.default);
        assert.strictEqual(clampMinWidth(null), MIN_WIDTH.default);
        assert.strictEqual(clampMinWidth(NaN), MIN_WIDTH.default);
    });

    it('低于下限应提升到下限', () => {
        assert.strictEqual(clampMinWidth(600), MIN_WIDTH.min);
        assert.strictEqual(clampMinWidth(-1), MIN_WIDTH.min);
    });

    it('高于上限应压到上限', () => {
        assert.strictEqual(clampMinWidth(9999), MIN_WIDTH.max);
    });

    it('区间内应原样返回', () => {
        assert.strictEqual(clampMinWidth(900), 900);
        assert.strictEqual(clampMinWidth(MIN_WIDTH.min), MIN_WIDTH.min);
        assert.strictEqual(clampMinWidth(MIN_WIDTH.max), MIN_WIDTH.max);
    });
});

describe('clampPadding', () => {
    it('缺省/非法值应回退到默认值', () => {
        assert.strictEqual(clampPadding(undefined), PADDING.default);
        assert.strictEqual(clampPadding(NaN), PADDING.default);
    });

    it('应限制在有效区间', () => {
        assert.strictEqual(clampPadding(10), PADDING.min);
        assert.strictEqual(clampPadding(500), PADDING.max);
        assert.strictEqual(clampPadding(75), 75);
    });
});

describe('getLayoutSpacing', () => {
    it('应返回各布局对应的间距', () => {
        assert.deepStrictEqual(getLayoutSpacing('compact'), { inline: '0.3em', block: '0.5em' });
        assert.deepStrictEqual(getLayoutSpacing('moderate'), { inline: '0.5em', block: '0.85em' });
        assert.deepStrictEqual(getLayoutSpacing('loose'), { inline: '0.8em', block: '1.3em' });
    });

    it('未知或缺失布局应回退到 moderate', () => {
        assert.deepStrictEqual(getLayoutSpacing('unknown'), LAYOUT_SPACING.moderate);
        assert.deepStrictEqual(getLayoutSpacing(undefined), LAYOUT_SPACING.moderate);
        assert.deepStrictEqual(getLayoutSpacing(null), LAYOUT_SPACING.moderate);
    });

    it('所有布局都应提供非空间距', () => {
        for (const [name, spacing] of Object.entries(LAYOUT_SPACING)) {
            assert.ok(spacing.inline, `${name}.inline 不应为空`);
            assert.ok(spacing.block, `${name}.block 不应为空`);
        }
    });
});