import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/** 获取当前 VS Code 颜色主题类型 */
export function getThemeKind(): 'dark' | 'light' | 'high-contrast' | 'high-contrast-light' {
    const theme = vscode.window.activeColorTheme;
    switch (theme.kind) {
        case vscode.ColorThemeKind.Light:
            return 'light';
        case vscode.ColorThemeKind.Dark:
            return 'dark';
        case vscode.ColorThemeKind.HighContrast:
            return 'high-contrast';
        case vscode.ColorThemeKind.HighContrastLight:
            return 'high-contrast-light';
        default:
            return 'dark';
    }
}

/** 获取当前 VS Code 主题的 Shiki 兼容格式，失败时返回内置备用主题 */
export async function getVSCodeThemeForShiki(): Promise<object | null> {
    try {
        const themeName = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme');
        if (!themeName) return fallbackShikiTheme(getThemeKind());
        const normalizedThemeName = themeName.toLowerCase();
        // 遍历所有扩展查找主题
        for (const ext of vscode.extensions.all) {
            const contributes = ext.packageJSON?.contributes;
            if (!contributes?.themes) continue;
            for (const theme of contributes.themes) {
                // 通过 label 或 id 匹配（大小写不敏感）
                const themeLabel = (theme.label || '').toLowerCase();
                const themeId = (theme.id || theme.label || '').toLowerCase();
                if (themeLabel === normalizedThemeName ||
                    themeId === normalizedThemeName ||
                    themeLabel.includes(normalizedThemeName) ||
                    normalizedThemeName.includes(themeLabel)) {
                    const themePath = path.join(ext.extensionPath, theme.path);
                    const themeJsonString = await loadThemeByJsonString(themePath, themeName);
                    if (themeJsonString) {
                        if (!containsTokenColors(themeJsonString)) {
                            return fallbackShikiTheme(getThemeKind());
                        }
                        return themeJsonString;
                    }
                }
            }
        }
    } catch (error) {
        console.error('[iMarkdown] 加载 VS Code Shiki 主题失败:', error);
    }
    return fallbackShikiTheme(getThemeKind());
}

/** 读取并解析主题 JSON 文件，支持通过 include 合并父主题 */
async function loadThemeByJsonString(themePath: string, themeName: string): Promise<object | null> {
    try {
        if (!fs.existsSync(themePath)) return null;
        const themeContent = fs.readFileSync(themePath, 'utf8');
        const cleanedContent = cleanThemeJson(themeContent);
        const theme = JSON.parse(cleanedContent);
        // 先合并父主题
        if (theme.include) {
            const parentPath = path.join(path.dirname(themePath), theme.include);
            const parentTheme = await loadThemeByJsonString(parentPath, themeName);
            if (parentTheme) {
                // 子主题覆盖父主题（数组合并）
                const merged = {
                    ...parentTheme, ...theme, name: themeName,
                    tokenColors: [...((parentTheme as any).tokenColors || []), ...(theme.tokenColors || [])],
                    colors: { ...((parentTheme as any).colors || {}), ...(theme.colors || {}) }
                };
                delete merged.include;
                return merged;
            }
        }
        // 确保主题有名称
        theme.name = theme.name || themeName;
        return theme;
    } catch (error) {
        console.error('[iMarkdown] 解析主题文件失败:', error);
        return null;
    }
}

/** 清理主题 JSON：去除注释和尾随逗号 */
function cleanThemeJson(raw: string): string {
    const withoutComments = stripJsonComments(raw);
    return removeTrailingCommas(withoutComments);
}

/** 去除 JSON 字符串中的单行和块注释 */
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

/** 去除 JSON 字符串中对象/数组末尾的多余逗号 */
function removeTrailingCommas(raw: string): string {
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

/** 检查主题对象中是否包含 tokenColors 或 settings 语法着色规则 */
function containsTokenColors(theme: any): boolean {
    if (!theme || typeof theme !== 'object') return false;
    if (Array.isArray(theme.settings) && theme.settings.length > 0) return true;
    if (Array.isArray(theme.tokenColors) && theme.tokenColors.length > 0) return true;
    return false;
}

/** 返回内置备用 Shiki 主题（亮色/暗色），用于无法加载用户主题时的回退 */
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