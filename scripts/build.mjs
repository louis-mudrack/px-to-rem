// Bundles the desktop extension, the web extension, the dashboard webview and the CLI.
import * as esbuild from 'esbuild';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
    bundle: true,
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
    legalComments: 'none',
};

const targets = [
    {
        ...common,
        entryPoints: ['src/extension/main.ts'],
        outfile: 'dist/extension.js',
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['vscode'],
    },
    {
        ...common,
        entryPoints: ['src/extension/main.ts'],
        outfile: 'dist/web/extension.js',
        platform: 'browser',
        format: 'cjs',
        target: 'es2022',
        external: ['vscode'],
        mainFields: ['browser', 'module', 'main'],
        define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
    },
    {
        ...common,
        entryPoints: ['src/webview/dashboard.ts'],
        outfile: 'dist/webview/dashboard.js',
        platform: 'browser',
        format: 'iife',
        target: 'es2022',
    },
    {
        ...common,
        entryPoints: ['src/cli/bin.ts'],
        outfile: 'cli/dist/px-to-rem.mjs',
        platform: 'node',
        format: 'esm',
        target: 'node20',
        banner: { js: "#!/usr/bin/env node\nimport { createRequire as __pxCreateRequire } from 'node:module';\nconst require = __pxCreateRequire(import.meta.url);" },
    },
].filter(t => existsSync(t.entryPoints[0]));

mkdirSync('dist', { recursive: true });

if (watch) {
    const contexts = await Promise.all(targets.map(t => esbuild.context(t)));
    await Promise.all(contexts.map(c => c.watch()));
} else {
    await Promise.all(targets.map(t => esbuild.build(t)));
    if (existsSync('cli/dist/px-to-rem.mjs')) {
        chmodSync('cli/dist/px-to-rem.mjs', 0o755);
    }
}
