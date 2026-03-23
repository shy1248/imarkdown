import * as vscode from 'vscode';
import { i18n } from './utils/i18n';
import { IMarkdownEditorProvider } from './editorProvider';
import { initOutlineProvider } from './utils/extensionState';
import { registerCommands } from './commands';

export { extensionState, outlineProvider } from './utils/extensionState';

export function activate(context: vscode.ExtensionContext) {
    i18n.changeLanguage(vscode.env.language);
    vscode.commands.executeCommand('setContext', 'imarkdown.editorIsActive', false);
    context.subscriptions.push(IMarkdownEditorProvider.register(context));
    context.subscriptions.push(initOutlineProvider());
    registerCommands(context);
}

export function deactivate() { }
