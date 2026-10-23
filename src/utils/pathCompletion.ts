/**
 * 路径自动补全的纯逻辑（不依赖 VS Code API，便于单元测试）。
 */
import * as path from 'path';

export interface CompletionQuery {
    /** 需要列出的目录绝对路径 */
    rawDir: string;
    /** 用于过滤的小写文件名前缀 */
    partial: string;
    /** 补全值中保留的原始目录前缀（未展开 `~`） */
    dirPrefix: string;
}

/** 将开头的 `~/` 展开为用户主目录；裸 `~` 视为 `~/`。 */
export function expandHomePrefix(prefix: string, homeDir: string): string {
    if (prefix === '~' || prefix === '~/' || prefix === '~\\') return homeDir + path.sep;
    if (prefix.startsWith('~/') || prefix.startsWith('~\\')) {
        return path.join(homeDir, prefix.slice(2));
    }
    return prefix;
}

/** 解析补全前缀，得到要列出的目录、过滤前缀与补全值前缀。 */
export function resolveCompletionQuery(prefix: string, docDir: string, homeDir: string): CompletionQuery {
    const expandedPrefix = expandHomePrefix(prefix, homeDir);

    let rawDir: string;
    let partial: string;
    if (expandedPrefix === '' || expandedPrefix === './' || expandedPrefix === '.') {
        rawDir = docDir;
        partial = '';
    } else {
        const lastSlash = Math.max(expandedPrefix.lastIndexOf('/'), expandedPrefix.lastIndexOf('\\'));
        if (lastSlash >= 0) {
            const dirPart = expandedPrefix.slice(0, lastSlash + 1);
            // 绝对路径（以 / 或盘符开头）不需要拼接 docDir
            rawDir = path.isAbsolute(dirPart) ? path.normalize(dirPart) : path.resolve(docDir, dirPart);
            partial = expandedPrefix.slice(lastSlash + 1).toLowerCase();
        } else {
            rawDir = docDir;
            partial = expandedPrefix.toLowerCase();
        }
    }

    // 补全值保留原始前缀（未展开 `~`）：裸 `~` 应生成 `~/entry`
    let dirPrefix: string;
    if (prefix === '~' || prefix === '~/' || prefix === '~\\') {
        dirPrefix = '~/';
    } else {
        const origLastSlash = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('\\'));
        dirPrefix = origLastSlash >= 0 ? prefix.slice(0, origLastSlash + 1) : '';
    }

    return { rawDir, partial, dirPrefix };
}

/** 构建补全项的插入值（目录追加 `/`）。 */
export function buildCompletionValue(dirPrefix: string, name: string, isDir: boolean): string {
    return dirPrefix + name + (isDir ? '/' : '');
}
