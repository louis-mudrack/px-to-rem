// Collects every runtime UI string (vscode.l10n.t literals, engine messages,
// dashboard strings) into l10n/bundle.l10n.json, the source for translations.
// `node scripts/extract-l10n.mjs --check` fails when the bundle is stale.
import * as esbuild from 'esbuild';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const check = process.argv.includes('--check');

function walk(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
    });
}

/** Unescapes a single-quoted TypeScript string literal body. */
function unescape(body) {
    return body.replace(/\\(['"\\nt])/g, (_, c) => ({ n: '\n', t: '\t' })[c] ?? c);
}

const strings = new Set();
for (const file of walk('src/extension')) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/vscode\.l10n\.t\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        strings.add(unescape(m[1]));
    }
}

// Dashboard UI keys listed in views/dashboard.ts strings().
const dashboard = readFileSync('src/extension/views/dashboard.ts', 'utf8');
const keysBlock = dashboard.slice(dashboard.indexOf('const keys = ['), dashboard.indexOf('];', dashboard.indexOf('const keys = [')));
for (const m of keysBlock.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
    strings.add(unescape(m[1]));
}

// Engine messages.
const bundle = await esbuild.build({ entryPoints: ['src/core/messages.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral' });
const { MESSAGES } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
for (const value of Object.values(MESSAGES)) {
    strings.add(value);
}

const sorted = [...strings].sort((a, b) => a.localeCompare(b));
const content = JSON.stringify(Object.fromEntries(sorted.map(s => [s, s])), null, 2) + '\n';
let current = '';
try {
    current = readFileSync('l10n/bundle.l10n.json', 'utf8');
} catch {
    // First run.
}
if (current !== content) {
    if (check) {
        console.error('l10n/bundle.l10n.json is out of date. Run `node scripts/extract-l10n.mjs`.');
        process.exit(1);
    }
    writeFileSync('l10n/bundle.l10n.json', content);
    console.log(`l10n/bundle.l10n.json: ${sorted.length} strings`);
}
