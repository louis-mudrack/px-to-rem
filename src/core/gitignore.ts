/** Directories never worth scanning. */
export const ALWAYS_EXCLUDED_DIRS = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'out',
    'coverage',
    '.next',
    '.nuxt',
    '.svelte-kit',
    '.output',
    '.turbo',
    '.cache',
    'vendor',
    'bower_components',
    '.vscode-test',
];

export const ALWAYS_EXCLUDED_GLOB = `**/{${ALWAYS_EXCLUDED_DIRS.join(',')}}/**`;

/**
 * Converts `.gitignore` lines to glob patterns (relative to the folder that
 * holds the file). Negations are ignored: skipping a file too many is safer
 * than rewriting one that should have been skipped.
 */
export function gitignoreToGlobs(text: string): string[] {
    const globs: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('!')) {
            continue;
        }
        let pattern = line.replace(/\\ /g, ' ');
        const dirOnly = pattern.endsWith('/');
        if (dirOnly) {
            pattern = pattern.slice(0, -1);
        }
        const anchored = pattern.startsWith('/') || pattern.slice(0, -1).includes('/');
        pattern = pattern.replace(/^\//, '');
        const base = anchored ? pattern : `**/${pattern}`;
        globs.push(`${base}/**`);
        if (!dirOnly) {
            globs.push(base);
        }
    }
    return globs;
}
