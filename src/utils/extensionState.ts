import * as vscode from 'vscode';
import { MarkdownOutlineProvider } from '../outlineProvider';

export const extensionState: {
    activeDocument: vscode.TextDocument | undefined;
    activeWebviewPanel: vscode.WebviewPanel | undefined;
} = {
    activeDocument: undefined,
    activeWebviewPanel: undefined,
};

/**
 * 所有已打开的 iMarkdown 面板注册表，以文档 URI 字符串为键。
 * 与 `activeWebviewPanel` 不同，此注册表在焦点切换时不会被清除，
 * 仅在面板被销毁时才移除条目。这样，`copyAsMarkdown` 等命令
 * （由 webview 右键菜单触发，会暂时抢占焦点并清除 `activeWebviewPanel`）
 * 仍可通过命令参数传入的文档 URI 找到正确的面板。
 */
export const panelRegistry = new Map<string, vscode.WebviewPanel>();

export let outlineProvider: MarkdownOutlineProvider;

export function initOutlineProvider(): vscode.Disposable {
    outlineProvider = new MarkdownOutlineProvider();
    return vscode.window.createTreeView('imarkdown.outline', {
        treeDataProvider: outlineProvider,
        showCollapseAll: true,
    });
}

export function setState(document: vscode.TextDocument, panel: vscode.WebviewPanel) {
    extensionState.activeDocument = document;
    extensionState.activeWebviewPanel = panel;
    vscode.commands.executeCommand('setContext', 'imarkdown.editorIsActive', true);
}

export function clearState() {
    extensionState.activeDocument = undefined;
    extensionState.activeWebviewPanel = undefined;
    outlineProvider?.clearToc();
    vscode.commands.executeCommand('setContext', 'imarkdown.editorIsActive', false);
}

/** 将所有行尾符统一替换为 LF（\n）。 */
export function normalizeEol(text: string): string {
    return text.replace(/(?:\r\n|\r|\n)/g, '\n');
}