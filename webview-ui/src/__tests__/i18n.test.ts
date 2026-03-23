/**
 * i18n 测试 — 确保 en 和 zh 包含相同的键。
 */
import { describe, it, expect } from 'vitest';
import en from '../i18n/en';
import zh from '../i18n/zh';

describe('i18n 键一致性', () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zh).sort();

    it('en 和 zh 的键数量应相同', () => {
        expect(enKeys.length).toBe(zhKeys.length);
    });

    it('en 的每个键在 zh 中都应存在', () => {
        const missing = enKeys.filter(k => !(k in zh));
        expect(missing).toEqual([]);
    });

    it('zh 的每个键在 en 中都应存在', () => {
        const extra = zhKeys.filter(k => !(k in en));
        expect(extra).toEqual([]);
    });

    it('en 中不应有空字符串值', () => {
        for (const [key, value] of Object.entries(en)) {
            expect(value, `en["${key}"] 不应为空字符串`).not.toBe('');
        }
    });

    it('zh 中不应有空字符串值', () => {
        for (const [key, value] of Object.entries(zh)) {
            expect(value, `zh["${key}"] 不应为空字符串`).not.toBe('');
        }
    });
});
