// Runs the extension inside a real VS Code instance against a copy of the fixture workspace.
import { runTests } from '@vscode/test-electron';
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
await esbuild.build({
    entryPoints: ['test/integration/suite.ts'],
    outfile: 'dist/test/suite.js',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode', 'mocha'],
    sourcemap: true,
    logLevel: 'error',
});

const workspace = mkdtempSync(join(tmpdir(), 'px-to-rem-ws-'));
cpSync('test/integration/fixture', workspace, { recursive: true });
// A git repository with one commit, for the changed-lines features.
const git = (...args) => execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], { cwd: workspace, stdio: 'ignore' });
git('init', '-q');
git('add', '-A');
git('commit', '-qm', 'fixture');

try {
    await runTests({
        version: process.env.VSCODE_VERSION ?? '1.97.2',
        extensionDevelopmentPath: root,
        extensionTestsPath: join(root, 'dist/test/suite.js'),
        launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    });
} catch (error) {
    console.error('Integration tests failed:', error);
    process.exit(1);
}
