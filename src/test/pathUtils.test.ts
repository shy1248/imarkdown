/**
 * 路径/URL 判断工具的测试（src/utils/pathUtils.ts）。
 */
import * as assert from 'assert';
import { hasUrlScheme, isWindowsDrivePath } from '../utils/pathUtils';

describe('isWindowsDrivePath', () => {
    it('应识别盘符路径（反斜杠与正斜杠）', () => {
        assert.strictEqual(isWindowsDrivePath('C:\\docs\\a.md'), true);
        assert.strictEqual(isWindowsDrivePath('d:/work/a.md'), true);
    });

    it('协议头不应被识别为盘符路径', () => {
        assert.strictEqual(isWindowsDrivePath('https://a.b'), false);
        assert.strictEqual(isWindowsDrivePath('file:///c:/a'), false);
        assert.strictEqual(isWindowsDrivePath('C:'), false);
        assert.strictEqual(isWindowsDrivePath('images/a.md'), false);
    });
});

describe('hasUrlScheme', () => {
    it('应识别常见协议', () => {
        for (const value of ['https://a.b', 'mailto:a@b', 'data:image/png;base64,x', 'vscode-resource://x', 'ftp://x']) {
            assert.strictEqual(hasUrlScheme(value), true, value);
        }
    });

    it('Windows 盘符路径不应被视为协议', () => {
        assert.strictEqual(hasUrlScheme('C:\\docs\\a.md'), false);
        assert.strictEqual(hasUrlScheme('D:/x.md'), false);
    });

    it('相对路径/锚点不应被视为协议', () => {
        for (const value of ['./a.md', '../a.md', '#h', 'a.md', '']) {
            assert.strictEqual(hasUrlScheme(value), false, value);
        }
    });
});