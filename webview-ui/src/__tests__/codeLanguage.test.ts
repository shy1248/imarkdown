/**
 * codeHighlight.ts 的测试 — langRegistry 完整性校验
 */
import { describe, it, expect } from 'vitest';
import { langRegistry } from '../editor/code/codeHighlight';

describe('langRegistry', () => {
    describe('selector', () => {
        const selector = langRegistry.selector;

        it('应为非空数组', () => {
            expect(Array.isArray(selector)).toBe(true);
            expect(selector.length).toBeGreaterThan(0);
        });

        it('不应包含重复项', () => {
            const unique = new Set(selector);
            expect(unique.size).toBe(selector.length);
        });

        it('应全部为小写字符串', () => {
            for (const lang of selector) {
                expect(typeof lang).toBe('string');
                expect(lang).toBe(lang.toLowerCase());
            }
        });

        it('不应包含空字符串', () => {
            for (const lang of selector) {
                expect(lang.length).toBeGreaterThan(0);
            }
        });
    });

    describe('aliases', () => {
        const aliases = langRegistry.aliases;

        it('应包含常用语言的别名映射', () => {
            expect(aliases['js']).toBe('javascript');
            expect(aliases['ts']).toBe('typescript');
            expect(aliases['py']).toBe('python');
            expect(aliases['sh']).toBe('bash');
            expect(aliases['yml']).toBe('yaml');
        });

        it('标准 ID 应自映射（确保 resolve 始终命中）', () => {
            expect(aliases['javascript']).toBe('javascript');
            expect(aliases['typescript']).toBe('typescript');
        });
    });

    describe('resolve', () => {
        it('应将别名解析为标准 ID', () => {
            expect(langRegistry.resolve('js')).toBe('javascript');
            expect(langRegistry.resolve('ts')).toBe('typescript');
            expect(langRegistry.resolve('sh')).toBe('bash');
        });

        it('标准 ID 应原样返回', () => {
            expect(langRegistry.resolve('python')).toBe('python');
            expect(langRegistry.resolve('css')).toBe('css');
        });

        it('未知标识应原样返回', () => {
            expect(langRegistry.resolve('nonexistent')).toBe('nonexistent');
        });
    });

    describe('bundled', () => {
        const bundled = langRegistry.bundled;

        it('应为非空数组', () => {
            expect(bundled.length).toBeGreaterThan(0);
        });
    });

    it('selector 应包含 "plaintext" 作为兜底选项', () => {
        expect(langRegistry.selector).toContain('plaintext');
    });
});
