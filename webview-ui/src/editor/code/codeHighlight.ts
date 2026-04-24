/**
 * 代码块语法高亮与语言选择器。
 *
 * - Shiki 语法高亮：基于 token 的精确着色
 * - 语言选择器：点击标签打开下拉列表切换语言
 * - 行号显示：支持软换行对齐的内联行号
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { t } from '../../i18n';

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

/**
 * 代码块语言注册表。
 *
 * 以语言条目为核心，每条语言同时定义 shiki 模块和别名，
 * 添加新语言只需在 langs 数组中追加一条记录即可，
 * bundled / aliases / selector 均从中自动派生。
 */

interface LangEntry {
    /** 标准 ID（用于 data-language 属性和选择器显示）。 */
    id: string;
    /** Shiki 语言高亮模块，无高亮支持时省略。 */
    module?: LanguageInput;
    /** 别名列表（短名、常见变体等），映射到 id。 */
    aliases?: string[];
    /** 是否在选择器中显示，默认 true。设为 false 可隐藏仅有别名用途的条目。 */
    visible?: boolean;
}

type LanguageInput = typeof javascript; // shiki LanguageRegistration

const langs: LangEntry[] = [
    // ── Shell / 脚本 ──────────────────────────────────────────
    { id: 'bash',          module: bash,          aliases: ['sh', 'shell', 'shellscript', 'zsh'] },
    { id: 'powershell',    module: powershell,     aliases: ['ps1', 'ps'] },
    { id: 'batch',                                          visible: true },
    // ── Web 前端 ──────────────────────────────────────────────
    { id: 'html',          module: html,           aliases: ['htm'] },
    { id: 'css',           module: css },
    { id: 'scss',          module: scss },
    { id: 'less',          module: less },
    { id: 'javascript',    module: javascript,      aliases: ['js', 'mjs', 'cjs'] },
    { id: 'typescript',    module: typescript,       aliases: ['ts', 'mts', 'cts'] },
    { id: 'jsx',           module: jsx },
    { id: 'tsx',           module: tsx },
    // ── 数据 / 配置 ───────────────────────────────────────────
    { id: 'json',          module: json },
    { id: 'jsonc',                                          visible: true },
    { id: 'yaml',          module: yaml,            aliases: ['yml'] },
    { id: 'toml',          module: toml },
    { id: 'xml',           module: xml },
    { id: 'ini',           module: ini,             aliases: ['dotenv'] },
    // ── 系统级语言 ────────────────────────────────────────────
    { id: 'c',             module: c },
    { id: 'cpp',           module: cpp },
    { id: 'csharp',       module: csharp,          aliases: ['cs'] },
    { id: 'go',            module: go },
    { id: 'rust',          module: rust,            aliases: ['rs'] },
    { id: 'swift',         module: swift },
    // ── JVM 平台 ──────────────────────────────────────────────
    { id: 'java',          module: java },
    { id: 'kotlin',        module: kotlin,           aliases: ['kt', 'kts'] },
    { id: 'scala',         module: scala },
    { id: 'groovy',                                         visible: true },
    // ── 脚本语言 ──────────────────────────────────────────────
    { id: 'python',        module: python,           aliases: ['py', 'python3'] },
    { id: 'ruby',          module: ruby,             aliases: ['rb'] },
    { id: 'php',           module: php },
    { id: 'lua',           module: lua },
    { id: 'perl',                                           visible: true },
    { id: 'r',             module: r },
    // ── 函数式语言 ────────────────────────────────────────────
    { id: 'haskell',                                        visible: true },
    { id: 'elixir',                                         visible: true },
    { id: 'erlang',                                         visible: true },
    { id: 'clojure',                                        visible: true },
    { id: 'fsharp',                                         visible: true },
    { id: 'ocaml',                                          visible: true },
    // ── 移动端 ────────────────────────────────────────────────
    { id: 'objective-c',                                    visible: true },
    { id: 'dart',                                           visible: true },
    // ── 数据库 ────────────────────────────────────────────────
    { id: 'sql',           module: sql },
    { id: 'graphql',       module: graphql },
    { id: 'cypher',                                         visible: true },
    // ── 基础设施 ──────────────────────────────────────────────
    { id: 'docker',        module: docker,           aliases: ['dockerfile'] },
    { id: 'terraform',     module: terraform,         aliases: ['tf', 'hcl'] },
    { id: 'nginx',         module: nginx },
    // ── 标记 / 文档 ───────────────────────────────────────────
    { id: 'markdown',      module: markdown,          aliases: ['md', 'commonmark', 'gfm'] },
    { id: 'latex',         module: latex,             aliases: ['tex'] },
    { id: 'rst',                                             visible: true },
    // ── 其他 ──────────────────────────────────────────────────
    { id: 'diff',          module: diff },
    { id: 'git-commit',                                      visible: true },
    { id: 'makefile',                                        visible: true },
    { id: 'cmake',                                           visible: true },
    { id: 'vue',                                             visible: true },
    { id: 'svelte',                                          visible: true },
    { id: 'astro',                                           visible: true },
    { id: 'proto',                                           visible: true },
    { id: 'wasm',                                            visible: true },
    { id: 'zig',                                             visible: true },
    { id: 'nim',                                             visible: true },
    { id: 'julia',                                           visible: true },
    // ── 兜底 ──────────────────────────────────────────────────
    { id: 'plaintext',                                      visible: true },
];

export const langRegistry = {
    /** Shiki 打包的语言高亮模块（传入 createHighlighterCore）。 */
    get bundled(): LanguageInput[] {
        return langs.filter(l => l.module).map(l => l.module!);
    },

    /** 语言别名映射（短名 / 变体 → 标准 ID）。 */
    get aliases(): Record<string, string> {
        const map: Record<string, string> = {};
        for (const l of langs) {
            // 标准 ID 自映射，确保 resolve 时总能命中
            map[l.id] = l.id;
            if (l.aliases) {
                for (const a of l.aliases) map[a] = l.id;
            }
        }
        return map;
    },

    /** 语言选择器中展示的 ID 列表。 */
    get selector(): string[] {
        return langs.filter(l => l.visible !== false).map(l => l.id);
    },

    /** 将任意语言标识解析为标准 ID，未命中时原样返回。 */
    resolve(id: string): string {
        return this.aliases[id] || id;
    },
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
            langs: langRegistry.bundled,
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
        language = langRegistry.resolve(language) || 'javascript';

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

// ═══════════════════════════════════════════════════════════════════════════
// 语言选择器
// ═══════════════════════════════════════════════════════════════════════════

let activeDropdown: HTMLElement | null = null;
let activeDropdownPre: HTMLElement | null = null;

function closeDropdown() {
    if (activeDropdown) {
        activeDropdown.remove();
        activeDropdown = null;
    }
    if (activeDropdownPre) {
        activeDropdownPre = null;
    }
}

/** 标签占据 <pre> 右上角区域，当鼠标坐标（clientX/Y）位于该区域内时返回 true。 */
function isOverBadge(pre: HTMLElement, clientX: number, clientY: number): boolean {
    const badge = pre.querySelector('.code-language-label') as HTMLElement | null;
    if (!badge) return false;
    const rect = badge.getBoundingClientRect();
    // 稍微扩大点击区域以提升易用性
    return clientX >= rect.left - 4 &&
        clientX <= rect.right + 4 &&
        clientY >= rect.top - 4 &&
        clientY <= rect.bottom + 4;
}

function openLanguageDropdown(
    anchorEl: HTMLElement,
    currentLang: string,
    onSelect: (lang: string) => void,
) {
    closeDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'code-lang-dropdown';
    activeDropdown = dropdown;
    activeDropdownPre = anchorEl;

    // 搜索输入框
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'code-lang-search';
    search.placeholder = t('codeLang.searchPlaceholder');
    dropdown.appendChild(search);

    const list = document.createElement('ul');
    list.className = 'code-lang-list';
    dropdown.appendChild(list);

    function renderList(filter: string) {
        list.innerHTML = '';
        const filtered = filter
            ? langRegistry.selector.filter((l: string) => l.includes(filter.toLowerCase()))
            : [...langRegistry.selector];
        if (filtered.length === 0) {
            const li = document.createElement('li');
            li.className = 'code-lang-item code-lang-item--empty';
            li.textContent = t('codeLang.noResults');
            list.appendChild(li);
            return;
        }
        for (const lang of filtered) {
            const li = document.createElement('li');
            li.className = 'code-lang-item' + (lang === currentLang ? ' code-lang-item--active' : '');
            li.textContent = lang;
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect(lang);
                closeDropdown();
            });
            list.appendChild(li);
        }
    }

    renderList('');
    search.addEventListener('input', () => renderList(search.value));

    // 先追加到 DOM 以便测量实际渲染高度
    document.body.appendChild(dropdown);

    // 以标签自身的边界矩形作为定位锚点（float 布局下位置由渲染决定）。
    const badge = anchorEl.querySelector('.code-language-label') as HTMLElement | null;
    let badgeTop: number, badgeBottom: number, badgeRight: number;
    if (badge) {
        const badgeRect = badge.getBoundingClientRect();
        badgeTop = badgeRect.top;
        badgeBottom = badgeRect.bottom;
        badgeRight = badgeRect.right;
    } else {
        // 回退：基于 <pre> 估算
        const preRect = anchorEl.getBoundingClientRect();
        badgeTop = preRect.top + 6;
        badgeBottom = preRect.top + 32;
        badgeRight = preRect.right - 8;
    }

    const dropH = dropdown.offsetHeight;
    const dropW = dropdown.offsetWidth;

    // 判断下拉菜单是在标签下方还是上方展开
    const spaceBelow = window.innerHeight - badgeBottom - 4;
    const spaceAbove = badgeTop - 4;
    let top: number;
    if (spaceBelow >= dropH || spaceBelow >= spaceAbove) {
        top = badgeBottom + 4;
    } else {
        top = badgeTop - dropH - 4;
    }

    let left = badgeRight - dropW;
    if (left < 4) left = 4;
    if (left + dropW > window.innerWidth - 4) left = window.innerWidth - dropW - 4;

    dropdown.style.top = `${top}px`;
    dropdown.style.left = `${left}px`;

    // 编辑器滚动时关闭下拉菜单
    const handleScroll = () => {
        if (activeDropdown) closeDropdown();
    };
    const editorEl = anchorEl.closest('.ProseMirror') || anchorEl.closest('[contenteditable]');
    if (editorEl) {
        editorEl.addEventListener('scroll', handleScroll, { once: true, passive: true });
        // 同时监听最近的滚动祖先（如 webview 容器）
        let scrollParent = editorEl.parentElement;
        while (scrollParent) {
            const style = getComputedStyle(scrollParent);
            if (style.overflow === 'auto' || style.overflow === 'scroll' ||
                style.overflowY === 'auto' || style.overflowY === 'scroll') {
                scrollParent.addEventListener('scroll', handleScroll, { once: true, passive: true });
            }
            scrollParent = scrollParent.parentElement;
        }
    }

    // 点击外部时关闭，但点击打开它的标签时不关闭
    //（该情况由插件中的点击切换逻辑处理）。
    const handleOutside = (e: MouseEvent) => {
        if (dropdown.contains(e.target as Node)) return;
        // 若点击的是同一 <pre> 的标签，让插件的点击切换逻辑处理
        if (activeDropdownPre && isOverBadge(activeDropdownPre, e.clientX, e.clientY)) return;
        closeDropdown();
        document.removeEventListener('mousedown', handleOutside, true);
    };
    document.addEventListener('mousedown', handleOutside, true);

    // 将当前活跃项滚动到可视范围并聚焦搜索框
    setTimeout(() => {
        const active = list.querySelector('.code-lang-item--active') as HTMLElement | null;
        if (active) active.scrollIntoView({ block: 'nearest' });
        search.focus();
    }, 0);
}

export const CodeBlockLanguageSelector = Extension.create({
    name: 'codeBlockLanguageSelector',

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('codeBlockLanguageSelector'),
                props: {
                    handleDOMEvents: {
                        click: (view, event) => {
                            const target = event.target as HTMLElement;
                            const pre = target.closest('pre[data-language]') as HTMLElement | null;
                            if (!pre) return false;

                            if (!isOverBadge(pre, event.clientX, event.clientY)) return false;

                            event.preventDefault();
                            event.stopPropagation();

                            // 切换：若下拉菜单已为该 <pre> 打开，则关闭。
                            if (activeDropdown && activeDropdownPre === pre) {
                                closeDropdown();
                                return true;
                            }

                            const currentLang = pre.getAttribute('data-language') || 'shell';

                            // 在点击时立即获取代码块节点位置，
                            // 避免回调依赖失效的 DOM 引用。
                            let clickPos = -1;
                            view.state.doc.descendants((n, p) => {
                                if (clickPos !== -1) return false;
                                if (n.type.name === 'codeBlock') {
                                    const dom = view.nodeDOM(p);
                                    if (dom === pre || (dom as HTMLElement)?.contains(pre)) {
                                        clickPos = p;
                                        return false;
                                    }
                                }
                            });
                            if (clickPos === -1) return false;

                            openLanguageDropdown(pre, currentLang, (lang) => {
                                // 使用最新的 view.state（选择时的当前状态），
                                // 但位置使用点击时捕获的值。
                                const node = view.state.doc.nodeAt(clickPos);
                                if (!node || node.type.name !== 'codeBlock') return;
                                const tr = view.state.tr.setNodeMarkup(clickPos, undefined, {
                                    ...node.attrs,
                                    language: lang,
                                });
                                view.dispatch(tr);
                            });

                            return true;
                        },
                    },
                },
            }),
        ];
    },
});
