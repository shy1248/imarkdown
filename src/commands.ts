import * as vscode from 'vscode';
import { i18n } from './utils/i18n';
import { extensionState } from './utils/extensionState';
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

    register('imarkdown.scrollToHeading', (headingId: string) => {
        const { activeWebviewPanel } = extensionState;
        if (activeWebviewPanel && headingId) {
            activeWebviewPanel.webview.postMessage({ type: 'scrollToHeading', headingId });
        }
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
