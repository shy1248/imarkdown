/**
 * VS Code 主题 JSON 的纯解析工具（不依赖 VS Code API，便于单元测试）。
 */

/** 清理主题 JSON：去除 BOM、注释和尾随逗号。 */
export function cleanThemeJson(raw: string): string {
    const withoutBom = raw.replace(/^\uFEFF/, '');
    const withoutComments = stripJsonComments(withoutBom);
    return removeTrailingCommas(withoutComments);
}

/** 去除 JSON 字符串中的单行和块注释。 */
export function stripJsonComments(raw: string): string {
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
            if (char === '\n') {
                inLineComment = false;
                output += char;
            }
            continue;
        }
        if (inBlockComment) {
            if (char === '*' && nextChar === '/') {
                inBlockComment = false;
                i += 1;
            }
            continue;
        }
        if (inString) {
            output += char;
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === stringChar) {
                inString = false;
                stringChar = '';
            }
            continue;
        }
        if (char === '/' && nextChar === '/') {
            inLineComment = true;
            i += 1;
            continue;
        }
        if (char === '/' && nextChar === '*') {
            inBlockComment = true;
            i += 1;
            continue;
        }
        if (char === '"' || char === '\'') {
            inString = true;
            stringChar = char;
            output += char;
            continue;
        }
        output += char;
    }
    return output;
}

/** 去除 JSON 字符串中对象/数组末尾的多余逗号。 */
export function removeTrailingCommas(raw: string): string {
    let output = '';
    let inString = false;
    let stringChar = '';
    let escaped = false;

    for (let i = 0; i < raw.length; i += 1) {
        const char = raw[i];

        if (inString) {
            output += char;
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === stringChar) {
                inString = false;
                stringChar = '';
            }
            continue;
        }
        if (char === '"' || char === '\'') {
            inString = true;
            stringChar = char;
            output += char;
            continue;
        }
        if (char === ',') {
            let j = i + 1;
            while (j < raw.length && /\s/.test(raw[j])) {
                j += 1;
            }
            const nextNonWhitespace = j < raw.length ? raw[j] : '';
            if (nextNonWhitespace === '}' || nextNonWhitespace === ']') {
                continue;
            }
        }
        output += char;
    }
    return output;
}

/** 主题对象中是否包含 tokenColors 或 settings 语法着色规则。 */
export function containsTokenColors(theme: any): boolean {
    if (!theme || typeof theme !== 'object') return false;
    if (Array.isArray(theme.settings) && theme.settings.length > 0) return true;
    if (Array.isArray(theme.tokenColors) && theme.tokenColors.length > 0) return true;
    return false;
}

/** 内置备用 Shiki 主题（亮色/暗色），用于无法加载用户主题时的回退。 */
export function fallbackShikiTheme(themeKind: string): object {
    const isLight = themeKind === 'light' || themeKind === 'high-contrast-light';
    const baseForeground = isLight ? '#333333' : '#d4d4d4';
    const defaultColors = {
        comment: '#6a9955',
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
