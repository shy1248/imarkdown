/**
 * 拖拽时自动滚动支持。
 *
 * 已验证的关键约束：
 *   - VSCode webview 真正的滚动容器是 #root（overflow 由 VSCode 隐式设置）。
 *     body 和 documentElement 的 scrollHeight === clientHeight，不可滚动。
 *   - dragover（capture 阶段）能可靠获取拖拽时的鼠标坐标，每帧触发。
 *   - toolbar 是 fixed，顶部触发区必须从 toolbar 底部开始算。
 *
 * 触发区域：顶部 = toolbar底部 + SCROLL_ZONE，底部 = 视口底部 - SCROLL_ZONE。
 * 速度曲线：二次方加速，越靠近边缘速度越快。
 */

// 触发区 = 视口高度的 20%
const ZONE_RATIO = 0.20;
function getScrollZone(): number {
    return Math.round(window.innerHeight * ZONE_RATIO);
}
const MAX_SPEED = 28;   // 贴近边缘时的最大速度（px/帧）
const MIN_SPEED = 6;    // 刚进入触发区时的最小速度（立即有明显感觉）
const EASE = 0.2;

let _rafId = 0;
let _lastY = -1;
let _currentSpeed = 0;

function getToolbarHeight(): number {
    const t = document.getElementById('toolbar-wrapper');
    return t ? t.offsetHeight : 0;
}

function computeSpeed(distance: number, zone: number): number {
    const ratio = Math.max(0, Math.min(1, distance / zone));
    const t = 1 - ratio;
    return Math.round(MIN_SPEED + (MAX_SPEED - MIN_SPEED) * t * t);
}

/** 执行滚动：真正的滚动容器是 #root（不是 body 或 documentElement） */
function doScroll(delta: number) {
    const root = document.getElementById('root');
    if (root) {
        root.scrollTop += delta;
    }
}


function scrollStep() {
    if (_lastY >= 0) {
        const vh = window.innerHeight;
        const toolbarH = getToolbarHeight();
        const scrollZone = getScrollZone();
        const topTrigger = toolbarH + scrollZone;   // 低于此值 → 向上滚
        const bottomTrigger = vh - scrollZone;       // 高于此值 → 向下滚

        let targetSpeed = 0;
        if (_lastY < topTrigger) {
            const dist = Math.max(0, _lastY - toolbarH);
            targetSpeed = -computeSpeed(dist, scrollZone);
        } else if (_lastY > bottomTrigger) {
            const dist = Math.max(0, vh - _lastY);
            targetSpeed = computeSpeed(dist, scrollZone);
        }

        // 进入触发区立即响应（至少 MIN_SPEED），只有减速/停止时才用 EASE 缓出
        if (targetSpeed !== 0) {
            // 同向：取目标与当前绝对值的较大值（只加速不减速），立即有感觉
            if (Math.sign(targetSpeed) === Math.sign(_currentSpeed)) {
                _currentSpeed = Math.sign(targetSpeed) * Math.max(Math.abs(targetSpeed), Math.abs(_currentSpeed));
            } else {
                // 反向：直接切换方向
                _currentSpeed = targetSpeed;
            }
        } else {
            // 离开触发区：EASE 缓出
            _currentSpeed += (0 - _currentSpeed) * EASE;
        }
        if (Math.abs(_currentSpeed) < 0.5) _currentSpeed = 0;
        if (_currentSpeed !== 0) doScroll(_currentSpeed);

    } else {
        if (Math.abs(_currentSpeed) >= 0.5) {
            _currentSpeed *= (1 - EASE);
            doScroll(_currentSpeed);
        } else {
            _currentSpeed = 0;
        }
    }
    _rafId = requestAnimationFrame(scrollStep);
}

// ---------- 事件处理 ----------

function handleDragOver(e: DragEvent) {
    e.preventDefault();
    _lastY = e.clientY;
    if (!document.body.hasAttribute('data-dragging')) {
        document.body.setAttribute('data-dragging', '1');
        // 拖拽过程中禁用工具栏的 pointer-events，防止拖拽光标与工具栏交互
        const tb = document.getElementById('toolbar-wrapper');
        if (tb) tb.style.pointerEvents = 'none';
    }
}

function handleDragStop() {
    _lastY = -1;
    document.body.removeAttribute('data-dragging');
    // 恢复工具栏的 pointer-events
    const tb = document.getElementById('toolbar-wrapper');
    if (tb) tb.style.pointerEvents = '';
    document.body
        .querySelectorAll(':scope > div[style*="-10000px"]')
        .forEach((el) => el.remove());
}

// ---------- 导出 ----------

/**
 * 初始化拖拽自动滚动，返回清理函数。
 * rAF 循环始终运行，仅 _lastY >= 0（拖拽中）时才滚动，开销极小。
 */
export function initDragAutoScroll(): () => void {
    _rafId = requestAnimationFrame(scrollStep);
    document.addEventListener('dragover', handleDragOver, true);
    document.addEventListener('dragend', handleDragStop, true);
    document.addEventListener('drop', handleDragStop, true);
    return () => {
        if (_rafId) {
            cancelAnimationFrame(_rafId);
            _rafId = 0;
        }
        _lastY = -1;
        _currentSpeed = 0;
        document.removeEventListener('dragover', handleDragOver, true);
        document.removeEventListener('dragend', handleDragStop, true);
        document.removeEventListener('drop', handleDragStop, true);
    };
}
