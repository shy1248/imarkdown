/**
 * 路径补全纯逻辑的测试套件（src/utils/pathCompletion.ts）。
 */
import * as assert from 'assert';
import * as path from 'path';
import {
    buildCompletionValue,
    expandHomePrefix,
    resolveCompletionQuery,
} from '../utils/pathCompletion';

const DOC_DIR = path.resolve('/docs/project');
const HOME_DIR = path.resolve('/home/user');

describe('expandHomePrefix', () => {
    it('裸 ~ 应展开为 home/', () => {
        assert.strictEqual(expandHomePrefix('~', HOME_DIR), HOME_DIR + path.sep);
    });

    it('~/ 前缀应展开为用户主目录', () => {
        assert.strictEqual(expandHomePrefix('~/notes', HOME_DIR), path.join(HOME_DIR, 'notes'));
    });

    it('~\\ 前缀（Windows 风格）也应展开', () => {
        assert.strictEqual(expandHomePrefix('~\\notes', HOME_DIR), path.join(HOME_DIR, 'notes'));
    });

    it('非 ~ 前缀应原样返回', () => {
        assert.strictEqual(expandHomePrefix('images/a.png', HOME_DIR), 'images/a.png');
        assert.strictEqual(expandHomePrefix('', HOME_DIR), '');
    });
});

describe('resolveCompletionQuery', () => {
    it('空前缀应列出文档目录且无过滤', () => {
        const q = resolveCompletionQuery('', DOC_DIR, HOME_DIR);
        assert.strictEqual(q.rawDir, DOC_DIR);
        assert.strictEqual(q.partial, '');
        assert.strictEqual(q.dirPrefix, '');
    });

    it('./ 与 . 都应列出文档目录', () => {
        for (const prefix of ['./', '.']) {
            const q = resolveCompletionQuery(prefix, DOC_DIR, HOME_DIR);
            assert.strictEqual(q.rawDir, DOC_DIR);
            assert.strictEqual(q.partial, '');
        }
    });

    it('子目录前缀应解析为绝对目录并给出过滤前缀', () => {
        const q = resolveCompletionQuery('images/foo', DOC_DIR, HOME_DIR);
        assert.strictEqual(q.rawDir, path.resolve(DOC_DIR, 'images'));
        assert.strictEqual(q.partial, 'foo');
        assert.strictEqual(q.dirPrefix, 'images/');
    });

    it('过滤前缀应转为小写（大小写不敏感匹配）', () => {
        const q = resolveCompletionQuery('images/FOO', DOC_DIR, HOME_DIR);
        assert.strictEqual(q.partial, 'foo');
    });

    it('父目录前缀应正确解析', () => {
        const q = resolveCompletionQuery('../img', DOC_DIR, HOME_DIR);
        assert.strictEqual(q.rawDir, path.resolve(DOC_DIR, '..'));
        assert.strictEqual(q.partial, 'img');
        assert.strictEqual(q.dirPrefix, '../');
    });

    it('无斜杠的普通前缀应在文档目录内过滤', () => {
        const q = resolveCompletionQuery('rea', DOC_DIR, HOME_DIR);
        assert.strictEqual(q.rawDir, DOC_DIR);
        assert.strictEqual(q.partial, 'rea');
        assert.strictEqual(q.dirPrefix, '');
    });

    it('绝对路径前缀不应拼接文档目录', () => {
        const abs = path.resolve('/abs/dir');
        const q = resolveCompletionQuery(`${abs}/x`, DOC_DIR, HOME_DIR);
        assert.strictEqual(q.rawDir, path.normalize(abs + '/'));
        assert.strictEqual(q.partial, 'x');
    });

    it('裸 ~ 的补全前缀应仍为 ~/（便于后续继续展开）', () => {
        const q = resolveCompletionQuery('~', DOC_DIR, HOME_DIR);
        assert.strictEqual(q.rawDir, path.normalize(HOME_DIR + path.sep));
        assert.strictEqual(q.partial, '');
        assert.strictEqual(q.dirPrefix, '~/');
    });

    it('Windows 反斜杠分隔符应被识别', () => {
        const q = resolveCompletionQuery('dir\\sub\\file', DOC_DIR, HOME_DIR);
        assert.strictEqual(q.partial, 'file');
        assert.strictEqual(q.dirPrefix, 'dir\\sub\\');
    });
});

describe('buildCompletionValue', () => {
    it('文件应原样追加', () => {
        assert.strictEqual(buildCompletionValue('images/', 'a.png', false), 'images/a.png');
    });

    it('目录应以 / 结尾', () => {
        assert.strictEqual(buildCompletionValue('images/', 'sub', true), 'images/sub/');
    });

    it('无前缀时应仅返回名称', () => {
        assert.strictEqual(buildCompletionValue('', 'a.md', false), 'a.md');
    });
});
