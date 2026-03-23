import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// 导入打包的语言高亮配置
import javascript from 'shiki/langs/javascript.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import html from 'shiki/langs/html.mjs';
import css from 'shiki/langs/css.mjs';
import json from 'shiki/langs/json.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import python from 'shiki/langs/python.mjs';
import bash from 'shiki/langs/bash.mjs';
import sql from 'shiki/langs/sql.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import java from 'shiki/langs/java.mjs';
import c from 'shiki/langs/c.mjs';
import cpp from 'shiki/langs/cpp.mjs';
import csharp from 'shiki/langs/csharp.mjs';
import go from 'shiki/langs/go.mjs';
import rust from 'shiki/langs/rust.mjs';
import ruby from 'shiki/langs/ruby.mjs';
import php from 'shiki/langs/php.mjs';
import swift from 'shiki/langs/swift.mjs';
import kotlin from 'shiki/langs/kotlin.mjs';
import scala from 'shiki/langs/scala.mjs';
import powershell from 'shiki/langs/powershell.mjs';
import toml from 'shiki/langs/toml.mjs';
import xml from 'shiki/langs/xml.mjs';
import scss from 'shiki/langs/scss.mjs';
import less from 'shiki/langs/less.mjs';
import graphql from 'shiki/langs/graphql.mjs';
import docker from 'shiki/langs/docker.mjs';
import terraform from 'shiki/langs/terraform.mjs';
import lua from 'shiki/langs/lua.mjs';
import r from 'shiki/langs/r.mjs';
import latex from 'shiki/langs/latex.mjs';
import diff from 'shiki/langs/diff.mjs';
import ini from 'shiki/langs/ini.mjs';
import nginx from 'shiki/langs/nginx.mjs';

export const bundledLangs = [
    javascript, typescript, html, css, json, yaml, markdown, python, bash, sql,
    tsx, jsx, java, c, cpp, csharp, go, rust, ruby, php, swift, kotlin, scala,
    powershell, toml, xml, scss, less, graphql, docker, terraform, lua, r, latex,
    diff, ini, nginx,
];

export const langAliases: Record<string, string> = {
    html: 'html', htm: 'html',
    md: 'markdown', commonmark: 'markdown', gfm: 'markdown',
    javascript: 'javascript', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    typescript: 'typescript', ts: 'typescript', mts: 'typescript', cts: 'typescript',
    sh: 'bash', shell: 'bash', shellscript: 'bash', zsh: 'bash',
    yml: 'yaml',
    py: 'python', python3: 'python',
    cs: 'csharp',
    rb: 'ruby',
    rs: 'rust',
    kt: 'kotlin', kts: 'kotlin',
    ps1: 'powershell', ps: 'powershell',
    tf: 'terraform', hcl: 'terraform',
    dockerfile: 'docker',
    tex: 'latex',
};

let highlighter: HighlighterCore | null = null;
let highlighterVersion = 0;
let pendingTheme: object | null = null;
const highlighterReadyCallbacks: Array<() => void> = [];

/** 注册一个一次性回调，在下次 updateTheme 完成后触发。 */
export function onHighlighterReady(cb: () => void): void {
    highlighterReadyCallbacks.push(cb);
}

export async function initHighlighter(theme: object): Promise<HighlighterCore | null> {
    try {
        return await createHighlighterCore({
            engine: createJavaScriptRegexEngine(),
            themes: [theme],
            langs: bundledLangs,
        });
    } catch (error) {
        console.error('[iMarkdown] Shiki 高亮器创建失败:', error);
        return null;
    }
}

export async function updateTheme(theme: object, editorView?: any): Promise<void> {
    if (!theme) return;
    pendingTheme = theme;

    try {
        if (highlighter) {
            highlighter.dispose();
            highlighter = null;
        }
        highlighter = await initHighlighter(theme);
        highlighterVersion++;
        clearTokenCache();

        if (editorView && highlighter) {
            const tr = editorView.state.tr.setMeta('shikiUpdate', true);
            editorView.dispatch(tr);
        }

        // 触发所有一次性就绪回调（例如因高亮器未就绪而延迟加载的 loadContent）
        if (highlighterReadyCallbacks.length > 0) {
            const cbs = highlighterReadyCallbacks.splice(0);
            cbs.forEach((cb) => cb());
        }
    } catch (error) {
        console.error('[iMarkdown] Shiki 主题更新失败:', error);
    }
}

export function getPendingTheme(): object | null {
    return pendingTheme;
}

export function getHighlighter(): HighlighterCore | null {
    return highlighter;
}

/**
 * 构建单个内联行号组件的工厂函数。
 *
 * 核心约束：组件在文本流中的净宽度必须为零，
 * 以保证其后的代码文本始终从同一水平位置开始，
 * 无论该行位于第几行——即软换行的续行与首行对齐。
 *
 * 布局原理：
 *   span.width      = gutterCh   （= 完整 gutter 宽度）
 *   span.marginLeft = -gutterCh  （向左偏移等于自身宽度）
 *   → 文本流中净前进量 = 0
 *
 * <pre> 设置了 padding-left: gutterCh，代码文本自然从左边框偏移 gutterCh 处开始。
 * 首行和续行均从该位置起始。
 *
 * span 内部：行号右对齐，paddingRight = 2ch（数字与代码的间距），
 * paddingLeft = 0.5ch（左边框到数字的间距）。
 *
 * @param lineNum   要显示的行号（从 1 开始）
 * @param digits    最大行号的位数（用于计算宽度）
 * @param gutterCh  gutter 总宽度，单位 ch（= <pre> 的 padding-left）
 */
function lineNumberWidget(lineNum: number, digits: number, gutterCh: number): () => HTMLElement {
    return () => {
        const span = document.createElement('span');
        span.className = 'code-ln';
        span.setAttribute('contenteditable', 'false');
        span.setAttribute('aria-hidden', 'true');
        span.setAttribute('data-ln', String(lineNum));
        span.textContent = String(lineNum);
        // 占满整个 gutter 宽度，再用等量负外边距抵消，
        // 使内联流中的净前进量恰好为零。
        span.style.width       = `${gutterCh}ch`;
        span.style.marginLeft  = `-${gutterCh}ch`;
        // 内部间距：左 0.5ch（边框→数字），右 2ch（数字→代码）。
        // text-align: right（由 CSS 设置）+ paddingRight 将数字推到 gutter 内正确位置。
        span.style.paddingLeft  = `0.5ch`;
        span.style.paddingRight = `2ch`;
        return span;
    };
}

/**
 * Shiki token 化结果的 LRU 缓存。
 * Key：`${language}\0${textContent}`，Value：token 化结果。
 * 避免在每次按键时对未修改的代码块重复进行 token 化。
 */
const tokenCache = new Map<string, any>();
const TOKEN_CACHE_MAX = 64;

function getCachedTokens(language: string, text: string, themeName: string) {
    const key = `${language}\0${text}`;
    const cached = tokenCache.get(key);
    if (cached) {
        // 移到末尾（最近使用）
        tokenCache.delete(key);
        tokenCache.set(key, cached);
        return cached;
    }
    const result = highlighter!.codeToTokens(text, { lang: language, theme: themeName });
    tokenCache.set(key, result);
    // 缓存已满时淘汰最旧的条目
    if (tokenCache.size > TOKEN_CACHE_MAX) {
        const firstKey = tokenCache.keys().next().value!;
        tokenCache.delete(firstKey);
    }
    return result;
}

/** 清空 token 缓存（主题切换时调用）。 */
function clearTokenCache(): void {
    tokenCache.clear();
}

function createDecorations(doc: ProseMirrorNode): DecorationSet {
    if (!highlighter) return DecorationSet.empty;
    const decorations: Decoration[] = [];
    const loadedLangs = highlighter.getLoadedLanguages();
    const loadedThemes = highlighter.getLoadedThemes();
    const themeName = loadedThemes[0] || 'github-dark';
    const showLineNumbers = document.body.classList.contains('show-line-numbers');
    doc.descendants((node, pos) => {
        if (node.type.name !== 'codeBlock') return;

        let language = node.attrs.language || '';
        language = langAliases[language] || language || 'javascript';

        // 为所有代码块添加逐行内联行号组件
        if (showLineNumbers) {
            const text = node.textContent;
            // 按换行符拆分，计算每行在节点内的起始偏移。
            // pos + 1 是文本内容的起始位置（跳过 codeBlock 开放 token）。
            const lines = text ? text.split('\n') : [''];
            const totalLines = lines.length;
            const digits = String(totalLines).length;
            // gutterCh = 左边距(1) + 数字宽度(digits+0.5) + 右间距(1.5) = digits+3
            // 设置为 <pre> 节点的 padding-left，使软换行的续行
            // 自动与代码起始位置对齐。
            const gutterCh = digits + 3;
            let lineOffset = 0;
            for (let i = 0; i < lines.length; i++) {
                const linePos = pos + 1 + lineOffset;
                decorations.push(
                    Decoration.widget(linePos, lineNumberWidget(i + 1, digits, gutterCh), {
                        side: -1,
                        key: `ln-${pos}-${i}`,
                        ignoreSelection: true,
                    }),
                );
                lineOffset += lines[i].length + 1; // +1 对应换行符
            }
            // 通过 data 属性为 <pre> 节点动态设置 gutter padding
            decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                    class: 'has-line-numbers',
                    style: `padding: 1em 1em 1em ${gutterCh}ch`,
                }),
            );
        }

        // 纯文本不做语法高亮
        if (language === 'plaintext' || language === 'text' || language === 'plain') return;

        const text = node.textContent;
        if (!text) return;

        try {
            if (!loadedLangs.includes(language)) {
                language = 'javascript';
            }

            const result = getCachedTokens(language, text, themeName);

            let offset = 0;
            for (const line of result.tokens) {
                for (const token of line) {
                    const from = pos + 1 + offset;
                    const to = from + token.content.length;

                    if (from < to && token.color) {
                        decorations.push(
                            Decoration.inline(from, to, { style: `color: ${token.color};` })
                        );
                    }
                    offset += token.content.length;
                }
                offset += 1;
            }
            offset -= 1;
        } catch {
            // 不支持的语言静默忽略
        }
    });

    return DecorationSet.create(doc, decorations);
}

let lastHighlighterVersion = 0;

export const ShikiHighlight = Extension.create({
    name: 'shikiHighlight',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('shikiHighlight'),
                state: {
                    init: (_, { doc }) => {
                        lastHighlighterVersion = highlighterVersion;
                        return createDecorations(doc);
                    },
                    apply: (tr, oldState, _oldEditorState, newEditorState) => {
                        const shikiUpdate = tr.getMeta('shikiUpdate');
                        const versionChanged = lastHighlighterVersion !== highlighterVersion;

                        if (shikiUpdate || versionChanged || tr.docChanged) {
                            lastHighlighterVersion = highlighterVersion;
                            return createDecorations(newEditorState.doc);
                        }
                        return oldState;
                    },
                },
                props: {
                    decorations(state) {
                        return this.getState(state);
                    },
                },
            }),
        ];
    },
});
