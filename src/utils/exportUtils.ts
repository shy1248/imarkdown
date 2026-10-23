import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { i18n } from './i18n';
import { buildFullHtml, getHtmlExportTitle } from './htmlExport';

/**
 * 向 webview 编辑器请求 HTML 内容。
 * 通过 requestId 匹配响应，避免并发导出时错拿其他请求的结果。
 */
export function requestHtmlFromWebview(
    webviewPanel: vscode.WebviewPanel
): Promise<string> {
    const requestId = `export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout>;

        const disposable = webviewPanel.webview.onDidReceiveMessage((msg) => {
            if (msg?.type !== 'exportHtmlResponse') return;
            // 兼容未回传 requestId 的旧版 webview
            if (msg.requestId != null && msg.requestId !== requestId) return;
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            disposable.dispose();
            resolve(msg.html as string);
        });

        timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            disposable.dispose();
            reject(new Error('Timeout waiting for HTML content from webview'));
        }, 10000);

        webviewPanel.webview.postMessage({ type: 'requestExportHtml', requestId });
    });
}

/**
 * 将当前文档导出为 HTML。
 * 保存后提示用户在浏览器中打开（用于 PDF 导出或复制到 Word）。
 */
export async function exportAsHtml(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
): Promise<void> {
    const bodyHtml = await requestHtmlFromWebview(webviewPanel);
    const title = getHtmlExportTitle(document.uri.fsPath);
    const fullHtml = buildFullHtml(bodyHtml, title);

    const defaultUri = vscode.Uri.file(
        path.join(path.dirname(document.uri.fsPath), `${title}.html`)
    );
    const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'HTML Files': ['html'] },
    });
    if (!saveUri) return;

    fs.writeFileSync(saveUri.fsPath, fullHtml, 'utf8');

    const openInBrowser = i18n.t('openInBrowser');
    const action = await vscode.window.showInformationMessage(
        i18n.t('exportHtmlSuccess', { path: saveUri.fsPath }),
        openInBrowser
    );
    if (action === openInBrowser) {
        openInExternalBrowser(saveUri.fsPath);
    }
}

/** 用系统默认浏览器打开本地文件（vscode.env.openExternal 对 file: 行为不一致）。 */
function openInExternalBrowser(filePath: string): void {
    const quote = (p: string) => p.replace(/"/g, process.platform === 'win32' ? '""' : '\\"');
    const cmd = process.platform === 'win32'
        ? `start "" "${quote(filePath)}"`
        : process.platform === 'darwin'
            ? `open "${quote(filePath)}"`
            : `xdg-open "${quote(filePath)}"`;
    exec(cmd, (err) => {
        if (err) {
            vscode.window.showErrorMessage(i18n.t('openBrowserError', { error: err.message }));
        }
    });
}