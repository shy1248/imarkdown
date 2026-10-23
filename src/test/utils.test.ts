/**
 * 扩展宿主纯工具函数的测试套件。
 * 直接导入 src/utils/textUtils.ts 与 src/utils/timestampUtils.ts 的真实实现，
 * 避免测试中重复实现导致与源码漂移。
 */
import * as assert from 'assert';
import { escapeHtml, normalizeEol, toDocumentEol } from '../utils/textUtils';
import { formatTimestamp } from '../utils/timestampUtils';

describe('normalizeEol', () => {
    it('应将 CRLF 转换为 LF', () => {
        assert.strictEqual(normalizeEol('hello\r\nworld'), 'hello\nworld');
    });

    it('应将 CR 转换为 LF', () => {
        assert.strictEqual(normalizeEol('hello\rworld'), 'hello\nworld');
    });

    it('应保持 LF 不变', () => {
        assert.strictEqual(normalizeEol('hello\nworld'), 'hello\nworld');
    });

    it('应处理混合行尾符', () => {
        assert.strictEqual(normalizeEol('a\r\nb\rc\nd'), 'a\nb\nc\nd');
    });

    it('应处理空字符串', () => {
        assert.strictEqual(normalizeEol(''), '');
    });

    it('应处理不含行尾符的字符串', () => {
        assert.strictEqual(normalizeEol('no newlines here'), 'no newlines here');
    });

    it('应处理连续换行符', () => {
        assert.strictEqual(normalizeEol('\r\n\r\n\r\n'), '\n\n\n');
    });

    it('应处理字符串末尾的 CRLF', () => {
        assert.strictEqual(normalizeEol('hello\r\n'), 'hello\n');
    });
});

describe('toDocumentEol', () => {
    it('CRLF 文档应将所有行尾符转换为 CRLF', () => {
        assert.strictEqual(toDocumentEol('a\nb\rc\r\nd', 2), 'a\r\nb\r\nc\r\nd');
    });

    it('LF 文档应保持 LF', () => {
        assert.strictEqual(toDocumentEol('a\r\nb\rc\nd', 1), 'a\nb\nc\nd');
    });

    it('应处理空字符串', () => {
        assert.strictEqual(toDocumentEol('', 2), '');
        assert.strictEqual(toDocumentEol('', 1), '');
    });

    it('应避免重复转换（CRLF → CRLF 保持稳定）', () => {
        const once = toDocumentEol('a\r\nb', 2);
        assert.strictEqual(toDocumentEol(once, 2), once);
    });
});

describe('escapeHtml', () => {
    it('应转义全部特殊字符', () => {
        assert.strictEqual(
            escapeHtml('<a href="url">text & more</a>'),
            '&lt;a href=&quot;url&quot;&gt;text &amp; more&lt;/a&gt;',
        );
    });

    it('应处理空字符串与普通文本', () => {
        assert.strictEqual(escapeHtml(''), '');
        assert.strictEqual(escapeHtml('hello world'), 'hello world');
    });
});

describe('formatTimestamp', () => {
    it('应使用默认 YYYY-MM-DD HH:mm:ss 格式', () => {
        const ts = new Date(2024, 0, 15, 10, 30, 45).getTime();
        assert.strictEqual(formatTimestamp(ts), '2024-01-15 10:30:45');
    });

    it('应接受字符串类型时间戳', () => {
        const ts = new Date(2024, 0, 15, 10, 30, 45).getTime();
        assert.strictEqual(formatTimestamp(String(ts)), '2024-01-15 10:30:45');
    });

    it('10 位秒级时间戳应被识别', () => {
        const seconds = Math.floor(new Date(2024, 0, 15, 10, 30, 45).getTime() / 1000);
        assert.strictEqual(formatTimestamp(seconds), '2024-01-15 10:30:45');
    });

    it('应支持自定义格式', () => {
        const ts = new Date(2024, 0, 15, 10, 30, 45).getTime();
        assert.strictEqual(formatTimestamp(ts, 'YYYYMMDDHHmmss'), '20240115103045');
    });

    it('应为个位数月份和日期补零', () => {
        const ts = new Date(2024, 0, 5, 3, 2, 1).getTime();
        assert.strictEqual(formatTimestamp(ts), '2024-01-05 03:02:01');
    });

    it('应包含星期名称', () => {
        // 2024-01-15 是周一
        const ts = new Date(2024, 0, 15).getTime();
        assert.strictEqual(formatTimestamp(ts, 'YYYY-MM-DD (周WW)'), '2024-01-15 (周一)');
    });

    it('应处理 12 月（第 12 个月）', () => {
        const ts = new Date(2024, 11, 31, 23, 59, 59).getTime();
        assert.strictEqual(formatTimestamp(ts), '2024-12-31 23:59:59');
    });

    it('应处理周日（weekDay 为 0）', () => {
        // 2024-01-14 是周日
        const ts = new Date(2024, 0, 14).getTime();
        assert.strictEqual(formatTimestamp(ts, 'YYYY-MM-DD (周WW)'), '2024-01-14 (周日)');
    });

    it('无效输入应返回空字符串', () => {
        assert.strictEqual(formatTimestamp('not-a-number'), '');
        assert.strictEqual(formatTimestamp(NaN), '');
    });
});