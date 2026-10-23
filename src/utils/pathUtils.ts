/**
 * 路径/URL 判断的共享纯函数（不依赖 VS Code API）。
 */

/** 是否为 Windows 盘符路径（如 `C:\docs\a.md`、`D:/x`）。 */
export function isWindowsDrivePath(value: string): boolean {
    return /^[a-z]:[\\/]/i.test(value);
}

/**
 * 是否带有 URL 协议（如 `https:`、`mailto:`、`vscode-resource:`）。
 * Windows 盘符（`C:\`）不是协议。
 */
export function hasUrlScheme(value: string): boolean {
    return /^[a-z][a-z0-9+\-.]*:/i.test(value) && !isWindowsDrivePath(value);
}
