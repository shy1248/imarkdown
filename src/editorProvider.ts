import * as vscode from 'vscode';
import * as path from 'path';
import { extensionState, setState, clearState } from './utils/extensionState';
import { normalizeEol, toDocumentEol } from './utils/textUtils';
import { clampMinWidth, clampPadding, getLayoutSpacing } from './utils/editorLayout';
import { getThemeKind, getVSCodeThemeForShiki } from './utils/themeUtils';
import { getHtmlForWebview } from './webviewHtml';
import { registerMessageHandler } from './messageHandler';
import { sendLanguageLabelConfig, sendLineNumberConfig } from './utils/editorConfigMessages';

export class IMarkdownEditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            IMarkdownEditorProvider.viewType,
            new IMarkdownEditorProvider(context),
            { webviewOptions: { retainContextWhenHidden: true } },
        );
    }

    static readonly viewType = 'imarkdown.markdownEditor';

    constructor(private readonly context: vscode.ExtensionContext) { }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        const documentFolderUri = vscode.Uri.file(path.dirname(document.uri.fsPath));
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri, documentFolderUri],
        };
        const baseFolderUri = vscode.Uri.file(path.dirname(document.uri.fsPath) + path.sep);
        const baseWebviewUri = webviewPanel.webview.asWebviewUri(baseFolderUri).toString();
        webviewPanel.webview.html = getHtmlForWebview(webviewPanel.webview, this.context.extensionUri, baseWebviewUri);

        const isUpdateFromWebview = { value: false };
        const lastWebviewContent = { value: '' };
        // 防止误触发的 onDidSave 回调：若 webviewChanged IPC 在此时间窗口内到达，
        // 说明文件内容已由我们写入，无需再次发送。
        const lastWebviewChangeTime = { value: 0 };
        const WEBVIEW_CHANGE_GUARD_MS = 500;

        // --- 订阅事件 ---

        const documentSavedSub = vscode.workspace.onDidSaveTextDocument((e) => {
            if (e.uri.toString() !== document.uri.toString()) return;
            const savedText = normalizeEol(e.getText());
            const lastSent = normalizeEol(lastWebviewContent.value);
            if (savedText === lastSent) {
                isUpdateFromWebview.value = false;
                return;
            }
            if (Date.now() - lastWebviewChangeTime.value < WEBVIEW_CHANGE_GUARD_MS) {
                isUpdateFromWebview.value = false;
                return;
            }
            if (!isUpdateFromWebview.value) {
                updateWebview();
            } else {
                isUpdateFromWebview.value = false;
            }
        });

        const configChangedSub = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('editor.fontFamily') || e.affectsConfiguration('editor.fontSize')) {
                sendFontConfig(webviewPanel);
            }
            if (e.affectsConfiguration('imarkdown.editor') || e.affectsConfiguration('editor.lineHeight')) {
                sendLayoutConfig(webviewPanel);
            }
            if (e.affectsConfiguration('imarkdown.editor.codeLineNumbers')) {
                sendLineNumberConfig(webviewPanel);
            }
            if (e.affectsConfiguration('imarkdown.editor.hideCodeLanguageLabel')) {
                sendLanguageLabelConfig(webviewPanel);
            }
            if (e.affectsConfiguration('workbench.colorTheme') || e.affectsConfiguration('workbench.colorCustomizations')) {
                sendThemeUpdate(webviewPanel);
            }
        });

        const themeChangedSub = vscode.window.onDidChangeActiveColorTheme(() => {
            sendThemeUpdate(webviewPanel);
        });

        webviewPanel.onDidDispose(() => {
            if (extensionState.activeWebviewPanel === webviewPanel) clearState();
            documentSavedSub.dispose();
            configChangedSub.dispose();
            themeChangedSub.dispose();
        });

        // --- 消息处理 ---

        registerMessageHandler({
            document,
            webviewPanel,
            baseWebviewUri,
            isUpdateFromWebview,
            lastWebviewContent,
            lastWebviewChangeTime,
            updateTextDocument: (text: string) => this.updateTextDocument(document, text, isUpdateFromWebview),
            updateWebview,
        });

        sendThemeUpdate(webviewPanel);
        handleFocusChange(webviewPanel);
        webviewPanel.onDidChangeViewState((e) => handleFocusChange(e.webviewPanel));

        // 文档内容在 webview 发送 'initialized' 后响应发送
        webviewPanel.webview.postMessage({ type: 'baseUriChanged', baseUri: baseWebviewUri });
        sendLineNumberConfig(webviewPanel);
        sendLanguageLabelConfig(webviewPanel);

        // --- 内部辅助函数 ---

        function handleFocusChange(panel: vscode.WebviewPanel) {
            if (panel.active) {
                setState(document, panel);
                panel.webview.postMessage({ type: 'requestTocRefresh' });
            } else if (panel === extensionState.activeWebviewPanel) {
                clearState();
            }
        }

        function updateWebview() {
            const normalizedText = normalizeEol(document.getText());
            if (isUpdateFromWebview.value && normalizedText === normalizeEol(lastWebviewContent.value)) {
                isUpdateFromWebview.value = false;
                return;
            }
            webviewPanel.webview.postMessage({ type: 'documentChanged', text: normalizedText });
            isUpdateFromWebview.value = false;
        }
    }

    /** 将 webview 的文本变更应用到底层文档。 */
    private updateTextDocument(document: vscode.TextDocument, text: string, isFromWebview?: { value: boolean }): Promise<void> {
        if (!document || text == null) {
            if (isFromWebview) isFromWebview.value = false;
            return Promise.resolve();
        }
        text = toDocumentEol(text, document.eol);

        const fileText = document.getText();
        if (text === fileText) {
            if (isFromWebview) isFromWebview.value = false;
            return Promise.resolve();
        }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(0), document.positionAt(fileText.length)),
            text,
        );
        return Promise.resolve(vscode.workspace.applyEdit(edit)).then(
            () => { if (isFromWebview) setTimeout(() => { isFromWebview.value = false; }, 100); },
            () => { if (isFromWebview) isFromWebview.value = false; },
        );
    }
}

// --- 共享辅助函数 ---

function sendThemeUpdate(panel: vscode.WebviewPanel) {
    getVSCodeThemeForShiki().then(shikiTheme => {
        panel.webview.postMessage({ type: 'themeColorChanged', themeKind: getThemeKind(), shikiTheme });
    });
}

function sendFontConfig(panel: vscode.WebviewPanel) {
    const cfg = vscode.workspace.getConfiguration('editor');
    const fontSize = cfg.get<number>('fontSize', 15);
    const fontFamily = (cfg.get<string>('fontFamily', '') || 'monospace').trim() || 'monospace';
    panel.webview.postMessage({ type: 'fontChanged', fontSize, fontFamily, codeBlockFontFamily: fontFamily });
}

function sendLayoutConfig(panel: vscode.WebviewPanel) {
    const cfg = vscode.workspace.getConfiguration('imarkdown.editor');
    const editorCfg = vscode.workspace.getConfiguration('editor');

    const vscodeLineHeight = editorCfg.get<number>('lineHeight', 0);
    const lineHeight = vscodeLineHeight > 0 ? vscodeLineHeight : 1.5;
    const spacing = getLayoutSpacing(cfg.get<string>('layout', 'moderate'));

    panel.webview.postMessage({
        type: 'editorLayoutChanged',
        maxWidth: '100%',
        minWidth: clampMinWidth(cfg.get<number>('minWidth')),
        lineHeight,
        padding: clampPadding(cfg.get<number>('padding')),
        inlineSpacing: spacing.inline,
        blockSpacing: spacing.block,
    });
}
