/**
 * 斜杠命令过滤与命令表完整性的测试。
 */
import { describe, it, expect } from 'vitest';
import { filterSlashCommands } from '../editor/slashAction';
import { getAllCommands, getGroupLabel } from '../editor/editorCommands';

describe('getAllCommands', () => {
    it('命令 id 应唯一', () => {
        const ids = getAllCommands().map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('每个命令都应包含必需字段', () => {
        for (const cmd of getAllCommands()) {
            expect(cmd.id).toBeTruthy();
            expect(cmd.label).toBeTruthy();
            expect(cmd.icon).toContain('<svg');
            expect(Array.isArray(cmd.keywords)).toBe(true);
        }
    });

    it('应返回同一缓存实例', () => {
        expect(getAllCommands()).toBe(getAllCommands());
    });
});

describe('filterSlashCommands', () => {
    it('空查询返回全部斜杠命令', () => {
        const expected = getAllCommands().filter(c => c.slashCommand);
        expect(filterSlashCommands('')).toHaveLength(expected.length);
    });

    it('只返回标记为 slashCommand 的命令', () => {
        expect(filterSlashCommands('').every(c => c.slashCommand)).toBe(true);
    });

    it('应按 id 匹配且大小写不敏感', () => {
        expect(filterSlashCommands('H1').map(c => c.id)).toContain('h1');
    });

    it('应按关键字匹配', () => {
        expect(filterSlashCommands('todo').map(c => c.id)).toContain('task');
        expect(filterSlashCommands('表格').map(c => c.id)).toContain('table');
    });

    it('应按标签匹配', () => {
        const h2 = getAllCommands().find(c => c.id === 'h2')!;
        expect(filterSlashCommands(h2.label).map(c => c.id)).toContain('h2');
    });

    it('无匹配应返回空数组', () => {
        expect(filterSlashCommands('zzzz-no-such-command')).toEqual([]);
    });

    it('非斜杠命令不应出现在结果中', () => {
        // bold 仅出现在工具栏，不在 / 菜单中
        expect(filterSlashCommands('bold').map(c => c.id)).not.toContain('bold');
    });
});

describe('getGroupLabel', () => {
    it('已知分组应返回本地化标签', () => {
        expect(getGroupLabel('style')).toBeTruthy();
        expect(getGroupLabel('insert')).toBeTruthy();
    });

    it('未知分组应原样返回', () => {
        expect(getGroupLabel('other')).toBe('other');
    });
});