import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../../src/cli/main';

const dirs: string[] = [];

function project(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'px-to-rem-cli-'));
    dirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
        const path = join(dir, name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
    }
    return dir;
}

async function cli(cwd: string, ...argv: string[]): Promise<{ code: number; out: string; err: string }> {
    let out = '';
    let err = '';
    const code = await run(argv, { cwd, out: t => (out += t + '\n'), err: t => (err += t + '\n'), color: false });
    return { code, out, err };
}

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('px-to-rem CLI', () => {
    it('check fails on px values and passes once fixed', async () => {
        const dir = project({ 'src/a.css': '.a { padding: 16px; border: 1px solid; }\n' });
        const before = await cli(dir, 'check');
        expect(before.code).toBe(1);
        expect(before.out).toContain('src/a.css');
        expect(before.out).toContain('16px can be 1rem.');

        const fixed = await cli(dir, 'fix');
        expect(fixed.code).toBe(0);
        expect(readFileSync(join(dir, 'src/a.css'), 'utf8')).toBe('.a { padding: 1rem; border: 1px solid; }\n');

        const after = await cli(dir, 'check');
        expect(after.code).toBe(0);
        expect(after.out).toContain('no problems');
    });

    it('reads .pxtoremrc.json, overrides and --set', async () => {
        const dir = project({
            '.pxtoremrc.json': JSON.stringify({ mode: 'simple', overrides: [{ files: 'emails/**', excludeProperties: ['*'] }] }),
            'src/a.css': '.a { border: 2px solid; }\n',
            'emails/b.css': '.b { padding: 8px; }\n',
        });
        await cli(dir, 'fix');
        expect(readFileSync(join(dir, 'src/a.css'), 'utf8')).toBe('.a { border: 0.125rem solid; }\n');
        expect(readFileSync(join(dir, 'emails/b.css'), 'utf8')).toBe('.b { padding: 8px; }\n');

        const viaSet = project({ 'a.css': '.a { width: 144px; }\n' });
        await cli(viaSet, 'fix', '--set', 'format=vw', '--set', 'designWidth=1440');
        expect(readFileSync(join(viaSet, 'a.css'), 'utf8')).toBe('.a { width: 10vw; }\n');
    });

    it('detects the root font size and the rem() helper', async () => {
        const dir = project({
            'styles/_base.scss': "@use 'sass:math';\nhtml { font-size: 62.5%; }\n@function rem($px) { @return math.div($px, 10px) * 1rem; }\n",
            'styles/card.scss': '.card { margin: 20px; }\n',
            'index.html': '<div style="margin: 20px"></div>\n',
        });
        await cli(dir, 'fix');
        expect(readFileSync(join(dir, 'styles/card.scss'), 'utf8')).toBe('.card { margin: rem(20); }\n');
        expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe('<div style="margin: 2rem"></div>\n');
    });

    it('supports json and github reporters', async () => {
        const dir = project({ 'a.css': 'a {\n  font-size: 14px;\n}\n' });
        const json = await cli(dir, 'check', '--reporter', 'json');
        const parsed = JSON.parse(json.out);
        expect(parsed[0].file).toBe('a.css');
        expect(parsed[0].findings[0]).toMatchObject({ rule: 'font-size-px', severity: 'error', line: 2, column: 14 });
        const github = await cli(dir, 'check', '--reporter', 'github');
        expect(github.out).toMatch(/^::error file=a\.css,line=2,col=14,endLine=2,endColumn=18,title=px-to-rem \(font-size-px\)::/);
    });

    it('--no-px only reports audit rules', async () => {
        const dir = project({ 'a.css': '.a { padding: 16px; }\n.b { font-size: 12px; }\n' });
        const result = await cli(dir, 'check', '--no-px', '--reporter', 'json');
        const rules = JSON.parse(result.out).flatMap((f: { findings: { rule: string }[] }) => f.findings.map(x => x.rule));
        expect(rules).toEqual(['font-size-px']);
    });

    it('--changed only looks at lines changed since HEAD', async () => {
        const dir = project({ 'a.css': '.a { padding: 16px; }\n' });
        const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
        git('init', '-q');
        git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A');
        git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init');
        writeFileSync(join(dir, 'a.css'), '.a { padding: 16px; }\n.b { margin: 8px; }\n');
        writeFileSync(join(dir, 'new.css'), '.c { top: 4px; }\n');
        const result = await cli(dir, 'check', '--changed', '--reporter', 'json');
        const found = JSON.parse(result.out).map((f: { file: string; findings: { line: number }[] }) => [f.file, f.findings.map(x => x.line)]);
        expect(found).toEqual([
            ['a.css', [2]],
            ['new.css', [1]],
        ]);
    });

    it('rebases rem values', async () => {
        const dir = project({ 'a.css': 'html { font-size: 62.5%; }\n.a { padding: 1.6rem; }\n' });
        await cli(dir, 'rebase', '--from', '10', '--to', '16', '--root-declarations');
        expect(readFileSync(join(dir, 'a.css'), 'utf8')).toBe('html { font-size: 100%; }\n.a { padding: 1rem; }\n');
    });

    it('reports statistics as JSON', async () => {
        const dir = project({ 'a.css': '.a { padding: 16px; margin: 1rem; gap: 13px; }\n' });
        const result = await cli(dir, 'report', '--json');
        const parsed = JSON.parse(result.out);
        expect(parsed.report.convertible).toBe(2);
        expect(parsed.report.scalable).toBe(1);
        expect(parsed.report.outliers.map((o: { px: number }) => o.px)).toEqual([13]);
    });

    it('init writes a config file once', async () => {
        const dir = project({ 'a.css': 'html { font-size: 10px; }\n' });
        const first = await cli(dir, 'init');
        expect(first.code).toBe(0);
        expect(JSON.parse(readFileSync(join(dir, '.pxtoremrc.json'), 'utf8'))).toMatchObject({ mode: 'smart', format: 'auto', baseFontSize: 10 });
        const second = await cli(dir, 'init');
        expect(second.code).toBe(2);
    });

    it('prints help and rejects unknown commands', async () => {
        expect((await cli(process.cwd(), '--help')).out).toContain('px-to-rem check');
        expect((await cli(process.cwd(), 'nope')).code).toBe(2);
        expect((await cli(process.cwd(), 'check', '--set', 'notAnOption=1')).code).toBe(2);
    });
});

describe('review regressions', () => {
    it('applies root .gitignore patterns when run from a subdirectory', async () => {
        const dir = project({
            '.gitignore': '/packages/web/legacy\n',
            'packages/web/legacy/a.css': '.a { margin: 16px; }\n',
            'packages/web/src/b.css': '.b { margin: 16px; }\n',
        });
        execFileSync('git', ['init', '-q'], { cwd: dir });
        await cli(join(dir, 'packages/web'), 'fix');
        expect(readFileSync(join(dir, 'packages/web/legacy/a.css'), 'utf8')).toBe('.a { margin: 16px; }\n');
        expect(readFileSync(join(dir, 'packages/web/src/b.css'), 'utf8')).toBe('.b { margin: 1rem; }\n');
    });

    it('--changed sees untracked files with special characters', async () => {
        const dir = project({ 'a.css': '.a { padding: 0; }\n' });
        const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
        git('init', '-q');
        git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A');
        git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init');
        writeFileSync(join(dir, 'café.css'), '.c { top: 4px; }\n');
        const result = await cli(dir, 'check', '--changed', '--reporter', 'json');
        expect(JSON.parse(result.out).map((f: { file: string }) => f.file)).toEqual(['café.css']);
    });
});
