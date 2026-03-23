/**
 * 对 prosemirror-markdown 的 MarkdownSerializerState 施加两处 monkey-patch，
 * 修复在所见即所得编辑器场景下的序列化问题。
 * 此文件必须在任何 tiptap/ProseMirror 扩展注册之前导入（副作用导入）。
 */
import { MarkdownSerializerState as PmMarkdownSerializerState } from 'prosemirror-markdown';

// ---------------------------------------------------------------------------
// Patch 1: esc()
//
// 停止转义 `*` 和 `~` 字符。默认情况下 prosemirror-markdown 会将这些字符
// 转义，导致如 `**hello**` 被写为 `\*\*hello\*\*`。
// 在所见即所得编辑器中，用户从不输入原始 Markdown——粗体/斜体/删除线
// 由 ProseMirror 标记表示，由 tiptap-markdown 以正确的分隔符序列化。
// 文档中字面量的 `*` 或 `~` 都是用户有意输入的纯文本，而非 Markdown 结构，
// 对其转义是错误的，会导致重新渲染异常。因此从正则中移除 `*` 和 `~`。
// 需要字面转义星号的用户可手动输入 `\*`。
// ---------------------------------------------------------------------------
(PmMarkdownSerializerState.prototype as any)._patchedEsc = true;
PmMarkdownSerializerState.prototype.esc = function (str: string, startOfLine = false): string {
    // 从转义字符集中移除 `*` 和 `~`，保留其余字符
    // （`\`、`` ` ``、`[`、`]`、`_`，与 prosemirror-markdown 原始实现一致）
    str = str.replace(/[`\\\[\]_]/g, (m: string, i: number) =>
        m === '_' && i > 0 && i + 1 < str.length && /\w/.test(str[i - 1]) && /\w/.test(str[i + 1])
            ? m
            : '\\' + m
    );
    if (startOfLine)
        str = str
            .replace(/^(\+[ ]|[-*>])/, '\\$&')
            .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
            .replace(/^(\s*\d+)\.\s/, '$1\\. ');
    if ((this as any).options?.escapeExtraCharacters)
        str = str.replace((this as any).options.escapeExtraCharacters, '\\$&');
    return str;
};

// ---------------------------------------------------------------------------
// Patch 2: text()
//
// 修复 tiptap-markdown 在包装块（blockquote、嵌套列表等）内的 trimInline
// 偏移错误。
//
// 根因：tiptap-markdown 的 MarkdownSerializerState 子类重写了 markString()，
// 在 flushClose()+delim 写入 this.out 之前，就将 this.out.length 记录为
// 标记打开位置。随后 trimInline/scanDelims 基于错误偏移运行（落到块前缀如
// `> ` 上），错误地位移分隔符字符，生成如 `> ****粗体1**` 而非 `> **粗体1**`
// 的损坏输出。
//
// 修复：当 text() 以 escape=false 调用（即写入标记分隔符）且 tiptap-markdown
// 的 this.inlines 数组中有待定打开条目（已记录 start、尚未记录 end）时，
// 先刷新并写入块前缀，再将记录的 start 更新为正确位置。
// ---------------------------------------------------------------------------
const _origText = PmMarkdownSerializerState.prototype.text;
PmMarkdownSerializerState.prototype.text = function (text: string, escape?: boolean): void {
    if (escape === false && Array.isArray((this as any).inlines)) {
        const inlines: Array<{ start: number; end?: number; delimiter: string }> = (this as any).inlines;
        const top = inlines[inlines.length - 1];
        if (top && top.start !== undefined && top.end === undefined) {
            // 刷新待定的 close + 写入块级前缀（如 "> "）
            (this as any).flushClose();
            if ((this as any).delim && (this as any).atBlank()) {
                (this as any).out += (this as any).delim;
            }
            // 将记录的 start 更新为真实位置（在 delim 之后）
            top.start = ((this as any).out as string).length;
            // 直接写入标记分隔符（已完成刷新）
            if (text) {
                (this as any).out += text;
            }
            return;
        }
    }
    _origText.call(this, text, escape);
};
