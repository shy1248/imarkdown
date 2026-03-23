/**
 * 可复用的本地路径补全，供需要在 DOM <input> 上进行路径补全的场景使用：
 *   - link/linkInsert.ts（链接插入面板的 URL 输入框）
 *   - image/resizableImage.ts（图片编辑面板的 src 输入框）
 *
 * 与 pathCompletion.ts（ProseMirror 插件）的定位不同：
 *   - 本模块直接操控 DOM <input>，通过 VS Code 消息总线请求补全结果。
 *   - ProseMirror 插件负责检测编辑器内 Markdown 链接/图片语法，委托 App 层渲染下拉框。
 *
 * 下拉框 UI 由 App.tsx 通过 registerDomPathCompletionBridge() 注册的桥接实现，
 * 复用与 PM 编辑器路径补全相同的 React <PathCompletionMenu> 组件。
 */

import { postMessage } from '../../vscode';

export interface PathCompletionItem {
    label: string;
    isDir: boolean;
}

// ── 桥接接口（由 App.tsx 注册，PathCompleter 调用）───────────────────────────

/**
 * App.tsx 向本模块注册的桥接，PathCompleter 通过此接口驱动 React 下拉菜单，
 * 无需在 DOM 中自行创建下拉框 UI。
 */
export interface DomPathCompletionBridge {
    /**
     * 展示/更新下拉菜单。
     * @param coords  input 元素的位置信息，供菜单定位使用。
     * @param items   补全结果列表。
     * @param onApply 用户选中某项时的回调（由 PathCompleter 提供）。
     */
    show(
        coords: { left: number; top: number; bottom: number },
        items: PathCompletionItem[],
        onApply: (item: PathCompletionItem) => void,
    ): void;
    /** 隐藏下拉菜单并清除 DOM input 上下文。 */
    hide(): void;
    /** 查询下拉菜单当前是否可见。 */
    isVisible(): boolean;
    /** 键盘导航：1=向下，-1=向上。 */
    navigate(direction: 1 | -1): void;
    /** 确认当前高亮项（Tab / Enter 触发）。 */
    confirm(): void;
}

let _bridge: DomPathCompletionBridge | null = null;
/** 当前正在等待补全结果的 PathCompleter 实例（最多一个）*/
let _activeCompleter: PathCompleter | null = null;

/**
 * 由 App.tsx 在挂载后调用，注册桥接实现。
 * 返回注销函数（App 卸载时调用）。
 */
export function registerDomPathCompletionBridge(bridge: DomPathCompletionBridge): () => void {
    _bridge = bridge;
    return () => { if (_bridge === bridge) _bridge = null; };
}

/**
 * 将 pathCompletionResult 消息路由到当前活跃的 PathCompleter。
 * 由 App.tsx / useVSCodeMessages 在收到消息后调用。
 * 若 requestId 被 PathCompleter 认领则返回 true，否则返回 false（继续 PM 路径）。
 */
export function routeDomPathCompletionResult(requestId: string, items: PathCompletionItem[]): boolean {
    if (!_activeCompleter) return false;
    return _activeCompleter.showResult(requestId, items);
}

// ── 路径前缀判断 ─────────────────────────────────────────────────────────────

/**
 * 判断输入值是否像本地文件路径，而非 http/mailto/锚点 URL。
 * 只要不是明确的网络协议，就视为可能的本地路径并触发补全请求。
 */
export function looksLikeLocalPath(value: string): boolean {
    if (!value) return false;
    if (/^https?:\/\//i.test(value)) return false;
    if (/^mailto:/i.test(value)) return false;
    if (value.startsWith('#')) return false;
    if (value.startsWith('//')) return false;
    if (/^data:/i.test(value)) return false;
    if (/^[a-z][a-z0-9+\-.]*:/i.test(value)) return false;
    return true;
}

// ── PathCompleter 类 ─────────────────────────────────────────────────────────

/**
 * 为指定 <input> 添加路径补全功能，驱动 App 层注册的桥接渲染下拉菜单。
 * 通过 VS Code webview 消息总线与扩展宿主通信获取补全结果。
 *
 * 使用方式：
 * ```ts
 * const pc = new PathCompleter(inputEl);
 * // 在面板关闭/销毁时：
 * pc.destroy();
 * ```
 */
export class PathCompleter {
    private pendingRequestId = '';
    /** 在程序化 dispatchEvent 之前递增，onInput 中递减，避免自触发 */
    private suppressInputCount = 0;

    constructor(private readonly input: HTMLInputElement) {
        this.input.addEventListener('input', this.onInput);
        this.input.addEventListener('keydown', this.onKeyDown, true);
        this.input.addEventListener('blur', this.onBlur);
    }

    destroy() {
        this.input.removeEventListener('input', this.onInput);
        this.input.removeEventListener('keydown', this.onKeyDown, true);
        this.input.removeEventListener('blur', this.onBlur);
        // 清除活跃实例引用
        if (_activeCompleter === this) _activeCompleter = null;
        // 确保桥接侧的菜单也被隐藏
        if (_bridge?.isVisible()) _bridge.hide();
    }

    /** 是否当前正在展示下拉菜单 */
    get isVisible(): boolean {
        return _bridge?.isVisible() ?? false;
    }

    private onInput = () => {
        if (this.suppressInputCount > 0) { this.suppressInputCount--; return; }
        const value = this.input.value;
        if (!looksLikeLocalPath(value)) {
            _bridge?.hide();
            if (_activeCompleter === this) _activeCompleter = null;
            return;
        }
        // 注册为当前活跃实例，使 routeDomPathCompletionResult 能将结果路由到此处
        _activeCompleter = this;
        const id = `pc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.pendingRequestId = id;
        postMessage({ type: 'requestPathCompletion', prefix: value, requestId: id });
    };

    private onKeyDown = (e: KeyboardEvent) => {
        if (!this.isVisible) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault(); e.stopPropagation();
            _bridge?.navigate(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault(); e.stopPropagation();
            _bridge?.navigate(-1);
        } else if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation();
            _bridge?.confirm();
        } else if (e.key === 'Escape') {
            e.preventDefault(); e.stopPropagation();
            _bridge?.hide();
        }
    };

    private onBlur = () => {
        // 延迟执行，让下拉项的 mousedown 先于 blur 触发
        setTimeout(() => {
            if (this.isVisible) _bridge?.hide();
        }, 150);
    };

    /**
     * 由桥接侧收到补全结果后调用，展示下拉菜单。
     * App.tsx 在 pathCompletionResult 消息处理时若发现活跃的 PathCompleter，则调用此方法。
     * 若 requestId 被本实例认领则返回 true，否则返回 false。
     */
    showResult(requestId: string, items: PathCompletionItem[]): boolean {
        if (requestId !== this.pendingRequestId) return false;
        if (items.length === 0) { _bridge?.hide(); return true; }
        const rect = this.input.getBoundingClientRect();
        _bridge?.show(
            { left: rect.left, top: rect.top, bottom: rect.bottom },
            items,
            (item) => this.applyItem(item),
        );
        return true;
    }

    private applyItem(item: PathCompletionItem) {
        this.suppressInputCount++;
        this.input.value = item.label;
        // 通知其他监听者（如外层 keydown 处理）输入已更新
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
        if (item.isDir) {
            // 目录：请求子级补全（菜单保持可见，等待新结果）
            const id = `pc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            this.pendingRequestId = id;
            postMessage({ type: 'requestPathCompletion', prefix: item.label, requestId: id });
        } else {
            _bridge?.hide();
        }
    }
}
