import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { CellSelection, TableMap, moveTableRow, moveTableColumn } from '@tiptap/pm/tables';
import { t } from '../../i18n';

const tableControlsKey = new PluginKey('tableControls');

const DRAG_HANDLE_SVG = `<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
  <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
  <circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/>
  <circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/>
</svg>`;

const ADD_BUTTON_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
  <line x1="7" y1="3" x2="7" y2="11"/><line x1="3" y1="7" x2="11" y2="7"/>
</svg>`;

// ─── 辅助函数 ───────────────────────────────────────────────

function findTablePosFromDOM(view: EditorView, tableWrapper: HTMLElement): number | null {
    const tableEl = tableWrapper.querySelector('table');
    if (!tableEl) return null;
    const firstCell = tableEl.querySelector('th, td');
    if (!firstCell) return null;
    try {
        const posInCell = view.posAtDOM(firstCell, 0);
        const $pos = view.state.doc.resolve(posInCell);
        for (let d = $pos.depth; d > 0; d--) {
            if ($pos.node(d).type.name === 'table') return $pos.before(d);
        }
    } catch { /* stale DOM */ }
    return null;
}

function getCellPos(view: EditorView, tablePos: number, row: number, col: number): number | null {
    const tableNode = view.state.doc.nodeAt(tablePos);
    if (!tableNode) return null;
    const map = TableMap.get(tableNode);
    const tableStart = tablePos + 1;
    try {
        return tableStart + map.positionAt(row, col, tableNode);
    } catch { return null; }
}

/** 确定 DOM 单元格元素所在的行/列 */
function getCellRowCol(cellEl: HTMLElement, tableEl: HTMLTableElement): { row: number; col: number } | null {
    const rows = tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr');
    for (let r = 0; r < rows.length; r++) {
        const cells = rows[r].querySelectorAll(':scope > th, :scope > td');
        for (let c = 0; c < cells.length; c++) {
            if (cells[c] === cellEl) return { row: r, col: c };
        }
    }
    return null;
}

function measureRowsCols(tableEl: HTMLTableElement) {
    const rows = tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr');
    const rowHeights: number[] = [];
    const colWidths: number[] = [];
    rows.forEach(tr => rowHeights.push(tr.getBoundingClientRect().height));
    if (rows.length > 0) {
        rows[0].querySelectorAll(':scope > th, :scope > td').forEach(c => colWidths.push(c.getBoundingClientRect().width));
    }
    return { rowHeights, colWidths, rowCount: rowHeights.length, colCount: colWidths.length };
}

function selectRow(view: EditorView, tablePos: number, rowIndex: number) {
    const tableNode = view.state.doc.nodeAt(tablePos);
    if (!tableNode) return;
    const map = TableMap.get(tableNode);
    const tableStart = tablePos + 1;
    try {
        const $first = view.state.doc.resolve(tableStart + map.positionAt(rowIndex, 0, tableNode));
        const $last = view.state.doc.resolve(tableStart + map.positionAt(rowIndex, map.width - 1, tableNode));
        view.dispatch(view.state.tr.setSelection(CellSelection.rowSelection($first, $last)));
        view.focus();
    } catch { /* ignore */ }
}

function selectCol(view: EditorView, tablePos: number, colIndex: number) {
    const tableNode = view.state.doc.nodeAt(tablePos);
    if (!tableNode) return;
    const map = TableMap.get(tableNode);
    const tableStart = tablePos + 1;
    try {
        const $first = view.state.doc.resolve(tableStart + map.positionAt(0, colIndex, tableNode));
        const $last = view.state.doc.resolve(tableStart + map.positionAt(map.height - 1, colIndex, tableNode));
        view.dispatch(view.state.tr.setSelection(CellSelection.colSelection($first, $last)));
        view.focus();
    } catch { /* ignore */ }
}

function removeControls(tableWrapper: HTMLElement) {
    const el = tableWrapper.querySelector('[data-table-controls]');
    if (el) el.remove();
}

/**
 * 仅显示（hoveredRow, hoveredCol）对应的控制手柄/按钮。
 */
function showControlsForCell(
    view: EditorView,
    editor: any,
    tableWrapper: HTMLElement,
    tablePos: number,
    hoveredRow: number,
    hoveredCol: number,
) {
    removeControls(tableWrapper);

    const tableEl = tableWrapper.querySelector('table');
    if (!tableEl) return;

    const { rowHeights, colWidths, rowCount, colCount } = measureRowsCols(tableEl);
    if (rowCount === 0 || colCount === 0) return;

    const wrapperRect = tableWrapper.getBoundingClientRect();
    const tableRect = tableEl.getBoundingClientRect();
    const tTop = tableRect.top - wrapperRect.top;
    const tLeft = tableRect.left - wrapperRect.left;

    const ctrlWrapper = document.createElement('div');
    ctrlWrapper.className = 'table-controls-wrapper';
    ctrlWrapper.contentEditable = 'false';
    ctrlWrapper.setAttribute('data-table-controls', '');

    ctrlWrapper.addEventListener('mouseover', (e) => e.stopPropagation());
    ctrlWrapper.addEventListener('mouseenter', () => {
        const event = new CustomEvent('table-controls-enter');
        tableWrapper.dispatchEvent(event);
    });
    ctrlWrapper.addEventListener('mouseleave', (e) => {
        const related = (e as MouseEvent).relatedTarget as Node | null;
        // 若移出控件但仍在 tableWrapper 内（例如回到单元格），不隐藏
        if (related && tableWrapper.contains(related)) return;
        // 否则安排延迟隐藏
        const event = new CustomEvent('table-controls-leave');
        tableWrapper.dispatchEvent(event);
    });

    // ── 行控制手柄（左边缘，与悬停行对齐；标题行不可拖拽）──
    if (hoveredRow > 0) {
    const rowYOffset = rowHeights.slice(0, hoveredRow).reduce((a, b) => a + b, 0);
    const rowH = rowHeights[hoveredRow];
    const rowHandle = document.createElement('div');
    rowHandle.className = 'table-row-handle';
    rowHandle.title = t('table.dragRow');
    rowHandle.innerHTML = DRAG_HANDLE_SVG;
    rowHandle.style.top = `${tTop + rowYOffset}px`;
    rowHandle.style.height = `${rowH}px`;
    rowHandle.style.left = `${tLeft-13}px`;

    // 通过距离阈值区分点击和拖拽
    let rowDragActive = false;
    let rowDragStartY = 0;
    const rowDragFromIndex = hoveredRow;

    rowHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        rowDragActive = false;
        rowDragStartY = e.clientY;

        // 为拖拽计算快照当前 tableRect
        const snapTableRect = tableEl.getBoundingClientRect();

        // 浮动幽灵行 + 放置指示线（懒创建，首次移动时创建）
        let ghostEl: HTMLElement | null = null;
        let indicatorEl: HTMLElement | null = null;
        let currentTargetRow = rowDragFromIndex;

        const createGhost = () => {
            // 将拖拽行克隆为浮动幽灵
            const rows = tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr');
            const sourceRow = rows[rowDragFromIndex] as HTMLElement;
            if (!sourceRow) return;

            // 创建包裹克隆行的迷你表格，以保留列宽
            ghostEl = document.createElement('div');
            ghostEl.className = 'table-drag-ghost';
            const ghostTable = document.createElement('table');
            ghostTable.style.width = `${snapTableRect.width}px`;
            ghostTable.style.borderCollapse = 'collapse';
            const clonedRow = sourceRow.cloneNode(true) as HTMLElement;
            // 按原始列宽同步克隆单元格的宽度
            const originalCells = sourceRow.querySelectorAll(':scope > th, :scope > td');
            const clonedCells = clonedRow.querySelectorAll(':scope > th, :scope > td');
            originalCells.forEach((cell, i) => {
                if (clonedCells[i]) {
                    (clonedCells[i] as HTMLElement).style.width = `${cell.getBoundingClientRect().width}px`;
                }
            });
            ghostTable.appendChild(clonedRow);
            ghostEl.appendChild(ghostTable);
            ghostEl.style.left = `${snapTableRect.left}px`;
            ghostEl.style.top = `${sourceRow.getBoundingClientRect().top}px`;
            ghostEl.style.width = `${snapTableRect.width}px`;
            document.body.appendChild(ghostEl);

            // 高亮源行
            sourceRow.classList.add('table-drag-source-row');

            // 创建放置指示线
            indicatorEl = document.createElement('div');
            indicatorEl.className = 'table-drag-indicator-h';
            indicatorEl.style.left = `${snapTableRect.left}px`;
            indicatorEl.style.width = `${snapTableRect.width}px`;
            document.body.appendChild(indicatorEl);
        };

        const updateGhost = (me: MouseEvent) => {
            if (!ghostEl || !indicatorEl) return;

            // 垂直跟随鼠标移动幽灵
            const deltaY = me.clientY - rowDragStartY;
            const sourceRow = tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')[rowDragFromIndex] as HTMLElement;
            if (sourceRow) {
                ghostEl.style.top = `${sourceRow.getBoundingClientRect().top + deltaY}px`;
            }

            // 确定鼠标最近的行间隙
            let accY = snapTableRect.top;
            let targetRow = 0;
            for (let r = 0; r < rowCount; r++) {
                const midY = accY + rowHeights[r] / 2;
                if (me.clientY > midY) {
                    targetRow = r + 1;
                }
                accY += rowHeights[r];
            }
            // 限制范围：不能拖到第 1 行之前（第 0 行标题行固定）
            currentTargetRow = Math.max(1, Math.min(targetRow, rowCount));

            // 将指示线定位在行间隙处
            let lineY = snapTableRect.top;
            for (let r = 0; r < currentTargetRow && r < rowCount; r++) {
                lineY += rowHeights[r];
            }
            indicatorEl.style.top = `${lineY - 1.5}px`;

            // 显示/隐藏指示线：若目标与源位置相同则隐藏
            const isSamePos = currentTargetRow === rowDragFromIndex || currentTargetRow === rowDragFromIndex + 1;
            indicatorEl.style.opacity = isSamePos ? '0' : '1';
        };

        const cleanupGhost = () => {
            if (ghostEl) { ghostEl.remove(); ghostEl = null; }
            if (indicatorEl) { indicatorEl.remove(); indicatorEl = null; }
            // 移除源行高亮
            const rows = tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr');
            rows.forEach(r => (r as HTMLElement).classList.remove('table-drag-source-row'));
        };

        const onMouseMove = (me: MouseEvent) => {
            if (!rowDragActive && Math.abs(me.clientY - rowDragStartY) > 4) {
                rowDragActive = true;
                rowHandle.classList.add('dragging');
                createGhost();
            }
            if (rowDragActive) {
                updateGhost(me);
            }
        };

        const onMouseUp = (me: MouseEvent) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            rowHandle.classList.remove('dragging');
            cleanupGhost();

            if (rowDragActive) {
                // 将插入间隙索引转换为 moveTableRow 的目标索引
                let targetRow = currentTargetRow;
                // 若拖拽目标在源行之后，因源行会先被移除需减 1
                if (targetRow > rowDragFromIndex) targetRow -= 1;

                if (targetRow !== rowDragFromIndex) {
                    const freshTablePos = findTablePosFromDOM(view, tableWrapper);
                    if (freshTablePos != null) {
                        const cellPos = getCellPos(view, freshTablePos, rowDragFromIndex, 0);
                        if (cellPos != null) {
                            try {
                                view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(cellPos + 1))));
                            } catch { /* ignore */ }
                        }
                        moveTableRow({ from: rowDragFromIndex, to: targetRow })(view.state, view.dispatch);
                    }
                }
                rowDragActive = false;
            } else {
                // 点击（无拖拽）→ 选中整行
                const freshTablePos = findTablePosFromDOM(view, tableWrapper);
                if (freshTablePos != null) {
                    selectRow(view, freshTablePos, hoveredRow);
                }
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    ctrlWrapper.appendChild(rowHandle);
    } // end if (hoveredRow > 0) — 标题行无行控制手柄

    // ── 列控制手柄（上边缘，与悬停列对齐）──
    const colXOffset = colWidths.slice(0, hoveredCol).reduce((a, b) => a + b, 0);
    const colW = colWidths[hoveredCol];
    const colHandle = document.createElement('div');
    colHandle.className = 'table-col-handle';
    colHandle.title = t('table.dragCol');
    colHandle.innerHTML = DRAG_HANDLE_SVG;
    colHandle.style.left = `${tLeft + colXOffset}px`;
    colHandle.style.width = `${colW}px`;
    colHandle.style.top = `${tTop-13}px`;

    let colDragActive = false;
    let colDragStartX = 0;
    const colDragFromIndex = hoveredCol;

    colHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        colDragActive = false;
        colDragStartX = e.clientX;

        // 为拖拽计算快照当前 tableRect
        const snapTableRect = tableEl.getBoundingClientRect();

        // 浮动幽灵列 + 放置指示线
        let ghostEl: HTMLElement | null = null;
        let indicatorEl: HTMLElement | null = null;
        let currentTargetCol = colDragFromIndex;

        const createGhost = () => {
            // 构建仅包含被拖拽列的幽灵表格
            const rows = tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr');
            ghostEl = document.createElement('div');
            ghostEl.className = 'table-drag-ghost';
            const ghostTable = document.createElement('table');
            ghostTable.style.borderCollapse = 'collapse';
            const colWidth = colWidths[colDragFromIndex];
            ghostTable.style.width = `${colWidth}px`;

            rows.forEach((row, rIdx) => {
                const cells = row.querySelectorAll(':scope > th, :scope > td');
                const sourceCell = cells[colDragFromIndex] as HTMLElement;
                if (!sourceCell) return;
                const ghostRow = document.createElement('tr');
                const clonedCell = sourceCell.cloneNode(true) as HTMLElement;
                clonedCell.style.width = `${colWidth}px`;
                clonedCell.style.height = `${rowHeights[rIdx]}px`;
                ghostRow.appendChild(clonedCell);
                ghostTable.appendChild(ghostRow);
            });

            ghostEl.appendChild(ghostTable);
            ghostEl.style.left = `${snapTableRect.left + colWidths.slice(0, colDragFromIndex).reduce((a, b) => a + b, 0)}px`;
            ghostEl.style.top = `${snapTableRect.top}px`;
            ghostEl.style.width = `${colWidth}px`;
            document.body.appendChild(ghostEl);

            // 高亮源列单元格
            rows.forEach(row => {
                const cells = row.querySelectorAll(':scope > th, :scope > td');
                if (cells[colDragFromIndex]) {
                    (cells[colDragFromIndex] as HTMLElement).classList.add('table-drag-source-col');
                }
            });

            // 创建垂直放置指示线
            indicatorEl = document.createElement('div');
            indicatorEl.className = 'table-drag-indicator-v';
            indicatorEl.style.top = `${snapTableRect.top}px`;
            indicatorEl.style.height = `${snapTableRect.height}px`;
            document.body.appendChild(indicatorEl);
        };

        const updateGhost = (me: MouseEvent) => {
            if (!ghostEl || !indicatorEl) return;

            // 水平移动幽灵
            const deltaX = me.clientX - colDragStartX;
            const origLeft = snapTableRect.left + colWidths.slice(0, colDragFromIndex).reduce((a, b) => a + b, 0);
            ghostEl.style.left = `${origLeft + deltaX}px`;

            // 确定目标列间隙
            let accX = snapTableRect.left;
            let targetCol = 0;
            for (let c = 0; c < colCount; c++) {
                const midX = accX + colWidths[c] / 2;
                if (me.clientX > midX) {
                    targetCol = c + 1;
                }
                accX += colWidths[c];
            }
            currentTargetCol = Math.min(targetCol, colCount);

            // 将指示线定位在列间隙处
            let lineX = snapTableRect.left;
            for (let c = 0; c < currentTargetCol && c < colCount; c++) {
                lineX += colWidths[c];
            }
            indicatorEl.style.left = `${lineX - 1.5}px`;

            // 若位置相同则隐藏
            const isSamePos = currentTargetCol === colDragFromIndex || currentTargetCol === colDragFromIndex + 1;
            indicatorEl.style.opacity = isSamePos ? '0' : '1';
        };

        const cleanupGhost = () => {
            if (ghostEl) { ghostEl.remove(); ghostEl = null; }
            if (indicatorEl) { indicatorEl.remove(); indicatorEl = null; }
            // 移除源列高亮
            const rows = tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr');
            rows.forEach(row => {
                row.querySelectorAll(':scope > th, :scope > td').forEach(c =>
                    (c as HTMLElement).classList.remove('table-drag-source-col')
                );
            });
        };

        const onMouseMove = (me: MouseEvent) => {
            if (!colDragActive && Math.abs(me.clientX - colDragStartX) > 4) {
                colDragActive = true;
                colHandle.classList.add('dragging');
                createGhost();
            }
            if (colDragActive) {
                updateGhost(me);
            }
        };

        const onMouseUp = (me: MouseEvent) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            colHandle.classList.remove('dragging');
            cleanupGhost();

            if (colDragActive) {
                let targetCol = currentTargetCol;
                if (targetCol > colDragFromIndex) targetCol -= 1;

                if (targetCol !== colDragFromIndex) {
                    const freshTablePos = findTablePosFromDOM(view, tableWrapper);
                    if (freshTablePos != null) {
                        const cellPos = getCellPos(view, freshTablePos, 0, colDragFromIndex);
                        if (cellPos != null) {
                            try {
                                view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(cellPos + 1))));
                            } catch { /* ignore */ }
                        }
                        moveTableColumn({ from: colDragFromIndex, to: targetCol })(view.state, view.dispatch);
                    }
                }
                colDragActive = false;
            } else {
                // 点击（无拖拽）→ 选中整列
                const freshTablePos = findTablePosFromDOM(view, tableWrapper);
                if (freshTablePos != null) {
                    selectCol(view, freshTablePos, hoveredCol);
                }
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    ctrlWrapper.appendChild(colHandle);

    // ── 添加行按钮（仅悬停在末行时）──
    if (hoveredRow === rowCount - 1) {
        const totalH = rowHeights.reduce((a, b) => a + b, 0);
        const totalW = colWidths.reduce((a, b) => a + b, 0);
        const addRowBtn = document.createElement('div');
        addRowBtn.className = 'table-add-row-btn';
        addRowBtn.title = t('table.addRow');
        addRowBtn.innerHTML = ADD_BUTTON_SVG;
        addRowBtn.style.top = `${tTop + totalH}px`;
        addRowBtn.style.left = `${tLeft}px`;
        addRowBtn.style.width = `${totalW}px`;
        addRowBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const cellPos = getCellPos(view, tablePos, rowCount - 1, 0);
            if (cellPos != null) {
                try {
                    view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(cellPos + 1))));
                    view.focus();
                } catch { /* ignore */ }
            }
            setTimeout(() => { editor.chain().focus().addRowAfter().run(); }, 0);
        });
        ctrlWrapper.appendChild(addRowBtn);
    }

    // ── 添加列按钮（仅悬停在末列时）──
    if (hoveredCol === colCount - 1) {
        const totalH = rowHeights.reduce((a, b) => a + b, 0);
        const totalW = colWidths.reduce((a, b) => a + b, 0);
        const addColBtn = document.createElement('div');
        addColBtn.className = 'table-add-col-btn';
        addColBtn.title = t('table.addCol');
        addColBtn.innerHTML = ADD_BUTTON_SVG;
        addColBtn.style.top = `${tTop}px`;
        addColBtn.style.left = `${tLeft + totalW}px`;
        addColBtn.style.height = `${totalH}px`;
        addColBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const cellPos = getCellPos(view, tablePos, 0, colCount - 1);
            if (cellPos != null) {
                try {
                    view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(cellPos + 1))));
                    view.focus();
                } catch { /* ignore */ }
            }
            setTimeout(() => { editor.chain().focus().addColumnAfter().run(); }, 0);
        });
        ctrlWrapper.appendChild(addColBtn);
    }

    tableWrapper.appendChild(ctrlWrapper);
}

// ─── 扩展 ─────────────────────────────────────────────

// 使用 WeakMap 缓存每个 tableWrapper 当前悬停的行/列，避免重复重建
const hoveredCellCache = new WeakMap<HTMLElement, { row: number; col: number }>();

export const TableControls = Extension.create({
    name: 'tableControls',

    addProseMirrorPlugins() {
        const editor = this.editor;
        const attachedWrappers = new WeakSet<HTMLElement>();
        // 记录当前显示控件的 tableWrapper
        let activeWrapper: HTMLElement | null = null;
        let hideTimer: ReturnType<typeof setTimeout> | null = null;

        const scheduleHide = (tableWrapper: HTMLElement) => {
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
                // 仅当该 wrapper 仍是活跃的且鼠标未重新进入时才隐藏
                if (activeWrapper === tableWrapper) {
                    hoveredCellCache.delete(tableWrapper);
                    removeControls(tableWrapper);
                    activeWrapper = null;
                }
                hideTimer = null;
            }, 150); // 短暂延迟，以便鼠标能够移到控制手柄上
        };

        const cancelHide = () => {
            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
        };

        const attachListeners = (tableWrapper: HTMLElement, view: EditorView) => {
            if (attachedWrappers.has(tableWrapper)) return;
            attachedWrappers.add(tableWrapper);

            // 监听 DOM 变动（例如 TipTap 调整列宽时会修改 inline styles/colgroup，
            // 但不会触发 ProseMirror 状态更新）。
            // 列宽变化时刷新控件，确保添加行/列按钮位置正确。
            const resizeObserver = new MutationObserver(() => {
                if (activeWrapper !== tableWrapper) return;
                const cached = hoveredCellCache.get(tableWrapper);
                if (!cached) return;
                const tablePos = findTablePosFromDOM(view, tableWrapper);
                if (tablePos == null) return;
                showControlsForCell(view, editor, tableWrapper, tablePos, cached.row, cached.col);
            });
            const tableEl = tableWrapper.querySelector('table');
            if (tableEl) {
                resizeObserver.observe(tableEl, {
                    attributes: true,
                    attributeFilter: ['style', 'width'],
                    subtree: true,
                    childList: true,
                });
            }

            // 通过 td/th 的 mouseover 事件追踪悬停单元格
            tableWrapper.addEventListener('mouseover', (e) => {
                const target = e.target as HTMLElement;

                // 若鼠标悬停在控件本身（手柄/按钮）上，保持控件显示
                if (target.closest('[data-table-controls]')) {
                    cancelHide();
                    return;
                }

                const cellEl = target.closest('td, th') as HTMLElement | null;
                if (!cellEl) return;

                cancelHide();

                const tableEl = tableWrapper.querySelector('table') as HTMLTableElement | null;
                if (!tableEl) return;

                const rc = getCellRowCol(cellEl, tableEl);
                if (!rc) return;

                // 若已在该单元格显示控件则跳过
                const cached = hoveredCellCache.get(tableWrapper);
                if (cached && cached.row === rc.row && cached.col === rc.col) return;

                const tablePos = findTablePosFromDOM(view, tableWrapper);
                if (tablePos == null) return;

                activeWrapper = tableWrapper;
                hoveredCellCache.set(tableWrapper, { row: rc.row, col: rc.col });
                showControlsForCell(view, editor, tableWrapper, tablePos, rc.row, rc.col);
            });

            tableWrapper.addEventListener('mouseleave', () => {
                // 不立即隐藏，留出短暂延迟让鼠标能移动到
                // 位于表格元素之外但仍在 tableWrapper 边距区域内的手柄上
                scheduleHide(tableWrapper);
            });

            // 由控件容器触发的自定义事件
            tableWrapper.addEventListener('table-controls-enter', () => {
                cancelHide();
            });
            tableWrapper.addEventListener('table-controls-leave', () => {
                scheduleHide(tableWrapper);
            });
        };

        return [
            new Plugin({
                key: tableControlsKey,
                props: {
                    handleDOMEvents: {
                        mousedown(_: EditorView, event: MouseEvent) {
                            const target = event.target as HTMLElement;
                            if (target.closest('[data-table-controls]')) {
                                return true;
                            }
                            return false;
                        },
                    },
                    handleKeyDown(view: EditorView, event: KeyboardEvent) {
                        if (event.key !== 'Backspace' && event.key !== 'Delete') return false;

                        const { state } = view;
                        const sel = state.selection;

                        // ── Backspace/Delete 跨单元格导航 ──
                        // 当光标位于单元格最开头（Backspace）或最末尾（Delete）时，
                        // 将光标移动到相邻单元格。
                        if (!(sel instanceof CellSelection) && sel.empty) {
                            const $pos = sel.$from;
                            // 找到包含光标的单元格
                            let cellNode = null;
                            let cellDepth = 0;
                            for (let d = $pos.depth; d > 0; d--) {
                                const n = $pos.node(d);
                                if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
                                    cellNode = n;
                                    cellDepth = d;
                                    break;
                                }
                            }
                            if (cellNode) {
                                // 检查光标是否位于单元格文本内容的最开头或最末尾。
                                // 单元格结构：tableCell > paragraph > ...text...
                                // $pos.start(cellDepth) 位于 paragraph 节点之前，
                                // 因此实际第一个文本位置 = cellStart + 1（段落内部）。
                                const cellStart = $pos.start(cellDepth);  // 单元格开始标签之后的位置
                                const cellEnd = $pos.end(cellDepth);      // 单元格关闭标签之前的位置
                                const cursorPos = $pos.pos;
                                // 单元格内第一个光标位置为 cellStart + 1（段落内部）
                                // 单元格内最后一个光标位置为 cellEnd - 1（段落末尾）
                                const isAtStart = cursorPos <= cellStart + 1;
                                const isAtEnd = cursorPos >= cellEnd - 1;

                                // 仅当单元格为空（无文本内容）时触发
                                const cellText = cellNode.textContent;
                                const isCellEmpty = cellText.length === 0;

                                if (isCellEmpty && (
                                    (event.key === 'Backspace' && isAtStart) ||
                                    (event.key === 'Delete' && isAtEnd)
                                )) {
                                    // 找到所属表格节点
                                    let tableNode = null;
                                    let tablePos = 0;
                                    for (let d = cellDepth - 1; d > 0; d--) {
                                        const n = $pos.node(d);
                                        if (n.type.name === 'table') {
                                            tableNode = n;
                                            tablePos = $pos.before(d);
                                            break;
                                        }
                                    }
                                    if (tableNode) {
                                        const map = TableMap.get(tableNode);
                                        const tableStart = tablePos + 1;
                                        const cellPosAbs = $pos.before(cellDepth);
                                        const cellOffset = cellPosAbs - tableStart;
                                        // 找到该单元格所在的行/列
                                        let row = -1, col = -1;
                                        for (let r = 0; r < map.height; r++) {
                                            for (let c = 0; c < map.width; c++) {
                                                if (map.map[r * map.width + c] === cellOffset) {
                                                    row = r;
                                                    col = c;
                                                    break;
                                                }
                                            }
                                            if (row >= 0) break;
                                        }

                                        if (row >= 0 && col >= 0) {
                                            if (event.key === 'Backspace') {
                                                // 移到上一个单元格（向左，或上一行最后一列）
                                                let prevRow = row;
                                                let prevCol = col - 1;
                                                if (prevCol < 0) {
                                                    prevRow = row - 1;
                                                    prevCol = map.width - 1;
                                                }
                                                if (prevRow >= 0) {
                                                    const prevCellPos = tableStart + map.map[prevRow * map.width + prevCol];
                                                    const prevCell = state.doc.nodeAt(prevCellPos);
                                                    if (prevCell) {
                                                        // 将光标置于上一个单元格内容末尾
                                                        const $prevCellStart = state.doc.resolve(prevCellPos + 1);
                                                        const endOfPrevCell = $prevCellStart.end();
                                                        const tr = state.tr.setSelection(
                                                            Selection.near(state.doc.resolve(endOfPrevCell), -1)
                                                        );
                                                        view.dispatch(tr.scrollIntoView());
                                                        return true;
                                                    }
                                                }
                                            } else {
                                                // Delete：移到下一个单元格（向右，或下一行第一列）
                                                let nextRow = row;
                                                let nextCol = col + 1;
                                                if (nextCol >= map.width) {
                                                    nextRow = row + 1;
                                                    nextCol = 0;
                                                }
                                                if (nextRow < map.height) {
                                                    const nextCellPos = tableStart + map.map[nextRow * map.width + nextCol];
                                                    const nextCell = state.doc.nodeAt(nextCellPos);
                                                    if (nextCell) {
                                                        // 将光标置于下一个单元格内容起始处
                                                        const $nextCellStart = state.doc.resolve(nextCellPos + 1);
                                                        const startOfNextCell = $nextCellStart.start();
                                                        const tr = state.tr.setSelection(
                                                            Selection.near(state.doc.resolve(startOfNextCell), 1)
                                                        );
                                                        view.dispatch(tr.scrollIntoView());
                                                        return true;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // ── CellSelection：删除选中的行/列 ──
                        if (!(sel instanceof CellSelection)) return false;

                        // 找到所属表格节点
                        const $anchor = sel.$anchorCell;
                        let tableNode = null;
                        let tablePos = 0;
                        for (let d = $anchor.depth; d > 0; d--) {
                            if ($anchor.node(d).type.name === 'table') {
                                tableNode = $anchor.node(d);
                                tablePos = $anchor.before(d);
                                break;
                            }
                        }
                        if (!tableNode) return false;

                        const map = TableMap.get(tableNode);

                        // 收集所有选中单元格的位置
                        const selectedCells = new Set<number>();
                        sel.forEachCell((_node, pos) => {
                            selectedCells.add(pos);
                        });

                        // 检查所有选中单元格是否均为空
                        let allEmpty = true;
                        sel.forEachCell((node) => {
                            if (node.textContent.trim().length > 0) {
                                allEmpty = false;
                            }
                        });
                        if (!allEmpty) return false;

                        const tableStart = tablePos + 1;

                        // 判断是否为整行选中：
                        // 即凡是包含选中单元格的行，该行所有列均被选中。
                        const selectedRows = new Set<number>();
                        const selectedCols = new Set<number>();
                        for (let r = 0; r < map.height; r++) {
                            for (let c = 0; c < map.width; c++) {
                                const cellPos = tableStart + map.map[r * map.width + c];
                                if (selectedCells.has(cellPos)) {
                                    selectedRows.add(r);
                                    selectedCols.add(c);
                                }
                            }
                        }

                        // 检查是否为整行选中（每个选中行的所有列均被选中）
                        let isFullRowSelection = selectedRows.size > 0;
                        for (const r of selectedRows) {
                            for (let c = 0; c < map.width; c++) {
                                const cellPos = tableStart + map.map[r * map.width + c];
                                if (!selectedCells.has(cellPos)) {
                                    isFullRowSelection = false;
                                    break;
                                }
                            }
                            if (!isFullRowSelection) break;
                        }

                        // 检查是否为整列选中（每个选中列的所有行均被选中）
                        let isFullColSelection = selectedCols.size > 0;
                        for (const c of selectedCols) {
                            for (let r = 0; r < map.height; r++) {
                                const cellPos = tableStart + map.map[r * map.width + c];
                                if (!selectedCells.has(cellPos)) {
                                    isFullColSelection = false;
                                    break;
                                }
                            }
                            if (!isFullColSelection) break;
                        }

                        // 若选中了所有行或所有列，则删除整张表格
                        if (isFullRowSelection && selectedRows.size === map.height) {
                            editor.chain().focus().deleteTable().run();
                            return true;
                        }
                        if (isFullColSelection && selectedCols.size === map.width) {
                            editor.chain().focus().deleteTable().run();
                            return true;
                        }

                        // 从下往上删除选中行（保持索引正确）
                        if (isFullRowSelection) {
                            const rowsSorted = Array.from(selectedRows).sort((a, b) => b - a);
                            // 将光标移到第一个选中行，以便 deleteRow 命令正确执行
                            const firstRow = Math.min(...selectedRows);
                            const cellPos = getCellPos(view, tablePos, firstRow, 0);
                            if (cellPos != null) {
                                try {
                                    view.dispatch(view.state.tr.setSelection(
                                        Selection.near(view.state.doc.resolve(cellPos + 1))
                                    ));
                                } catch { /* ignore */ }
                            }
                            for (let i = 0; i < rowsSorted.length; i++) {
                                editor.chain().focus().deleteRow().run();
                            }
                            return true;
                        }

                        // 从右往左删除选中列（保持索引正确）
                        if (isFullColSelection) {
                            const colsSorted = Array.from(selectedCols).sort((a, b) => b - a);
                            // 将光标移到第一个选中列，以便 deleteColumn 命令正确执行
                            const firstCol = Math.min(...selectedCols);
                            const cellPos = getCellPos(view, tablePos, 0, firstCol);
                            if (cellPos != null) {
                                try {
                                    view.dispatch(view.state.tr.setSelection(
                                        Selection.near(view.state.doc.resolve(cellPos + 1))
                                    ));
                                } catch { /* ignore */ }
                            }
                            for (let i = 0; i < colsSorted.length; i++) {
                                editor.chain().focus().deleteColumn().run();
                            }
                            return true;
                        }

                        return false;
                    },
                    // 检测在表头单元格起始处输入的 <<<（左对齐）、>>>（右对齐）和 <|>（居中对齐）。
                    // 对整列（表头 + 所有主体单元格）设置对齐方式。
                    handleTextInput(view: EditorView, from: number, _to: number, text: string) {
                        if (text !== '<' && text !== '>') return false;

                        const { state } = view;
                        const $from = state.doc.resolve(from);

                        // 必须位于 tableHeader 单元格内
                        let cellNode = null;
                        let cellPos = 0;
                        let cellDepth = 0;
                        for (let d = $from.depth; d > 0; d--) {
                            const node = $from.node(d);
                            if (node.type.name === 'tableHeader') {
                                cellNode = node;
                                cellPos = $from.before(d);
                                cellDepth = d;
                                break;
                            }
                        }
                        if (!cellNode) return false;

                        const cellStart = $from.start(cellDepth);
                        const textBefore = state.doc.textBetween(cellStart, from, '');

                        let alignment: string | null = null;
                        let prefixLen = 0;
                        if (text === '<' && textBefore === '<<') {
                            alignment = 'left';
                            prefixLen = 2; // 删除 "<<"
                        } else if (text === '>' && textBefore === '>>') {
                            alignment = 'right';
                            prefixLen = 2; // 删除 ">>"
                        } else if (text === '>' && textBefore === '<|') {
                            alignment = 'center';
                            prefixLen = 2; // 删除 "<|"
                        }
                        if (!alignment) return false;

                        // 找到所属表格节点及列索引
                        let tableNode = null;
                        let tablePos = 0;
                        for (let d = $from.depth; d > 0; d--) {
                            const node = $from.node(d);
                            if (node.type.name === 'table') {
                                tableNode = node;
                                tablePos = $from.before(d);
                                break;
                            }
                        }
                        if (!tableNode) return false;

                        const map = TableMap.get(tableNode);
                        const tableStart = tablePos + 1;
                        // 找出该表头单元格所在的列
                        const cellOffset = cellPos - tableStart;
                        let colIndex = -1;
                        for (let c = 0; c < map.width; c++) {
                            if (map.map[c] === cellOffset) { // 第 0 行，第 c 列
                                colIndex = c;
                                break;
                            }
                        }
                        if (colIndex < 0) return false;

                        // 构建单个事务：
                        // 1. 为该列所有单元格设置 textAlign
                        // 2. 删除 "<<" 或 ">>" 前缀
                        const tr = state.tr;

                        // 从下往上为该列每个单元格设置对齐方式（保持位置正确）
                        for (let r = map.height - 1; r >= 0; r--) {
                            const pos = tableStart + map.map[r * map.width + colIndex];
                            const node = state.doc.nodeAt(pos);
                            if (node && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) {
                                tr.setNodeMarkup(pos, undefined, {
                                    ...node.attrs,
                                    textAlign: alignment,
                                });
                            }
                        }

                        // 使用映射后的位置删除前缀（"<<"、">>" 或 "<|"）
                        const deleteFrom = from - prefixLen;
                        tr.delete(tr.mapping.map(deleteFrom), tr.mapping.map(from));

                        view.dispatch(tr);
                        return true;
                    },
                },
                view() {
                    return {
                        update(view: EditorView) {
                            view.dom.querySelectorAll('.tableWrapper').forEach((el) => {
                                if (el instanceof HTMLElement) {
                                    attachListeners(el, view);
                                }
                            });

                            // 任何状态更新后（如删行/删列、拖拽重排），刷新可见控件以防止错位。
                            // 若某 wrapper 当前有控件，以缓存的单元格位置重新渲染，
                            // 若缓存单元格已越界则移除控件。
                            if (activeWrapper) {
                                const wrapper = activeWrapper;
                                const cached = hoveredCellCache.get(wrapper);
                                const tableEl = wrapper.querySelector('table') as HTMLTableElement | null;

                                if (cached && tableEl) {
                                    const { rowCount, colCount } = measureRowsCols(tableEl);
                                    const tablePos = findTablePosFromDOM(view, wrapper);

                                    if (tablePos != null && cached.row < rowCount && cached.col < colCount) {
                                        // 以（可能已偏移的）缓存位置重新渲染控件
                                        showControlsForCell(view, editor, wrapper, tablePos, cached.row, cached.col);
                                    } else {
                                        // 缓存的单元格已越界，清理控件
                                        hoveredCellCache.delete(wrapper);
                                        removeControls(wrapper);
                                        activeWrapper = null;
                                    }
                                } else {
                                        // 无缓存或表格已不存在，清理控件
                                    removeControls(wrapper);
                                    activeWrapper = null;
                                }
                            }
                        },
                        destroy() {
                            if (hideTimer) clearTimeout(hideTimer);
                            editor.view.dom.querySelectorAll('[data-table-controls]').forEach(el => el.remove());
                        },
                    };
                },
            }),
        ];
    },
});
