import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { cleanThemeJson, containsTokenColors, fallbackShikiTheme } from './themeJson';

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

