// Runs the extension inside a real VS Code instance against a copy of the fixture workspace.
import { runTests } from '@vscode/test-electron';
import * as esbuild from 'esbuild';
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
