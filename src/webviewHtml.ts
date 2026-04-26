import * as vscode from 'vscode';

/**
 * 构建编辑器 webview 的静态 HTML。
 */
export function getHtmlForWebview(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    baseWebviewUri: string = '',
): string {
    const webviewJsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js')
    );
    const webviewCssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css')
    );

    const imarkdownConfig = vscode.workspace.getConfiguration('imarkdown.editor');
    const editorConfig = vscode.workspace.getConfiguration('editor');

    const fontSize = editorConfig.get<number>('fontSize', 15);
    let fontFamily = (editorConfig.get<string>('fontFamily', '') || 'monospace').trim() || 'monospace';
    const codeBlockFontFamily = fontFamily;

    // 使用 VS Code 内置行高设置（0 表示使用默认值约 1.5）
    const vscodeLineHeight = editorConfig.get<number>('lineHeight', 0);
    const lineHeight = vscodeLineHeight > 0 ? vscodeLineHeight : 1.5;

    const layoutMap: Record<string, { inline: string; block: string }> = {
        // inline = 段落/列表项间距（正文节奏）
        // block  = 块级元素间距（pre、blockquote、figure、math、hr、table、h3）
        compact:  { inline: '0.3em', block: '0.5em'  },
        moderate: { inline: '0.5em', block: '0.85em' },
        loose:    { inline: '0.8em', block: '1.3em'  },
    };
    const layout = imarkdownConfig.get<string>('layout', 'moderate');
    const spacing = layoutMap[layout] ?? layoutMap['moderate'];
    const blockS  = spacing.block;    // blockquote、pre、figure、math、hr、table、h3
    let minWidth = imarkdownConfig.get<number>('minWidth', 600);
    let padding = imarkdownConfig.get<number>('padding', 50);
    minWidth = minWidth < 800 ? 800 : minWidth > 1200 ? 1200 : minWidth;
    padding = padding < 50 ? 50 : padding > 100 ? 100 : padding;

    const nonce = getNonce();
    const cspSource = webview.cspSource;
    const html = String.raw;

    return html/* html */`<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
    <meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonce}' ${cspSource}; style-src 'unsafe-inline' ${cspSource}; font-src ${cspSource}; img-src ${cspSource} data: file: vscode-file: vscode-resource: https: vscode-webview:;" />
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>iMarkdown - Markdown WYSIWYG Editor</title>
    <link rel="stylesheet" href="${webviewCssUri}" />
    <style id="font-size-style">
        .ProseMirror { font-family: ${fontFamily} !important; font-size: ${fontSize}px !important; padding: 0 0 20px; }
        .ProseMirror code { font-family: ${codeBlockFontFamily} !important; }
        .ProseMirror :not(pre) > code { font-size: ${fontSize}px !important; }
        .ProseMirror pre, .ProseMirror pre code { font-family: ${codeBlockFontFamily} !important; font-size: ${fontSize}px !important; line-height: ${Math.ceil(fontSize * lineHeight)}px !important; }
        .ProseMirror table th { font-size: ${fontSize}px !important; }
    </style>
    <style id="line-height-style">
        :root { --pm-line-height: ${lineHeight}; }
        .ProseMirror { line-height: ${lineHeight} !important; }
    </style>
    <style id="editor-layout-style">
        #editor { max-width: 100%; min-width: ${minWidth}px; margin: 0 auto; padding: 0 ${padding}px; box-sizing: border-box; }
    </style>
    <style id="node-spacing-style">
        .ProseMirror p { margin: ${blockS} 0; }
        .ProseMirror ul, .ProseMirror ol { margin: 0; }
        .ProseMirror li { margin: 0; }
        .ProseMirror li > p { margin: 0; }
        .ProseMirror h1 { margin-top: calc(${blockS} * 1.4); margin-bottom: calc(${blockS} * 0.4); }
        .ProseMirror h2 { margin-top: calc(${blockS} * 1.2); margin-bottom: calc(${blockS} * 0.3); }
        .ProseMirror h3 { margin-top: ${blockS}; margin-bottom: calc(${blockS} * 0.2); }
        .ProseMirror blockquote { margin: ${blockS} 0; }
        .ProseMirror pre { margin: ${blockS} 0; }
        .ProseMirror hr { margin: ${blockS} 0; }
        .ProseMirror .tableWrapper { margin: ${blockS} 0; }
        .ProseMirror figure.image-resize-container { margin: ${blockS} 0; }
        .ProseMirror .tiptap-mathematics-block-container { margin: ${blockS} 0; }
    </style>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}">
        window.__imarkdownBaseUri = ${JSON.stringify(baseWebviewUri)};
        // 在捕获阶段拦截编辑器内 <a> 元素的所有点击事件，
        // 先于 VS Code webview 自身的捕获监听器执行，由我们决定是否导航：
        //   • 无修饰键 → stopImmediatePropagation() 阻止 VS Code 导航，
        //     事件仍会冒泡到 ProseMirror 的处理器用于正常光标定位。
        //   • 按住 Ctrl/⌘ → stopImmediatePropagation() 阻止 VS Code 内置路由，
        //     同时发送 'openLink' 消息由扩展宿主通过 vscode.env.openExternal 打开链接。
        document.addEventListener('click', function(e) {
            var target = e.target;
            var link = null;
            if (target && target.tagName === 'A') {
                link = target;
            } else if (target) {
                link = target.closest && target.closest('a');
            }
            if (!link) return;
            // 仅拦截 ProseMirror 编辑器内的链接点击
            var editor = document.querySelector('.ProseMirror');
            if (!editor || !editor.contains(link)) return;
            // 阻止 VS Code webview 的默认导航行为
            e.stopImmediatePropagation();
            if (e.ctrlKey || e.metaKey) {
                var href = link.getAttribute('href');
                if (href && window.__imarkdownVsCodeApi) {
                    window.__imarkdownVsCodeApi.postMessage({ type: 'openLink', href: href });
                }
            }
        }, true /* capture */);

        // 在捕获阶段拦截 Tab/Shift+Tab，防止 VS Code webview 焦点陷阱
        // 在光标位于编辑器内时捕获该事件。
        //
        // 同时调用 preventDefault()（阻止原生 Tab 焦点移动）和
        // stopImmediatePropagation()（阻止 VS Code 的捕获阶段监听器抢占焦点）。
        //
        // 由于 stopImmediatePropagation 会终止后续所有监听器（包括
        // ProseMirror 自身的冒泡阶段 keydown 处理器），无法依赖 ProseMirror
        // 的事件链。因此直接调用 window.__imarkdownTabHandler——由
        // IndentOutdent 扩展注册的回调——来直接执行缩进/反缩进操作。
        document.addEventListener('keydown', function(e) {
            if (e.key !== 'Tab') return;
            if (typeof window.__imarkdownTabHandler !== 'function') return;
            var editor = document.querySelector('.ProseMirror');
            if (!editor) return;
            // 检查编辑器（contenteditable）是否拥有焦点
            var sel = window.getSelection();
            if (!sel || !sel.anchorNode) return;
            if (!editor.contains(sel.anchorNode)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            window.__imarkdownTabHandler(e.shiftKey);
        }, true /* capture */);
    </script>
    <script nonce="${nonce}" type="module" src="${webviewJsUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
    const seeds = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += seeds.charAt(Math.floor(Math.random() * seeds.length));
    }
    return text;
}
