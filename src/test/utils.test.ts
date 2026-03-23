/**
 * 扩展宿主中 normalizeEol、formatTimestamp 及其他共享工具函数的测试套件。
 *
 * 运行命令：npm test
 */
import * as assert from 'assert';

// ── normalizeEol ─────────────────────────────────────────────────────────────

// 此处重新实现纯逻辑，以便在不依赖 VS Code 的情况下进行单元测试。
function normalizeEol(text: string): string {
    return text.replace(/(?:\r\n|\r|\n)/g, '\n');
}

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
        assert.strictEqual(
            normalizeEol('a\r\nb\rc\nd'),
            'a\nb\nc\nd',
        );
    });

    it('应处理空字符串', () => {
        assert.strictEqual(normalizeEol(''), '');
    });

    it('应处理不含行尾符的字符串', () => {
        assert.strictEqual(normalizeEol('no newlines here'), 'no newlines here');
    });

    it('应处理连续换行符', () => {
        assert.strictEqual(
            normalizeEol('\r\n\r\n\r\n'),
            '\n\n\n',
        );
    });

    it('应处理字符串末尾的 CRLF', () => {
        assert.strictEqual(normalizeEol('hello\r\n'), 'hello\n');
    });
});

// ── formatTimestamp ──────────────────────────────────────────────────────────

function formatTimestamp(
    timestamp: number | string,
    format: string = 'YYYY-MM-DD HH:mm:ss',
): string {
    const date = new Date(
        typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp,
    );
    const YYYY = String(date.getFullYear());
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const DD = String(date.getDate()).padStart(2, '0');
    const HH = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const weekDay = date.getDay();
    const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
    const WW = weekNames[weekDay];
    return format
        .replace('YYYY', YYYY)
        .replace('MM', MM)
        .replace('DD', DD)
        .replace('HH', HH)
        .replace('mm', mm)
        .replace('ss', ss)
        .replace('WW', WW);
}

describe('formatTimestamp', () => {
    it('应使用默认 YYYY-MM-DD HH:mm:ss 格式', () => {
        const ts = new Date(2024, 0, 15, 10, 30, 45).getTime();
        const result = formatTimestamp(ts);
        assert.strictEqual(result, '2024-01-15 10:30:45');
    });

    it('应接受字符串类型时间戳', () => {
        const ts = new Date(2024, 0, 15, 10, 30, 45).getTime();
        const result = formatTimestamp(String(ts));
        assert.strictEqual(result, '2024-01-15 10:30:45');
    });

    it('应支持自定义格式', () => {
        const ts = new Date(2024, 0, 15, 10, 30, 45).getTime();
        const result = formatTimestamp(ts, 'YYYYMMDDHHmmss');
        assert.strictEqual(result, '20240115103045');
    });

    it('应为个位数月份和日期补零', () => {
        const ts = new Date(2024, 0, 5, 3, 2, 1).getTime();
        const result = formatTimestamp(ts);
        assert.strictEqual(result, '2024-01-05 03:02:01');
    });

    it('应包含星期名称', () => {
        // 2024-01-15 是周一
        const ts = new Date(2024, 0, 15).getTime();
        const result = formatTimestamp(ts, 'YYYY-MM-DD (周WW)');
        assert.strictEqual(result, '2024-01-15 (周一)');
    });

    it('应处理 12 月（第 12 个月）', () => {
        const ts = new Date(2024, 11, 31, 23, 59, 59).getTime();
        const result = formatTimestamp(ts);
        assert.strictEqual(result, '2024-12-31 23:59:59');
    });

    it('应处理周日（weekDay 为 0）', () => {
        // 2024-01-14 是周日
        const ts = new Date(2024, 0, 14).getTime();
        const result = formatTimestamp(ts, 'YYYY-MM-DD (周WW)');
        assert.strictEqual(result, '2024-01-14 (周日)');
    });
});
