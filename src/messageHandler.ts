import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { outlineProvider, normalizeEol } from './utils/extensionState';
import { getThemeKind, getVSCodeThemeForShiki } from './utils/themeUtils';

/**
 * 传递给消息处理器的上下文信息。
 */
export interface MessageContext {
    document: vscode.TextDocument;
    webviewPanel: vscode.WebviewPanel;
    baseWebviewUri: string;
    isUpdateFromWebview: { value: boolean };
    lastWebviewContent: { value: string };
    lastWebviewChangeTime: { value: number };
    updateTextDocument: (text: string) => Promise<void>;
    updateWebview: () => void;
}

/**
 * 注册所有 webview → 扩展 的消息处理器。
 */
export function registerMessageHandler(ctx: MessageContext): void {
    ctx.webviewPanel.webview.onDidReceiveMessage(async (e) => {
        switch (e.type) {
            case 'webviewChanged':
                ctx.isUpdateFromWebview.value = true;
                ctx.lastWebviewContent.value = e.text;
                ctx.lastWebviewChangeTime.value = Date.now();
                await ctx.updateTextDocument(e.text);
                return;

            // webview 中按 Ctrl+S：先刷新飞行中的内容，再触发真正的保存。
            case 'requestSave':
                await ctx.updateTextDocument(ctx.lastWebviewContent.value);
                vscode.commands.executeCommand('workbench.action.files.save');
                return;

            case 'webviewAboutToSave':
                ctx.lastWebviewChangeTime.value = Date.now();
                return;

            case 'initialized':
                // 同时发送主题和初始文档内容，确保高亮器在 webview 处理第一个
                // documentChanged 之前（或同时）完成初始化，避免异步时序问题。
                getVSCodeThemeForShiki().then(shikiTheme => {
                    ctx.webviewPanel.webview.postMessage({
                        type: 'themeColorChanged',
                        themeKind: getThemeKind(),
                        shikiTheme,
                    });
                    ctx.webviewPanel.webview.postMessage({
                        type: 'documentChanged',
                        text: ctx.document.getText().replace(/(?:\r\n|\r|\n)/g, '\n'),
                    });
                    ctx.webviewPanel.webview.postMessage({
                        type: 'baseUriChanged',
                        baseUri: ctx.baseWebviewUri,
                    });
                    // 在此发送行号配置（editorProvider 中的早期调用之外），
                    // 确保 webview 消息处理器完全注册后也能正确应用该设置，
                    // 即使 VS Code 在重启时恢复已打开的编辑器。
                    const codeLineNumbers = vscode.workspace
                        .getConfiguration('imarkdown.editor')
                        .get<boolean>('codeLineNumbers', false);
                    ctx.webviewPanel.webview.postMessage({ type: 'lineNumberConfigChanged', codeLineNumbers });
                });
                return;

            case 'plainPaste':
                vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                return;

            case 'requestDocumentRefresh': {
                // webview 重新获得焦点（窗口或标签）并请求最新文件内容，
                // 以防文件被外部修改。仅在磁盘内容与最后发送内容不同时才发送。
                const diskText = normalizeEol(ctx.document.getText());
                const lastSent = normalizeEol(ctx.lastWebviewContent.value);
                if (diskText !== lastSent) {
                    ctx.webviewPanel.webview.postMessage({
                        type: 'documentChanged',
                        text: diskText,
                    });
                }
                return;
            }

            case 'requestWebviewRefresh':
                ctx.updateWebview();
                return;

            case 'requestImageInsert':
                await handleImageInsert(ctx);
                return;

            case 'openLink': {
                if (!e.href) return;
                const href: string = e.href;
                // 绝对 URL（http/https/mailto 等）直接打开；
                // 相对路径先解析为相对文档目录的绝对路径。
                let uri: vscode.Uri;
                if (/^[a-z][a-z0-9+\-.]*:/i.test(href)) {
                    uri = vscode.Uri.parse(href);
                } else {
                    const docDir = path.dirname(ctx.document.uri.fsPath);
                    const resolved = path.resolve(docDir, href);
                    uri = vscode.Uri.file(resolved);
                }
                vscode.env.openExternal(uri);
                return;
            }

            case 'pasteImage':
                if (e.dataUrl) {
                    handlePasteImage(ctx, e.dataUrl);
                }
                return;

            case 'tocChanged':
                if (e.entries && outlineProvider) {
                    outlineProvider.updateToc(ctx.document.uri, e.entries);
                }
                return;

            case 'requestPathCompletion':
                handlePathCompletion(ctx, e.prefix ?? '', e.requestId ?? '');
                return;
        }
    });
}

/**
 * 处理 webview 的路径自动补全请求。
 * webview 发送已输入的前缀文本，此处解析为相对文档目录的路径并返回匹配的文件/文件夹名称。
 */
function handlePathCompletion(ctx: MessageContext, prefix: string, requestId: string): void {
    try {
        const docDir = path.dirname(ctx.document.uri.fsPath);
        const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';

        // 将开头的 `~/` 展开为用户主目录；裸 `~` 视为 `~/`（列出主目录内容）。
        let expandedPrefix: string;
        if (prefix === '~') {
            expandedPrefix = homeDir + '/';
        } else if (prefix.startsWith('~/') || prefix.startsWith('~\\')) {
            expandedPrefix = homeDir + prefix.slice(1);
        } else {
            expandedPrefix = prefix;
        }

        // 确定要列出的目录和用于过滤的部分文件名。
        // 例如：prefix = "images/foo" → dir = "<docDir>/images", partial = "foo"
        //       prefix = "./"         → dir = "<docDir>",          partial = ""
        //       prefix = "../img"     → dir = "<docDir>/..",        partial = "img"
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
                rawDir = path.isAbsolute(dirPart)
                    ? path.normalize(dirPart)
                    : path.resolve(docDir, dirPart);
                partial = expandedPrefix.slice(lastSlash + 1).toLowerCase();
            } else {
                rawDir = docDir;
                partial = expandedPrefix.toLowerCase();
            }
        }

        if (!fs.existsSync(rawDir) || !fs.statSync(rawDir).isDirectory()) {
            ctx.webviewPanel.webview.postMessage({ type: 'pathCompletionResult', requestId, items: [] });
            return;
        }

        const entries = fs.readdirSync(rawDir, { withFileTypes: true });
        const items: Array<{ label: string; isDir: boolean }> = [];

        for (const entry of entries) {
            // 跳过隐藏文件
            if (entry.name.startsWith('.')) continue;
            if (partial && !entry.name.toLowerCase().startsWith(partial)) continue;

            const isDir = entry.isDirectory();
            // 构建补全值：保留原始前缀（未展开的）最后一个斜杠之前的部分，再加上条目名称。
            // 特殊情况：裸 `~`（无斜杠）应生成 `~/entry` 标签，
            // 使后续补全请求仍携带 `~/` 前缀并被正确展开。
            let dirPrefix: string;
            if (prefix === '~' || prefix === '~\\') {
                dirPrefix = '~/';
            } else {
                const origLastSlash = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('\\'));
                dirPrefix = origLastSlash >= 0 ? prefix.slice(0, origLastSlash + 1) : '';
            }
            const value = dirPrefix + entry.name + (isDir ? '/' : '');
            items.push({ label: value, isDir });

            if (items.length >= 20) break; // 最多返回 20 条
        }

        // 目录优先，同组内按字母排序
        items.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.label.localeCompare(b.label);
        });

        ctx.webviewPanel.webview.postMessage({ type: 'pathCompletionResult', requestId, items });
    } catch {
        ctx.webviewPanel.webview.postMessage({ type: 'pathCompletionResult', requestId, items: [] });
    }
}

/**
 * 通过文件选择对话框插入图片。
 */
async function handleImageInsert(ctx: MessageContext): Promise<void> {
    const altText = await vscode.window.showInputBox({
        prompt: '图片 Alt 文本',
        value: 'Image',
    });
    if (altText === undefined) return;

    const docDir = path.dirname(ctx.document.uri.fsPath);
    const selection = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
    });
    if (!selection || selection.length === 0) return;

    const sourcePath = selection[0].fsPath;
    let targetPath = path.join(docDir, path.basename(sourcePath));

    if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
        targetPath = getUniqueFilePath(targetPath);
        fs.copyFileSync(sourcePath, targetPath);
    }

    const relativePath = path.relative(docDir, targetPath).replace(/\\/g, '/');
    ctx.webviewPanel.webview.postMessage({
        type: 'insertImage',
        src: relativePath,
        altText: altText || 'Image',
        baseUri: ctx.baseWebviewUri,
    });
}

/**
 * 解析 saveDir 字符串中的 VS Code 变量。
 * 支持的变量：
 *   ${workspaceFolder}           - 第一个工作区文件夹根路径
 *   ${fileDirname}               - 当前文档所在目录
 *   ${fileBasename}              - 当前文档文件名（含扩展名）
 *   ${fileBasenameNoExtension}   - 当前文档文件名（不含扩展名）
 */
function resolveSaveDir(rawDir: string, document: vscode.TextDocument): string {
    const docPath = document.uri.fsPath;
    const fileDirname = path.dirname(docPath);
    const fileBasename = path.basename(docPath);
    const fileBasenameNoExtension = path.basename(docPath, path.extname(docPath));
    const workspaceFolder =
        vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ??
        fileDirname;

    return rawDir
        .replace(/\$\{workspaceFolder\}/g, workspaceFolder)
        .replace(/\$\{fileDirname\}/g, fileDirname)
        .replace(/\$\{fileBasename\}/g, fileBasename)
        .replace(/\$\{fileBasenameNoExtension\}/g, fileBasenameNoExtension);
}

/**
 * 解析当前文档的图片保存目录绝对路径。
 * 若解析后的 saveDir 为绝对路径则直接使用，否则视为相对文档目录的路径。
 */
function resolveImagesSaveDir(document: vscode.TextDocument): string {
    const rawDir = vscode.workspace.getConfiguration('imarkdown.image').get<string>('saveDir', 'images');
    const resolved = resolveSaveDir(rawDir, document);
    if (path.isAbsolute(resolved)) {
        return resolved;
    }
    return path.join(path.dirname(document.uri.fsPath), resolved);
}

/**
 * 处理剪贴板数据 URL 形式的粘贴图片。
 */
function handlePasteImage(ctx: MessageContext, dataUrl: string): void {
    const match = dataUrl.match(/^data:image\/([\w+]+);base64,(.+)$/);
    if (!match) return;

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');

    const docDir = path.dirname(ctx.document.uri.fsPath);
    const imagesDir = resolveImagesSaveDir(ctx.document);
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }

    const timestamp = Date.now();
    let targetPath = path.join(
        imagesDir, `paste-${formatTimestamp(timestamp, 'YYYYMMDDHHmmss')}.${ext}`);
    targetPath = getUniqueFilePath(targetPath);
    fs.writeFileSync(targetPath, buffer);

    const relativePath = path.relative(docDir, targetPath).replace(/\\/g, '/');
    ctx.webviewPanel.webview.postMessage({
        type: 'insertImage',
        src: relativePath,
        altText: 'Image',
        baseUri: ctx.baseWebviewUri,
    });
}

/**
 * 若文件已存在，则在扩展名前追加数字计数器以生成唯一路径。
 */
function getUniqueFilePath(filePath: string): string {
    if (!fs.existsSync(filePath)) return filePath;
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);
    let counter = 1;
    let result = filePath;
    while (fs.existsSync(result)) {
        result = path.join(dir, `${name}-${counter}${ext}`);
        counter++;
    }
    return result;
}

export function formatTimestamp(
  timestamp: number | string,
  format: string = 'YYYY-MM-DD HH:mm:ss'
): string {
  const numTs = Number(timestamp);
  if (isNaN(numTs)) {
    console.warn('无效的时间戳:', timestamp);
    return '';
  }
  let ts = numTs;
  if (ts.toString().length === 10) {
    ts *= 1000;
  }
  const date = new Date(ts);
  if (date.toString() === 'Invalid Date') {
    console.warn('时间戳转换失败:', timestamp);
    return '';
  }
  const padZero = (num: number): string => num.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = padZero(date.getMonth() + 1);
  const day = padZero(date.getDate());
  const hours = padZero(date.getHours());
  const minutes = padZero(date.getMinutes());
  const seconds = padZero(date.getSeconds());
  const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];

  return format
    .replace('YYYY', year.toString())
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds)
    .replace('WW', week);
}