/**
 * 为代码块添加可点击的语言标签。
 *
 * 点击标签将打开包含所有支持语言的下拉列表。
 * 新代码块的默认语言为 'shell'。
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { t } from '../../i18n';

/** Shiki 支持的所有语言（显示在语言选择器中）。 */
export const SUPPORTED_LANGUAGES = [
    // Shell / 脚本
    'shell', 'bash', 'powershell', 'batch',
    // Web 前端
    'html', 'css', 'scss', 'less', 'javascript', 'typescript', 'jsx', 'tsx',
    // 数据 / 配置
    'json', 'jsonc', 'yaml', 'toml', 'xml', 'ini', 'dotenv',
    // 系统级语言
    'c', 'cpp', 'csharp', 'go', 'rust', 'swift',
    // JVM 平台
    'java', 'kotlin', 'scala', 'groovy',
    // 脚本语言
    'python', 'ruby', 'php', 'lua', 'perl', 'r',
    // 函数式语言
    'haskell', 'elixir', 'erlang', 'clojure', 'fsharp', 'ocaml',
    // 移动端
    'objective-c', 'dart',
    // 数据库
    'sql', 'graphql', 'cypher',
    // 基础设施
    'docker', 'terraform', 'nginx',
    // 标记 / 文档
    'markdown', 'latex', 'rst',
    // 其他
    'diff', 'git-commit', 'makefile', 'cmake', 'vue', 'svelte', 'astro',
    'proto', 'wasm', 'zig', 'nim', 'julia',
    'plaintext',
];

let activeDropdown: HTMLElement | null = null;
let activeDropdownPre: HTMLElement | null = null;

function closeDropdown() {
    if (activeDropdown) {
        activeDropdown.remove();
        activeDropdown = null;
        activeDropdownPre = null;
    }
}

/** 标签占据 <pre> 右上角区域，当鼠标坐标（clientX/Y）位于该区域内时返回 true。 */
function isOverBadge(pre: HTMLElement, clientX: number, clientY: number): boolean {
    const rect = pre.getBoundingClientRect();
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    return relX >= rect.width - 120 && relY <= 32;
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
            ? SUPPORTED_LANGUAGES.filter(l => l.includes(filter.toLowerCase()))
            : SUPPORTED_LANGUAGES;
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

    // 标签位于 <pre> 的 top:6px, right:8px 处，高度约 26px。
    // 以标签自身的边界矩形作为定位锚点。
    const preRect = anchorEl.getBoundingClientRect();
    const badgeTop = preRect.top + 6;
    const badgeBottom = preRect.top + 32;
    const badgeRight = preRect.right - 8;

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
                        mousemove: (_view, event) => {
                            // 仅当指针确实位于标签上时才高亮
                            const target = event.target as HTMLElement;
                            const pre = target.closest('pre[data-language]') as HTMLElement | null;

                            // 移除所有不再满足条件的 <pre> 上的高亮
                            document.querySelectorAll('pre.badge-hovered').forEach((el) => {
                                if (el !== pre || (pre && !isOverBadge(pre, event.clientX, event.clientY))) {
                                    el.classList.remove('badge-hovered');
                                }
                            });

                            if (pre && isOverBadge(pre, event.clientX, event.clientY)) {
                                pre.classList.add('badge-hovered');
                            }
                            return false;
                        },
                        mouseleave: (_view, event) => {
                            // 指针完全离开编辑器时清除高亮
                            const target = event.target as HTMLElement;
                            const pre = target.closest('pre[data-language]') as HTMLElement | null;
                            if (pre) pre.classList.remove('badge-hovered');
                            return false;
                        },
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
