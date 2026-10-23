// VS Code webview API wrapper

interface VsCodeApi {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

/** 非 webview 环境（如单元测试）使用的空实现。 */
function createFallbackApi(): VsCodeApi {
  let state: any;
  return {
    postMessage: () => { /* no-op */ },
    getState: () => state,
    setState: (next: any) => { state = next; },
  };
}

function acquireApi(): VsCodeApi {
  try {
    const acquire = (window as any).acquireVsCodeApi;
    return typeof acquire === 'function' ? acquire.call(window) : createFallbackApi();
  } catch {
    // acquireVsCodeApi 只能调用一次；HMR 重新执行模块时回退到空实现
    return createFallbackApi();
  }
}

const vscodeApi = acquireApi();
// Expose the API on window so the inline capture-phase script in webviewHtml.ts
// can call postMessage before the module bundle is loaded.
(window as any).__imarkdownVsCodeApi = vscodeApi;
export type MessageHandler = (message: any) => void;
const messageHandlers = new Map<string, MessageHandler[]>();

// Buffer messages that arrive before handlers are registered
const earlyMessages: any[] = [];
let handlersReady = false;

// Set up global message listener
window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  const handlers = messageHandlers.get(message.type);
  if (handlers && handlers.length > 0) {
    handlers.forEach((handler) => handler(message));
  } else if (!handlersReady) {
    // Buffer messages that arrive before any handler is registered
    earlyMessages.push(message);
  }
});

export function postMessage(message: any): void {
  vscodeApi.postMessage(message);
}

export function onMessage(type: string, handler: MessageHandler): () => void {
  if (!messageHandlers.has(type)) {
    messageHandlers.set(type, []);
  }
  messageHandlers.get(type)!.push(handler);
  // Flush any early buffered messages for this type
  if (earlyMessages.length > 0) {
    const remaining: any[] = [];
    for (const msg of earlyMessages) {
      if (msg.type === type) {
        handler(msg);
      } else {
        remaining.push(msg);
      }
    }
    earlyMessages.length = 0;
    earlyMessages.push(...remaining);
  }
  // Return cleanup function
  return () => {
    const handlers = messageHandlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    }
  };
}

// Mark that all handlers have been registered.
// After this, no more buffering will occur.
export function markHandlersReady(): void {
  handlersReady = true;
  earlyMessages.length = 0;
}

export function getState(): any {
  return vscodeApi.getState();
}

export function setState(state: any): void {
  vscodeApi.setState(state);
}
