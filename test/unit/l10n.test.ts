import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;

/** Parts of a string that translations must keep verbatim. */
function invariants(text: string): string[] {
    const parts = [
        ...(text.match(/\{\d+\}/g) ?? []),
        ...(text.match(/\$\([\w~-]+\)/g) ?? []),
        ...(text.match(/`[^`]+`/g) ?? []),
        ...(text.match(/\(command:[^)]+\)/g) ?? []),
        ...(text.match(/%[\w.]+%/g) ?? []),
    ];
    return parts.sort();
}

const source = read('l10n/bundle.l10n.json');
const manifest = read('package.nls.json');
const bundles = readdirSync('l10n').filter(f => /^bundle\.l10n\.[\w-]+\.json$/.test(f));
const nlsFiles = readdirSync('.').filter(f => /^package\.nls\.[\w-]+\.json$/.test(f));

describe('translations', () => {
    it('ships the same languages for runtime strings and the manifest', () => {
        const langs = (files: string[], prefix: string) => files.map(f => f.slice(prefix.length, -'.json'.length)).sort();
        expect(langs(bundles, 'bundle.l10n.')).toEqual(langs(nlsFiles, 'package.nls.'));
    });

    for (const file of bundles) {
        it(`${file} covers every runtime string and keeps placeholders`, () => {
            const bundle = read(`l10n/${file}`);
            expect(Object.keys(bundle).sort()).toEqual(Object.keys(source).sort());
            for (const [key, value] of Object.entries(bundle)) {
                expect(typeof value, key).toBe('string');
                expect(value.trim().length, key).toBeGreaterThan(0);
                expect(invariants(value), key).toEqual(invariants(key));
            }
        });
    }

    for (const file of nlsFiles) {
        it(`${file} covers every manifest string and keeps placeholders`, () => {
            const nls = read(file);
            expect(Object.keys(nls).sort()).toEqual(Object.keys(manifest).sort());
            for (const [key, value] of Object.entries(nls)) {
                expect(value.trim().length, key).toBeGreaterThan(0);
                expect(invariants(value), key).toEqual(invariants(manifest[key]));
            }
        });
    }
});
