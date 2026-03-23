import * as vscode from 'vscode';
import { i18n } from './utils/i18n';
import { extensionState, panelRegistry } from './utils/extensionState';
import { IMarkdownEditorProvider } from './editorProvider';
import { exportAsHtml } from './utils/exportUtils';

export function registerCommands(context: vscode.ExtensionContext) {
    const register = (id: string, cb: (...args: any[]) => any) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, cb));

    register('imarkdown.openWysiwygEditor', async (uri?: vscode.Uri, ...args: any[]) => {
        const documentUri = resolveDocumentUri(uri, ...args);
        if (documentUri) {
            await vscode.commands.executeCommand('vscode.openWith', documentUri, IMarkdownEditorProvider.viewType);
        } else {
            vscode.window.showWarningMessage(i18n.t('markdownFileNotActivated'));
        }
    });

    register('imarkdown.openDefaultEditor', async (uri?: vscode.Uri, ...args: any[]) => {
        const documentUri = resolveDocumentUri(uri, ...args);
        if (documentUri) {
            await vscode.commands.executeCommand('vscode.openWith', documentUri, 'default');
        } else {
            vscode.window.showWarningMessage(i18n.t('markdownFileNotActivated'));
        }
    });

    register('imarkdown.exportHTML', async () => {
        const { activeDocument, activeWebviewPanel } = extensionState;
        if (!activeDocument || !activeWebviewPanel) {
            vscode.window.showWarningMessage(i18n.t('noActiveEditor'));
            return;
        }
        try {
            await exportAsHtml(activeDocument, activeWebviewPanel);
        } catch (err: any) {
            vscode.window.showErrorMessage(i18n.t('exportWithErrorMessage', { errorMessage: err.message }));
        }
    });

    register('imarkdown.copyAsMarkdown', async (uri?: vscode.Uri, ...args: any[]) => {
        // 从命令参数（由 webview/右键菜单传入）解析文档 URI，
        // 若无则回退到当前激活文档。
        const documentUri = resolveDocumentUri(uri, ...args);

        // 优先从注册表获取面板（跨焦点切换持久化），
        // 这样即使 webview 右键菜单暂时抢占焦点并清除
        // `extensionState.activeWebviewPanel` 时，命令仍能正常工作。
        const panel = (documentUri && panelRegistry.get(documentUri.toString()))
            || extensionState.activeWebviewPanel;

        if (!panel) {
            vscode.window.showWarningMessage(i18n.t('noActiveEditor'));
            return;
        }
        const markdown = await requestMarkdownFromWebview(panel);
        if (markdown) {
            await vscode.env.clipboard.writeText(markdown);
            vscode.window.showInformationMessage(i18n.t('copiedAsMarkdown'));
        }
    });

    register('imarkdown.copyAsPlainText', async (uri?: vscode.Uri, ...args: any[]) => {
        const documentUri = resolveDocumentUri(uri, ...args);
        const panel = (documentUri && panelRegistry.get(documentUri.toString()))
            || extensionState.activeWebviewPanel;

        if (!panel) {
            vscode.window.showWarningMessage(i18n.t('noActiveEditor'));
            return;
        }
        const plainText = await requestPlainTextFromWebview(panel);
        if (plainText) {
            await vscode.env.clipboard.writeText(plainText);
            vscode.window.showInformationMessage(i18n.t('copiedAsPlainText'));
        }
    });

    register('imarkdown.scrollToHeading', (headingId: string) => {
        const { activeWebviewPanel } = extensionState;
        if (activeWebviewPanel && headingId) {
            activeWebviewPanel.webview.postMessage({ type: 'scrollToHeading', headingId });
        }
    });
}

/** 通过超时机制向 webview 请求 Markdown 内容。 */
function requestMarkdownFromWebview(panel: vscode.WebviewPanel): Promise<string> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => { disposable.dispose(); resolve(''); }, 5000);
        const disposable = panel.webview.onDidReceiveMessage((msg) => {
            if (msg.type === 'copyMarkdownResponse') {
                clearTimeout(timeout);
                disposable.dispose();
                resolve(msg.markdown as string || '');
            }
        });
        panel.webview.postMessage({ type: 'requestCopyMarkdown' });
    });
}

/** 通过超时机制向 webview 请求选区纯文本。 */
function requestPlainTextFromWebview(panel: vscode.WebviewPanel): Promise<string> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => { disposable.dispose(); resolve(''); }, 5000);
        const disposable = panel.webview.onDidReceiveMessage((msg) => {
            if (msg.type === 'copyPlainTextResponse') {
                clearTimeout(timeout);
                disposable.dispose();
                resolve(msg.text as string || '');
            }
        });
        panel.webview.postMessage({ type: 'requestCopyPlainText' });
    });
}

/**
 * 从命令参数中解析文档 URI。
 * 支持来自资源管理器右键菜单、编辑器右键菜单、webview 右键菜单及命令面板的调用。
 */
function resolveDocumentUri(uri?: vscode.Uri, ...args: any[]): vscode.Uri | undefined {
    if (uri instanceof vscode.Uri) return uri;
    for (const arg of args) {
        if (arg instanceof vscode.Uri) return arg;
        if (typeof arg === 'object' && arg?.resourceUri instanceof vscode.Uri) return arg.resourceUri;
    }
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const { languageId, fileName } = activeEditor.document;
        if (languageId === 'markdown' || fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
            return activeEditor.document.uri;
        }
    }
    return extensionState.activeDocument?.uri;
}
