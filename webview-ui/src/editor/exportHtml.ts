import { Editor } from '@tiptap/core';

/**
 * 获取用于导出的完整渲染 HTML，图片转为 base64 data URL，并注入必要的样式以保持与编辑器内一致的外观。
 */
export async function getExportHtml(editor: Editor): Promise<string> {
    const editorDom = editor.view.dom;
    const clone = editorDom.cloneNode(true) as HTMLElement;

    convertImagesToBase64(clone, editorDom);
    cleanupKatex(clone);
    removeEditorUI(clone);

    const katexCss = extractKatexCss();
    const katexStyleTag = katexCss ? `<style>${katexCss}</style>` : '';
    const fontStyleTag = buildFontStyleTag(editorDom);
    return fontStyleTag + katexStyleTag + clone.innerHTML;
}

/**
 * 构建一个 <style> 标签，捕获编辑器当前的 font-family、font-size、
 * line-height 和标题间距，使导出的 HTML 与编辑器外观完全一致。
 * 同时注入自包含的 ul/ol/task-list 规则，确保导出 HTML
 * 无论是否加载 editor.css 均能正确渲染。
 */
function buildFontStyleTag(editorDom: HTMLElement): string {
    const computed = window.getComputedStyle(editorDom);
    const fontFamily = computed.fontFamily || 'sans-serif';
    const fontSize = computed.fontSize || '15px';

    // 将计算所得（绝对像素）的 line-height 转换为无单位比例，
    // 使标题（字号更大）能获得等比例更高的行高，
    // 而非被绝对像素值压缩。
    const fontSizePx = parseFloat(fontSize) || 15;
    const lineHeightRaw = computed.lineHeight;
    let lineHeightValue: string;
    if (lineHeightRaw === 'normal' || !lineHeightRaw) {
        lineHeightValue = '1.6';
    } else {
        const lineHeightPx = parseFloat(lineHeightRaw);
        if (!isNaN(lineHeightPx) && fontSizePx > 0) {
            // 四舍五入到 4 位小数，避免浮点数噪声
            lineHeightValue = (lineHeightPx / fontSizePx).toFixed(4);
        } else {
            lineHeightValue = lineHeightRaw;
        }
    }

    // 代码字体：若编辑器内有 <code> 或 <pre> 则从中读取，
    // 否则回退到等宽字体栈。
    let codeFontFamily = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
    const codeEl = editorDom.querySelector('pre code, code') as HTMLElement | null;
    if (codeEl) {
        const codeCss = window.getComputedStyle(codeEl).fontFamily;
        if (codeCss) codeFontFamily = codeCss;
    }

    // 直接从 live DOM 或 editor.css 读取 blockquote 和 pre 的 padding，
    // 使导出 HTML 保留这些容器的内边距。
    // 背景色和边框使用固定的 GitHub 亮色主题值，确保导出 HTML
    // 在标准亮色背景下正确显示，与编辑器当前主题无关。
    const liveBlockquote = editorDom.querySelector('blockquote') as HTMLElement | null;
    let blockquotePaddingLeft = '12px';
    let blockquotePaddingRight = '12px';
    // 引用块的 GitHub 亮色主题样式值
    const blockquoteBg = '#f6f8fa';
    const blockquoteBorderLeft = '3px solid #d0d7de';
    const blockquoteBorderTop = '1px solid #d0d7de';
    const blockquoteBorderRight = '1px solid #d0d7de';
    const blockquoteBorderBottom = '1px solid #d0d7de';
    const blockquoteBorderRadius = '4px';
    if (liveBlockquote) {
        const bqCs = window.getComputedStyle(liveBlockquote);
        blockquotePaddingLeft = bqCs.paddingLeft || '12px';
        blockquotePaddingRight = bqCs.paddingRight || '12px';
    }

    const livePre = editorDom.querySelector('pre') as HTMLElement | null;
    let prePadding = '1em';
    // 代码块的 GitHub 亮色主题样式值
    const preBg = '#f6f8fa';
    const preBorder = '1px solid #d0d7de';
    const preBorderRadius = '6px';
    if (livePre) {
        const preCs = window.getComputedStyle(livePre);
        // 仅当四边相等时使用简写 'padding'，否则使用分别指定的值
        const t = preCs.paddingTop, r = preCs.paddingRight,
              b = preCs.paddingBottom, l = preCs.paddingLeft;
        prePadding = (t === r && r === b && b === l) ? t : `${t} ${r} ${b} ${l}`;
    }

    // 从注入的 <style id="node-spacing-style"> 元素读取所有间距规则，
    // 使导出 HTML 反映当前排版设置（紧凑/适中/宽松）。
    // 去除 ".ProseMirror " 前缀，使规则适用于普通元素。
    //
    // 策略：通过注入临时探针元素，读取*计算后的*（解析像素）边距值。
    // 探针元素使用与 node-spacing-style 相同的 CSS 样式，
    // 即使编辑器 DOM 中没有 h1/blockquote 等元素也能正常工作。
    let spacingCss = '';
    try {
        // 从注入的 <style id="node-spacing-style"> 中获取原始 CSS 文本
        const spacingEl = document.getElementById('node-spacing-style');
        const rawCss = spacingEl?.textContent ?? '';

        /**
         * 从原始 CSS 中解析给定选择器片段（如 'p'、'h1'）的
         * 单条 `margin` 或 `margin-top`/`margin-bottom` 简写值。
         * 返回 { top, bottom } 作为解析后的像素字符串。
         *
         * 通过将原始 CSS 分割为规则块并检查每个选择器，
         * 正确处理逗号分隔的选择器，如
         * `.ProseMirror ul, .ProseMirror ol { ... }`。
         */
        const resolveMargins = (selectorFragment: string): { top: string; bottom: string } => {
            // 首先尝试：在编辑器 DOM 中查找 live 元素
            const live = editorDom.querySelector(selectorFragment) as HTMLElement | null;
            if (live) {
                const cs = window.getComputedStyle(live);
                return { top: cs.marginTop, bottom: cs.marginBottom };
            }

            // 其次尝试：逐规则解析 rawCss（按 '}' 分割），
            // 查找选择器列表包含 selectorFragment 的规则。
            // 正确处理逗号分隔的选择器，如：
            //   .ProseMirror ul, .ProseMirror ol { margin: ... }
            let ruleBody = '';
            const ruleChunks = rawCss.split('}');
            for (const chunk of ruleChunks) {
                const braceIdx = chunk.indexOf('{');
                if (braceIdx === -1) continue;
                const selPart = chunk.slice(0, braceIdx);
                const bodyPart = chunk.slice(braceIdx + 1);
                // 按逗号分隔选择器列表，逐一检查
                const matched = selPart.split(',').some(sel => {
                    // 标准化：去除 .ProseMirror 前缀和首尾空白
                    const normalized = sel.replace(/\.ProseMirror\s*/g, '').trim();
                    return normalized === selectorFragment;
                });
                if (matched) {
                    ruleBody += bodyPart;
                }
            }
            if (!ruleBody) return { top: '0px', bottom: '0px' };

            // 创建与选择器同名标签（或 div）的探针元素，
            // 追加到 editorDom 中以继承正确的 font-size 上下文
            // （对使用 em 单位的 calc() 表达式很重要）。
            const tag = /^[a-z][a-z0-9]*$/i.test(selectorFragment) ? selectorFragment : 'div';
            const probe = document.createElement(tag);
            probe.style.cssText = ruleBody;
            probe.style.position = 'absolute';
            probe.style.visibility = 'hidden';
            probe.style.width = '1px';
            probe.style.height = '1px';
            editorDom.appendChild(probe);
            const cs = window.getComputedStyle(probe);
            const result = { top: cs.marginTop, bottom: cs.marginBottom };
            editorDom.removeChild(probe);
            return result;
        };

        const p         = resolveMargins('p');
        const h1        = resolveMargins('h1');
        const h2        = resolveMargins('h2');
        const h3        = resolveMargins('h3');
        const blockquote = resolveMargins('blockquote');
        const pre       = resolveMargins('pre');
        const hr        = resolveMargins('hr');
        const tableW    = resolveMargins('.tableWrapper');
        const figure    = resolveMargins('figure.image-resize-container');
        const mathBlock = resolveMargins('.tiptap-mathematics-block-container');

        spacingCss = [
            `p { margin: ${p.top} 0 ${p.bottom} 0; }`,
            /* ul/ol 无边距——行高提供所有项间节奏 */
            `ul, ol { margin: 0; }`,
            `li > ul, li > ol { margin: 0; }`,
            `li { margin: 0; }`,
            `li > p { margin: 0; }`,
            `h1 { margin-top: ${h1.top}; margin-bottom: ${h1.bottom}; }`,
            `h2 { margin-top: ${h2.top}; margin-bottom: ${h2.bottom}; }`,
            `h3 { margin-top: ${h3.top}; margin-bottom: ${h3.bottom}; }`,
            // 保留 blockquote 视觉样式（背景、边框、圆角、内边距）
            `blockquote { margin: ${blockquote.top} 0 ${blockquote.bottom} 0; padding-left: ${blockquotePaddingLeft}; padding-right: ${blockquotePaddingRight}; background-color: ${blockquoteBg}; border-left: ${blockquoteBorderLeft}; border-top: ${blockquoteBorderTop}; border-right: ${blockquoteBorderRight}; border-bottom: ${blockquoteBorderBottom}; border-radius: ${blockquoteBorderRadius}; margin-left: 0; }`,
            // 保留代码块视觉样式（背景、边框、圆角、内边距）
            // position:relative 使语言标签能正确定位
            `pre { margin: ${pre.top} 0 ${pre.bottom} 0; padding: ${prePadding}; background-color: ${preBg}; border: ${preBorder}; border-radius: ${preBorderRadius}; overflow: auto; position: relative; }`,
            // 代码语言标签样式（导出为静态 HTML）
            `.code-language-label { float: right; font-size: 11px; padding: 2px 6px; border-radius: 3px; background-color: ${preBg}; color: #666; border: 1px solid #d0d7de; margin: -0.4em 0 4px 6px; }`,
            // 代码行号样式（与编辑器一致）
            `.code-ln { display: inline-block; text-align: right; color: rgba(150, 150, 150, 0.5); font-size: inherit; line-height: inherit; font-family: inherit; pointer-events: none; user-select: none; -webkit-user-select: none; vertical-align: top; box-sizing: border-box; }`,
            `hr { margin: ${hr.top} 0 ${hr.bottom} 0; }`,
            `.tableWrapper { margin: ${tableW.top} 0 ${tableW.bottom} 0; }`,
            `figure { margin: ${figure.top} 0 ${figure.bottom} 0; }`,
            `.tiptap-mathematics-block-container { margin: ${mathBlock.top} 0 ${mathBlock.bottom} 0; }`,
        ].join('\n');
    } catch {
        // 回退：直接读取 node-spacing-style 元素文本
        const spacingEl = document.getElementById('node-spacing-style');
        if (spacingEl?.textContent) {
            spacingCss = spacingEl.textContent
                .replace(/\.ProseMirror\s+/g, '')
                .replace(/\.ProseMirror\b/g, 'div');
        }
    }

    /*
     * 自包含列表样式。
     *
     * 三种列表类型（ul、ol、task）使用相同的绝对定位标记机制，几何完全一致：
     *   padding-left: 2em（内槽）
     *   li:     list-style:none; position:relative
     *   marker: position:absolute; left:-2em; top:0.25em; width:1em; text-align:right; line-height:1
     *
     * 确保 ul •、ol 1. 和 task 复选框在任何浏览器中
     * 垂直对齐到完全相同的顶部偏移（li 顶部 0.25em）。
     */
    const listCss = `
/* ── 无序列表 ── */
ul, ol { padding-left: 2em; margin: 0; }
ul:not([data-type="taskList"]) > li {
    list-style: none;
    position: relative;
}
ul:not([data-type="taskList"]) > li::before {
    content: "•";
    position: absolute;
    left: -2em; top: 0.25em;
    width: 1em; text-align: right; line-height: 1;
}
ul:not([data-type="taskList"]) > li > ul > li::before { content: "○"; }
ul:not([data-type="taskList"]) > li > ul > li > ul > li::before {
    content: "■"; font-size: 0.6em; top: 0.2em;
}

/* ── 有序列表 ── */
/* ol { counter-reset: ol-item; }
ol > li {
    list-style: none;
    position: relative;
    counter-increment: ol-item;
}
ol > li::before {
    content: counter(ol-item) ".";
    position: absolute;
    left: -2em; top: 0.25em;
    width: 1.6em; text-align: right; line-height: 1;
    font-variant-numeric: tabular-nums;
}*/

/* ── 任务列表 ── */
ul[data-type="taskList"] { list-style: none; padding-left: 2em; margin: 0; }
li[data-checked], li[data-type="taskItem"] {
    list-style: none;
    display: block;
    position: relative;
}
li[data-checked] > label, li[data-type="taskItem"] > label {
    position: absolute;
    left: -2em; top: 0.25em;
    width: 2em;
    display: flex; align-items: center; justify-content: flex-end;
    padding-right: 1em; box-sizing: border-box; line-height: 1;
    cursor: default; user-select: none; -webkit-user-select: none;
}
li[data-checked] > label input[type="checkbox"],
li[data-type="taskItem"] > label input[type="checkbox"] {
    margin: 0; padding: 0; flex-shrink: 0;
    /* 禁用交互但保留原生 checked 外观 */
    pointer-events: none;
    opacity: 1;
    cursor: default;
}
li[data-checked] > div, li[data-type="taskItem"] > div { margin: 0; }
li[data-checked] > div > p, li[data-type="taskItem"] > div > p { margin: 0; }
li[data-checked="true"] > div,
li[data-checked="true"] > div > p {
    text-decoration: line-through;
    color: #56B6C2;
}
`;

    return `<style id="export-font-style">
body { font-family: ${fontFamily}; font-size: ${fontSize}; line-height: ${lineHeightValue}; }
code, pre, pre code { font-family: ${codeFontFamily}; }
${spacingCss}
${listCss}
</style>`;
}

/** 通过 canvas 将 webview 图片 src 转换为 base64 data URL。 */
function convertImagesToBase64(clone: HTMLElement, editorDom: HTMLElement): void {
    const imgs = clone.querySelectorAll('img');
    const origImgs = editorDom.querySelectorAll('img');
    imgs.forEach((clonedImg, i) => {
        const origImg = origImgs[i] as HTMLImageElement | undefined;
        if (origImg && origImg.complete && origImg.naturalWidth > 0) {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = origImg.naturalWidth;
                canvas.height = origImg.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(origImg, 0, 0);
                    clonedImg.setAttribute('src', canvas.toDataURL('image/png'));
                }
            } catch { /* cross-origin or tainted canvas */ }
        }
        const wrapper = clonedImg.closest('.image-resize-wrapper');
        if (wrapper) {
            wrapper.querySelectorAll('.resize-handle, .image-inline-edit').forEach(el => el.remove());
        }
    });
}

/** 清理导出用的 KaTeX 元素：移除 MathML，强制使用亮色。 */
function cleanupKatex(clone: HTMLElement): void {
    clone.querySelectorAll('.katex-mathml').forEach(el => el.remove());
    clone.querySelectorAll('.katex').forEach(el => {
        (el as HTMLElement).style.color = '#1f2328';
    });
    clone.querySelectorAll('.tiptap-mathematics-block-container').forEach(el => {
        (el as HTMLElement).style.textAlign = 'center';
        (el as HTMLElement).style.margin = '16px 0';
    });
}

/** 从克隆 DOM 中移除仅编辑器使用的 UI 元素。 */
function removeEditorUI(clone: HTMLElement): void {
    clone.querySelectorAll('.link-inline-edit, .image-inline-edit, .math-inline-edit').forEach(el => el.remove());
    clone.querySelectorAll('.resize-handle').forEach(el => el.remove());
    clone.querySelectorAll('.table-controls, .add-row-btn, .add-col-btn, .column-resize-handle').forEach(el => el.remove());
    // 标题折叠按钮（导出的静态 HTML 不需要交互）
    // 行号保留（与编辑器一致）
    // 清理行号 span 上的编辑器专用属性
    clone.querySelectorAll('.code-ln').forEach(el => {
        el.removeAttribute('contenteditable');
        el.removeAttribute('aria-hidden');
    });
    // 清理语言标签上的编辑器专用属性
    clone.querySelectorAll('.code-language-label').forEach(el => {
        el.removeAttribute('tabindex');
    });
    clone.querySelectorAll('.heading-fold-btn').forEach(el => el.remove());
    // 移除折叠状态标记（使导出 HTML 显示完整内容）
    clone.querySelectorAll('.heading-folded').forEach(el => el.classList.remove('heading-folded'));
    // 移除标题上的折叠相关 data 属性
    clone.querySelectorAll('h1, h2, h3').forEach(el => {
        el.removeAttribute('data-collapsed');
    });

    // ── 图片 figure：内联样式使导出 HTML 正确渲染 ──
    // 编辑器使用 CSS 类（.image-resize-container、.image-caption），依赖
    // 独立 HTML 文件中不存在的 VS Code CSS 变量。
    clone.querySelectorAll('figure.image-resize-container').forEach(fig => {
        (fig as HTMLElement).style.cssText =
            'display:block;margin:8px 0;padding:0;border:none;';
        // 移除 figure 内可能存在的拖拽/缩放 UI
        fig.querySelectorAll('.image-inline-edit, .image-resize-handle, .image-resize-handle-corner').forEach(el => el.remove());
        // 移除包含 img + 缩放控件的内联块 wrapper div，
        // 只保留 img 和 figcaption 作为 figure 的直接子元素。
        // 这样可使导出的标记保持整洁，避免 wrapper 的宽度样式
        // 在未设定宽度时将图片固定到特定像素宽度。
        fig.querySelectorAll('div').forEach(wrapper => {
            // The wrapper contains the img — pull img out and remove the wrapper
            const wrapperImg = wrapper.querySelector('img');
            if (wrapperImg) {
                fig.insertBefore(wrapperImg, wrapper);
            }
            wrapper.remove();
        });
        // 对 img 应用合理的静态样式
        const imgEl = fig.querySelector('img') as HTMLImageElement | null;
        if (imgEl) {
            imgEl.style.maxWidth = '100%';
            imgEl.style.height = 'auto';
            imgEl.style.display = 'block';
            imgEl.style.borderRadius = '4px';
            imgEl.style.margin = '0 auto';
        }
    });
    // 内联 figcaption 样式（使用 CSS 变量——替换为静态值）
    clone.querySelectorAll('figcaption.image-caption').forEach(cap => {
        (cap as HTMLElement).style.cssText =
            'display:block;text-align:center;font-size:0.85em;' +
            'color:#888;padding:4px 8px 2px;line-height:1.4;word-break:break-word;';
    });

    // 清理破坏静态 HTML 布局的任务项 NodeView 属性。
    // 注意：导出的 li 元素使用 data-checked 属性（而非 data-type="taskItem"）
    clone.querySelectorAll('li[data-checked]').forEach(li => {
        // 从 label 和内容 div 中移除 contenteditable
        li.querySelectorAll('[contenteditable]').forEach(el => {
            el.removeAttribute('contenteditable');
        });
        // 移除 label 内的装饰性 <span>（checkboxStyler，仅编辑器使用）
        li.querySelectorAll('label > span').forEach(el => el.remove());

        // 从 live DOM 同步 checkbox 的 checked 状态（cloneNode 复制
        // 属性，但 .checked 属性可能与特性值不同）。
        const checkedAttr = li.getAttribute('data-checked');
        const isChecked = checkedAttr === 'true';

        // 用全新的 <input> 替换克隆的 <input>，确保 checked/disabled
        // 属性以 HTML 属性（而非 DOM 属性）的形式存在，
        // 使 clone.innerHTML 能正确序列化。
        const oldCheckbox = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (oldCheckbox) {
            const newCheckbox = document.createElement('input');
            newCheckbox.type = 'checkbox';
            if (isChecked) newCheckbox.setAttribute('checked', 'checked');
            newCheckbox.setAttribute('disabled', 'disabled');
            newCheckbox.style.cssText = 'margin:0;padding:0;flex-shrink:0;pointer-events:none;opacity:1;cursor:default;';
            oldCheckbox.replaceWith(newCheckbox);
        }
        /*
         * 内联样式完全镜像新版 editor.css 的任务项布局。
         *
         * 逻辑与 ul::before 项目符号几何一致：
         *   ul: padding-left 2em
         *   ::before: position:absolute; left:-2em; width:1em; text-align:right; top:0.25em
         *   → 项目符号右边缘距文本左边缘 1em
         *
         * 任务项：
         *   li:    position:relative; display:block（与 ul>li 相同）
         *   label: position:absolute; left:-2em; width:2em; padding-right:1em（右对齐复选框，
         *          使其右边缘距文本 1em——与项目符号间距完全相同）
         *          top:0.25em（与 ::before top 相同）
         *   div:   普通块，从 li 内容盒左侧 0 开始，全宽
         *          （label 脱离文档流 → 无需偏移）
         */
        (li as HTMLElement).style.cssText =
            'display:block;position:relative;list-style:none;';
        const label = li.querySelector(':scope > label');
        if (label) {
            (label as HTMLElement).style.cssText =
                'position:absolute;left:-2em;width:2em;top:0.25em;' +
                'display:flex;align-items:center;justify-content:flex-end;' +
                'padding-right:1em;box-sizing:border-box;line-height:1;' +
                'cursor:default;user-select:none;-webkit-user-select:none;';
            // newCheckbox 的样式已在上方设置；此处无需额外操作
        }
        const div = li.querySelector(':scope > div');
        if (div) {
            (div as HTMLElement).style.cssText = 'margin:0;';
            div.querySelectorAll('p').forEach(p => { p.style.cssText = 'margin:0;'; });
        }
    });
    // 确保任务列表 ul 具有匹配的 padding
    clone.querySelectorAll('ul[data-type="taskList"]').forEach(ul => {
        (ul as HTMLElement).style.cssText =
            'list-style:none;padding-left:2em;margin-left:0;';
    });
}

/** 从页面样式表中提取 KaTeX CSS 规则（排除 @font-face）。 */
function extractKatexCss(): string {
    let css = '';
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            for (let i = 0; i < sheet.cssRules.length; i++) {
                const rule = sheet.cssRules[i];
                if (rule instanceof CSSFontFaceRule) continue;
                if (rule instanceof CSSStyleRule) {
                    if (/\.katex[\s,:{[>~+\-.]/.test(rule.selectorText) ||
                        rule.selectorText.includes('.katex-display')) {
                        css += rule.cssText + '\n';
                    }
                }
            }
        } catch { /* 跨域样式表 */ }
    }
    return css;
}
