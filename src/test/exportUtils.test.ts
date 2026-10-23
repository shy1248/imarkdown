/**
 * 导出 HTML 纯工具函数的测试套件。
 * 直接测试 src/utils/htmlExport.ts 与 src/utils/textUtils.ts 的真实实现。
 */
import * as assert from 'assert';
import { escapeHtml } from '../utils/textUtils';
import { buildFullHtml, extractInjectedStyles, getHtmlExportTitle } from '../utils/htmlExport';

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

describe('extractInjectedStyles', () => {
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
        assert.strictEqual(injectedStyles.length, 2);
        assert.strictEqual(remaining, '<p>text</p>');
    });
});

describe('buildFullHtml', () => {
    it('应生成完整 HTML 文档并转义标题', () => {
        const html = buildFullHtml('<p>body</p>', 'a<b>"c"');
        assert.ok(html.startsWith('<!DOCTYPE html>'));
        assert.ok(html.includes('<title>a&lt;b&gt;&quot;c&quot;</title>'));
        assert.ok(html.includes('<body>\n<p>body</p>\n</body>'));
    });

    it('应将开头注入的 style 移入 head', () => {
        const html = buildFullHtml('<style>.x{}</style><p>body</p>', 't');
        const headEnd = html.indexOf('</head>');
        assert.ok(html.indexOf('.x{}') > 0 && html.indexOf('.x{}') < headEnd);
    });

    it('空正文也应生成合法结构', () => {
        const html = buildFullHtml('', 't');
        assert.ok(html.includes('<body>\n\n</body>'));
    });
});

describe('getHtmlExportTitle', () => {
    it('应去除 .md 扩展名', () => {
        assert.strictEqual(getHtmlExportTitle('/docs/readme.md'), 'readme');
    });

    it('应去除 .markdown 扩展名（回归用例）', () => {
        assert.strictEqual(getHtmlExportTitle('/docs/readme.markdown'), 'readme');
    });

    it('无扩展名时应原样返回', () => {
        assert.strictEqual(getHtmlExportTitle('/docs/README'), 'README');
    });

    it('文件名含多个点时应仅去除最后一个扩展名', () => {
        assert.strictEqual(getHtmlExportTitle('a.b.md'), 'a.b');
    });
});