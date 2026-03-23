/**
 * 主题工具函数的测试套件（纯逻辑，不依赖 VS Code API）。
 *
 * 由于原始函数位于 themeUtils.ts（导入了 `vscode`），
 * 此处重新实现纯函数（stripJsonComments、removeTrailingCommas、
 * cleanThemeJson、containsTokenColors、fallbackShikiTheme）进行单元测试。
 */
import * as assert from 'assert';

// ── 来自 themeUtils.ts 的纯函数重新实现 ─────────────────────────────────────

function stripJsonComments(raw: string): string {
    let output = '';
    let inString = false;
    let stringChar = '';
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < raw.length; i += 1) {
        const char = raw[i];
        const nextChar = i + 1 < raw.length ? raw[i + 1] : '';
        if (inLineComment) {
            if (char === '\n') { inLineComment = false; output += char; }
            continue;
        }
        if (inBlockComment) {
            if (char === '*' && nextChar === '/') { inBlockComment = false; i += 1; }
            continue;
        }
        if (inString) {
            output += char;
            if (escaped) { escaped = false; }
            else if (char === '\\') { escaped = true; }
            else if (char === stringChar) { inString = false; stringChar = ''; }
            continue;
        }
        if (char === '/' && nextChar === '/') { inLineComment = true; i += 1; continue; }
        if (char === '/' && nextChar === '*') { inBlockComment = true; i += 1; continue; }
        if (char === '"' || char === '\'') { inString = true; stringChar = char; output += char; continue; }
        output += char;
    }
    return output;
}

function removeTrailingCommas(raw: string): string {
    let output = '';
    let inString = false;
    let stringChar = '';
    let escaped = false;

    for (let i = 0; i < raw.length; i += 1) {
        const char = raw[i];
        if (inString) {
            output += char;
            if (escaped) { escaped = false; }
            else if (char === '\\') { escaped = true; }
            else if (char === stringChar) { inString = false; stringChar = ''; }
            continue;
        }
        if (char === '"' || char === '\'') { inString = true; stringChar = char; output += char; continue; }
        if (char === ',') {
            let j = i + 1;
            while (j < raw.length && /\s/.test(raw[j])) { j += 1; }
            const nextNonWhitespace = j < raw.length ? raw[j] : '';
            if (nextNonWhitespace === '}' || nextNonWhitespace === ']') continue;
        }
        output += char;
    }
    return output;
}

function cleanThemeJson(raw: string): string {
    return removeTrailingCommas(stripJsonComments(raw));
}

function containsTokenColors(theme: any): boolean {
    if (!theme || typeof theme !== 'object') return false;
    if (Array.isArray(theme.settings) && theme.settings.length > 0) return true;
    if (Array.isArray(theme.tokenColors) && theme.tokenColors.length > 0) return true;
    return false;
}

function fallbackShikiTheme(themeKind: string): object {
    const isLight = themeKind === 'light' || themeKind === 'high-contrast-light';
    const baseForeground = isLight ? '#333333' : '#d4d4d4';
    const defaultColors = {
        comment: isLight ? '#6a9955' : '#6a9955',
        string: isLight ? '#a31515' : '#ce9178',
        keyword: isLight ? '#0000ff' : '#c586c0',
        number: isLight ? '#098658' : '#b5cea8',
        function: isLight ? '#795e26' : '#dcdcaa',
        type: isLight ? '#267f99' : '#4ec9b0',
        variable: isLight ? '#001080' : '#9cdcfe',
        punctuation: baseForeground,
    };
    return {
        name: isLight ? 'imarkdown-fallback-light' : 'imarkdown-fallback-dark',
        type: isLight ? 'light' : 'dark',
        colors: {},
        tokenColors: [
            { scope: ['comment'], settings: { foreground: defaultColors.comment } },
            { scope: ['string'], settings: { foreground: defaultColors.string } },
            { scope: ['keyword', 'storage', 'modifier'], settings: { foreground: defaultColors.keyword } },
            { scope: ['constant.numeric'], settings: { foreground: defaultColors.number } },
            { scope: ['entity.name.function'], settings: { foreground: defaultColors.function } },
            { scope: ['entity.name.type', 'support.type'], settings: { foreground: defaultColors.type } },
            { scope: ['variable', 'identifier'], settings: { foreground: defaultColors.variable } },
            { scope: ['punctuation', 'meta.brace'], settings: { foreground: defaultColors.punctuation } },
        ],
    };
}

// ── 测试 ────────────────────────────────────────────────────────────────────

describe('stripJsonComments', () => {
    it('应去除单行注释', () => {
        const input = '{\n  "key": "value" // comment\n}';
        const result = stripJsonComments(input);
        assert.ok(!result.includes('// comment'));
        assert.ok(result.includes('"key": "value"'));
    });

    it('应去除块注释', () => {
        const input = '{\n  /* block\n  comment */\n  "key": "value"\n}';
        const result = stripJsonComments(input);
        assert.ok(!result.includes('block'));
        assert.ok(!result.includes('comment'));
        assert.ok(result.includes('"key": "value"'));
    });

    it('不应去除字符串内的 //', () => {
        const input = '{ "url": "http://example.com" }';
        const result = stripJsonComments(input);
        assert.ok(result.includes('http://example.com'));
    });

    it('不应去除字符串内的 /*', () => {
        const input = '{ "value": "a /* b */ c" }';
        const result = stripJsonComments(input);
        assert.ok(result.includes('a /* b */ c'));
    });

    it('应正确处理字符串内的转义引号', () => {
        const input = '{ "key": "val\\"ue // not a comment" }';
        const result = stripJsonComments(input);
        assert.ok(result.includes('// not a comment'));
    });

    it('应处理连续行注释', () => {
        const input = '// line1\n// line2\n{"a":1}';
        const result = stripJsonComments(input);
        assert.ok(!result.includes('line1'));
        assert.ok(!result.includes('line2'));
        const parsed = JSON.parse(result.trim());
        assert.strictEqual(parsed.a, 1);
    });

    it('应处理空输入', () => {
        assert.strictEqual(stripJsonComments(''), '');
    });
});

describe('removeTrailingCommas', () => {
    it('应去除 } 之前的尾随逗号', () => {
        const input = '{"a": 1, "b": 2, }';
        const result = removeTrailingCommas(input);
        const parsed = JSON.parse(result);
        assert.deepStrictEqual(parsed, { a: 1, b: 2 });
    });

    it('应去除 ] 之前的尾随逗号', () => {
        const input = '[1, 2, 3, ]';
        const result = removeTrailingCommas(input);
        const parsed = JSON.parse(result);
        assert.deepStrictEqual(parsed, [1, 2, 3]);
    });

    it('应去除含空白/换行的尾随逗号', () => {
        const input = '{\n  "a": 1,\n  "b": 2,\n}';
        const result = removeTrailingCommas(input);
        const parsed = JSON.parse(result);
        assert.deepStrictEqual(parsed, { a: 1, b: 2 });
    });

    it('不应去除字符串内的逗号', () => {
        const input = '{"a": "hello,"}';
        const result = removeTrailingCommas(input);
        const parsed = JSON.parse(result);
        assert.strictEqual(parsed.a, 'hello,');
    });

    it('应处理嵌套尾随逗号', () => {
        const input = '{"a": [1, 2,], "b": {"c": 3,},}';
        const result = removeTrailingCommas(input);
        const parsed = JSON.parse(result);
        assert.deepStrictEqual(parsed, { a: [1, 2], b: { c: 3 } });
    });

    it('不应破坏无尾随逗号的合法 JSON', () => {
        const input = '{"a": [1, 2], "b": {"c": 3}}';
        const result = removeTrailingCommas(input);
        const parsed = JSON.parse(result);
        assert.deepStrictEqual(parsed, { a: [1, 2], b: { c: 3 } });
    });
});

describe('cleanThemeJson', () => {
    it('应处理含注释和尾随逗号的 JSONC', () => {
        const input = `{
  // Theme name
  "name": "My Theme",
  /* Colors */
  "tokenColors": [
    { "scope": "comment", "settings": { "foreground": "#666" } },
  ],
}`;
        const result = cleanThemeJson(input);
        const parsed = JSON.parse(result);
        assert.strictEqual(parsed.name, 'My Theme');
        assert.strictEqual(parsed.tokenColors.length, 1);
        assert.strictEqual(parsed.tokenColors[0].scope, 'comment');
    });

    it('应保持合法 JSON 不变', () => {
        const input = '{"name": "test"}';
        const result = cleanThemeJson(input);
        assert.strictEqual(JSON.parse(result).name, 'test');
    });
});

describe('containsTokenColors', () => {
    it('含 tokenColors 的主题应返回 true', () => {
        assert.strictEqual(containsTokenColors({ tokenColors: [{ scope: 'comment' }] }), true);
    });

    it('含 settings 的主题（TextMate 风格）应返回 true', () => {
        assert.strictEqual(containsTokenColors({ settings: [{ scope: 'comment' }] }), true);
    });

    it('空 tokenColors 应返回 false', () => {
        assert.strictEqual(containsTokenColors({ tokenColors: [] }), false);
    });

    it('null 应返回 false', () => {
        assert.strictEqual(containsTokenColors(null), false);
    });

    it('undefined 应返回 false', () => {
        assert.strictEqual(containsTokenColors(undefined), false);
    });

    it('非对象应返回 false', () => {
        assert.strictEqual(containsTokenColors('hello'), false);
    });

    it('不含 tokenColors 或 settings 的对象应返回 false', () => {
        assert.strictEqual(containsTokenColors({ colors: {} }), false);
    });
});

describe('fallbackShikiTheme', () => {
    it('"light" 应返回浅色主题', () => {
        const theme = fallbackShikiTheme('light') as any;
        assert.strictEqual(theme.type, 'light');
        assert.strictEqual(theme.name, 'imarkdown-fallback-light');
        assert.ok(Array.isArray(theme.tokenColors));
        assert.ok(theme.tokenColors.length > 0);
    });

    it('"high-contrast-light" 应返回浅色主题', () => {
        const theme = fallbackShikiTheme('high-contrast-light') as any;
        assert.strictEqual(theme.type, 'light');
    });

    it('"dark" 应返回深色主题', () => {
        const theme = fallbackShikiTheme('dark') as any;
        assert.strictEqual(theme.type, 'dark');
        assert.strictEqual(theme.name, 'imarkdown-fallback-dark');
    });

    it('"high-contrast" 应返回深色主题', () => {
        const theme = fallbackShikiTheme('high-contrast') as any;
        assert.strictEqual(theme.type, 'dark');
    });

    it('未知类型应返回深色主题', () => {
        const theme = fallbackShikiTheme('unknown') as any;
        assert.strictEqual(theme.type, 'dark');
    });

    it('浅色与深色主题的字符串颜色应不同', () => {
        const light = fallbackShikiTheme('light') as any;
        const dark = fallbackShikiTheme('dark') as any;
        const lightString = light.tokenColors.find((t: any) => t.scope.includes('string'));
        const darkString = dark.tokenColors.find((t: any) => t.scope.includes('string'));
        assert.notStrictEqual(lightString.settings.foreground, darkString.settings.foreground);
    });

    it('应有 8 条 token 颜色规则', () => {
        const theme = fallbackShikiTheme('dark') as any;
        assert.strictEqual(theme.tokenColors.length, 8);
    });
});
