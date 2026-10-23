/**
 * 编辑器配置变更消息的推送辅助函数。
 * editorProvider 与 messageHandler 共用，避免同一份读取逻辑重复实现。
 */
import * as vscode from 'vscode';

/** 推送"代码块行号"配置。 */
export function sendLineNumberConfig(panel: vscode.WebviewPanel): void {
    const codeLineNumbers = vscode.workspace
        .getConfiguration('imarkdown.editor')
        .get<boolean>('codeLineNumbers', false);
    panel.webview.postMessage({ type: 'lineNumberConfigChanged', codeLineNumbers });
}

/** 推送"隐藏代码块语言标签"配置。 */
export function sendLanguageLabelConfig(panel: vscode.WebviewPanel): void {
    const hideCodeLanguageLabel = vscode.workspace
        .getConfiguration('imarkdown.editor')
        .get<boolean>('hideCodeLanguageLabel', false);
    panel.webview.postMessage({ type: 'languageLabelConfigChanged', hideCodeLanguageLabel });
}
