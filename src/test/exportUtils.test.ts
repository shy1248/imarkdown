/**
 * exportUtils 纯辅助函数的测试套件。
 * 此处重新实现不依赖 VS Code API 的纯函数。
 */
import * as assert from 'assert';

// ── 来自 exportUtils.ts 的 escapeHtml 重新实现 ─────────────────────────────

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

describe('escapeHtml', () => {
    it('应转义 & 符号', () => {
        assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
    });

    it('应转义小于号', () => {
        assert.strictEqual(escapeHtml('<div>'), '&lt;div&gt;');
    });

    it('应转义双引号', () => {
        assert.strictEqual(escapeHtml('"hello"'), '&quot;hello&quot;');
    });

    it('应同时转义所有特殊字符', () => {
        assert.strictEqual(
            escapeHtml('<a href="url">text & more</a>'),
            '&lt;a href=&quot;url&quot;&gt;text &amp; more&lt;/a&gt;',
        );
    });

    it('应处理空字符串', () => {
        assert.strictEqual(escapeHtml(''), '');
    });

    it('应保持普通文本不变', () => {
        assert.strictEqual(escapeHtml('hello world'), 'hello world');
    });
});

// ── 来自 buildFullHtml 的样式提取逻辑重新实现 ──────────────────────────────

function extractInjectedStyles(bodyHtml: string): { injectedStyles: string[]; remaining: string } {
    let remaining = bodyHtml;
    const injectedStyles: string[] = [];
    const styleTagRe = /^(\s*<style[^>]*>[\s\S]*?<\/style>)/i;
    let m: RegExpExecArray | null;
    while ((m = styleTagRe.exec(remaining)) !== null) {
        injectedStyles.push(m[1]);
        remaining = remaining.slice(m[0].length);
    }
    return { injectedStyles, remaining };
}

describe('extractInjectedStyles（buildFullHtml 辅助函数）', () => {
    it('应提取开头的 <style> 标签', () => {
        const html = '<style>.a{color:red}</style><style>.b{}</style><p>body</p>';
        const { injectedStyles, remaining } = extractInjectedStyles(html);
        assert.strictEqual(injectedStyles.length, 2);
        assert.ok(injectedStyles[0].includes('.a{color:red}'));
        assert.ok(injectedStyles[1].includes('.b{}'));
        assert.strictEqual(remaining, '<p>body</p>');
    });

    it('若无开头 style 标签应原样返回正文', () => {
        const html = '<p>hello</p>';
        const { injectedStyles, remaining } = extractInjectedStyles(html);
        assert.strictEqual(injectedStyles.length, 0);
        assert.strictEqual(remaining, '<p>hello</p>');
    });

    it('仅提取开头的 style 标签，不提取嵌入的', () => {
        const html = '<style>.a{}</style><p>text</p><style>.b{}</style>';
        const { injectedStyles, remaining } = extractInjectedStyles(html);
        assert.strictEqual(injectedStyles.length, 1);
        assert.ok(remaining.includes('<style>.b{}</style>'));
    });

    it('应处理空字符串', () => {
        const { injectedStyles, remaining } = extractInjectedStyles('');
        assert.strictEqual(injectedStyles.length, 0);
        assert.strictEqual(remaining, '');
    });

    it('应处理 style 标签之间的空白字符', () => {
        const html = '<style>.a{}</style>\n<style>.b{}</style><p>text</p>';
        const { injectedStyles, remaining } = extractInjectedStyles(html);
        // 第二个 style 标签有前导空白，与正则中的 \s* 匹配
        assert.strictEqual(injectedStyles.length, 2);
        assert.strictEqual(remaining, '<p>text</p>');
    });
});
