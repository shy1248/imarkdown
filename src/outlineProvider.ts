import * as vscode from 'vscode';

export interface TocEntry {
    text: string;
    level: number;
    line: number;
    id: string;
}

/**
 * 资源管理器大纲树中显示的单个标题节点。
 */
export class HeadingItem extends vscode.TreeItem {
    readonly children: HeadingItem[] = [];

    constructor(
        public readonly entry: TocEntry,
    ) {
        super(entry.text || '(empty)', vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = entry.text;
        this.description = `H${entry.level}`;
        this.iconPath = new vscode.ThemeIcon('symbol-class');
        this.command = {
            command: 'imarkdown.scrollToHeading',
            title: 'Go to Heading',
            arguments: [entry.id],
        };
    }
}

/**
 * 驱动资源管理器中"iMarkdown 大纲"视图的 TreeDataProvider。
 *
 * webview 通过 `tocChanged` 消息发送目录条目；`updateToc()` 存储后
 * 触发 `onDidChangeTreeData`，VS Code 随即立即刷新树视图。
 */
export class MarkdownOutlineProvider implements vscode.TreeDataProvider<HeadingItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<HeadingItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private roots: HeadingItem[] = [];

    /**
     * 当 webview 发送 `tocChanged` 消息时由消息处理器调用。
     * `uri` 参数仅为 API 兼容性保留，此处未使用。
     */
    updateToc(_uri: vscode.Uri, entries: TocEntry[]): void {
        this.roots = this.buildTree(entries);
        this._onDidChangeTreeData.fire();
    }

    /**
     * 清空大纲（例如编辑器关闭时）。
     */
    clearToc(): void {
        this.roots = [];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: HeadingItem): vscode.TreeItem {
        // 叶节点（无子节点）不应可折叠
        element.collapsibleState = element.children.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;
        return element;
    }

    getChildren(element?: HeadingItem): HeadingItem[] {
        return element ? element.children : this.roots;
    }

    /**
     * 将扁平标题列表构建为嵌套的 HeadingItem 树。
     */
    private buildTree(entries: TocEntry[]): HeadingItem[] {
        const roots: HeadingItem[] = [];
        const stack: HeadingItem[] = [];

        for (const entry of entries) {
            const item = new HeadingItem(entry);

            // 弹出同级或更深层级的栈条目
            while (stack.length > 0 && stack[stack.length - 1].entry.level >= entry.level) {
                stack.pop();
            }

            if (stack.length > 0) {
                stack[stack.length - 1].children.push(item);
            } else {
                roots.push(item);
            }

            stack.push(item);
        }

        return roots;
    }
}
