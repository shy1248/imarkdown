/**
 * codeBlockLanguage.ts 的测试 — SUPPORTED_LANGUAGES 数组完整性校验
 */
import { describe, it, expect } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../editor/code/codeLlanguage';

describe('SUPPORTED_LANGUAGES', () => {
    it('应为非空数组', () => {
        expect(Array.isArray(SUPPORTED_LANGUAGES)).toBe(true);
        expect(SUPPORTED_LANGUAGES.length).toBeGreaterThan(0);
    });

    it('不应包含重复项', () => {
        const unique = new Set(SUPPORTED_LANGUAGES);
        expect(unique.size).toBe(SUPPORTED_LANGUAGES.length);
    });

    it('应包含常用语言', () => {
        const common = ['javascript', 'typescript', 'python', 'html', 'css', 'json', 'shell'];
        for (const lang of common) {
            expect(SUPPORTED_LANGUAGES).toContain(lang);
        }
    });

    it('应包含 "plaintext" 作为兜底选项', () => {
        expect(SUPPORTED_LANGUAGES).toContain('plaintext');
    });

    it('应全部为小写字符串', () => {
        for (const lang of SUPPORTED_LANGUAGES) {
            expect(typeof lang).toBe('string');
            expect(lang).toBe(lang.toLowerCase());
        }
    });

    it('不应包含空字符串', () => {
        for (const lang of SUPPORTED_LANGUAGES) {
            expect(lang.length).toBeGreaterThan(0);
        }
    });
});
