import * as vscode from 'vscode';
import { MarkdownOutlineProvider } from '../outlineProvider';

export const extensionState: {
    activeDocument: vscode.TextDocument | undefined;
    activeWebviewPanel: vscode.WebviewPanel | undefined;
} = {
    activeDocument: undefined,
    activeWebviewPanel: undefined,
};

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