export const i18n = require('i18next');

i18n.init({
    fallbackLng: 'en',
    interpolation: {
        escapeValue: false,
    },
    resources: {
        en: {
            translation: {
                markdownFileNotActivated: 'No activated markdown file found. Please open a .md file first.',
                exportWithErrorMessage: "Export error: {{ errorMessage }}",
                exportHtmlSuccess: "Exported HTML to: {{ path }}\n\nTip: Open in a browser to print as PDF (Ctrl+P / ⌘P), or copy the content into Word for further editing.",
                openInBrowser: "Open in Browser",
                noActiveEditor: "No active iMarkdown editor found. Please open a Markdown file with iMarkdown first.",
                copiedAsMarkdown: "Copied as Markdown text.",
                copiedAsPlainText: "Copied as plain text.",
            }
        },
        zh: {
            translation: {
                markdownFileNotActivated: '未发现活动的 Markdown 文档，请先打开一个 Markdown 文档。',
                exportWithErrorMessage: "导出发生错误：{{ errorMessage }}",
                exportHtmlSuccess: "已导出 HTML 至：{{ path }}\n\n提示：可在浏览器中打开，通过打印(Ctrl+P / ⌘P)导出为 PDF，或将内容复制到 Word 中编辑。",
                openInBrowser: "在浏览器中打开",
                noActiveEditor: "未找到活动的 iMarkdown 编辑器，请先使用 iMarkdown 打开一个 Markdown 文件。",
                copiedAsMarkdown: "已复制为 Markdown 文本。",
                copiedAsPlainText: "已复制为纯文本。",
            }
        },
    }
});