import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { glob } from 'tinyglobby';
import { createContext, type ProjectContext, type RemFunctionDef } from '../core/context';
import {
    chooseRootFontSize,
    findRemFunctions,
    findRootFontSizes,
    parsePostcssPxToRem,
    readPackageJson,
    readTailwindConfigJs,
    readTailwindCss,
    type PackageFacts,
    type PostcssPxToRem,
    type RootFontSizeCandidate,
} from '../core/detect';
import { parseDocument } from '../core/document';
import { ALWAYS_EXCLUDED_DIRS, gitignoreToGlobs } from '../core/gitignore';
import { changedLinesFromDiff, splitDiffByFile } from '../core/gitDiff';
import { parseJsonc } from '../core/jsonc';
import { applyConfigFile, applyOptions, defaultOptions, flattenOptions, type ConfigFile, type Options, type PartialOptions } from '../core/options';
import { languageForFileName } from '../core/syntax';
import { DEFAULT_TAILWIND, type TailwindConfig } from '../core/tailwind';
import { TokenIndex, type TokenDef } from '../core/tokens';
import { extractTokensFromDocument, extractTokensFromJson } from '../core/tokens/extract';
import { minimatch } from 'minimatch';

export const CONFIG_FILE_NAMES = ['.pxtoremrc.json', '.pxtoremrc', 'pxtorem.config.json'];
const STYLE_EXTENSIONS = ['css', 'scss', 'sass', 'less', 'styl', 'stylus', 'pcss', 'postcss', 'vue', 'svelte', 'astro'];
const TOKEN_FILE_PATH = /(token|variable|vars|theme|settings|config|design|foundation|primitives|scale|base)/i;

export interface LoadedConfig {
    path?: string;
    root: string;
    config?: ConfigFile;
}

/** Finds `.pxtoremrc.json` from `cwd` upwards (or uses `explicit`). */
export function loadConfig(cwd: string, explicit?: string): LoadedConfig {
    if (explicit) {
        const path = resolve(cwd, explicit);
        const parsed = parseJsonc(readFileSync(path, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`Invalid configuration file: ${path}`);
        }
        return { path, root: dirname(path), config: parsed as ConfigFile };
    }
    let dir = resolve(cwd);
    for (;;) {
        for (const name of CONFIG_FILE_NAMES) {
            const path = join(dir, name);
            if (existsSync(path)) {
                const parsed = parseJsonc(readFileSync(path, 'utf8'));
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    throw new Error(`Invalid configuration file: ${path}`);
                }
                return { path, root: dir, config: parsed as ConfigFile };
            }
        }
        const parent = dirname(dir);
        if (existsSync(join(dir, '.git'))) {
            // No config file: the repository root anchors .gitignore and project detection.
            return { root: dir };
        }
        if (parent === dir) {
            return { root: resolve(cwd) };
        }
        dir = parent;
    }
}

export function toPosix(path: string): string {
    return path.split(sep).join('/');
}

export function optionsFor(loaded: LoadedConfig, file: string | undefined, cliLayer: PartialOptions): Options {
    let options = applyConfigFile(defaultOptions(), loaded.config, file ? toPosix(relative(loaded.root, file)) : undefined, (p, g) =>
        minimatch(p, g, { dot: true, matchBase: !g.includes('/'), nocase: true }),
    );
    options = applyOptions(options, cliLayer);
    return options;
}

function readGitignore(root: string): string[] {
    const path = join(root, '.gitignore');
    return existsSync(path) ? gitignoreToGlobs(readFileSync(path, 'utf8')) : [];
}

/**
 * Resolves file patterns (default: every supported file under `cwd`) honouring
 * excludes and .gitignore. Globbing runs from the config root so that root-
 * relative ignore patterns apply even when the CLI runs in a subdirectory.
 */
export async function findFiles(root: string, patterns: string[], options: Options, cwd: string): Promise<string[]> {
    const ignore = [...ALWAYS_EXCLUDED_DIRS.map(d => `**/${d}/**`), ...options.excludeFiles, ...(options.respectGitignore ? readGitignore(root) : [])];
    const fromCwd = patterns.length ? patterns : [`**/*.{${options.fileTypes.join(',')}}`];
    const rooted = fromCwd.map(pattern => {
        const negated = pattern.startsWith('!');
        const body = negated ? pattern.slice(1) : pattern;
        const relativeToRoot = toPosix(relative(root, resolve(cwd, body))) || '.';
        return (negated ? '!' : '') + relativeToRoot;
    });
    const files = await glob(rooted, { cwd: root, ignore, absolute: true, dot: false, onlyFiles: true });
    // Normalise separators so lookups (e.g. --changed) match on every platform.
    return [...new Set(files.map(f => resolve(f)))].filter(f => languageForFileName(f)).sort();
}

export interface ProjectFacts {
    context: ProjectContext;
    rootSource?: string;
    ambiguous: boolean;
    tailwindDetected: boolean;
    postcss?: PostcssPxToRem;
}

/** Builds the project context the same way the extension does. */
export async function buildProject(loaded: LoadedConfig, options: Options, explicitBase?: number): Promise<ProjectFacts> {
    const root = loaded.root;
    const ignore = [...ALWAYS_EXCLUDED_DIRS.map(d => `**/${d}/**`), ...options.excludeFiles, ...(options.respectGitignore ? readGitignore(root) : [])];
    const styleFiles = await glob([`**/*.{${STYLE_EXTENSIONS.join(',')}}`], { cwd: root, ignore, absolute: true });
    const tokenGlobs = options.tokens.sources.length
        ? options.tokens.sources
        : options.tokens.autoDetect
          ? ['**/*.tokens.json', '**/tokens.json', '**/design-tokens*.json', '**/tokens/**/*.json', '**/design-tokens/**/*.json']
          : [];
    const tokenJson = tokenGlobs.length ? await glob(tokenGlobs, { cwd: root, ignore, absolute: true }) : [];

    const candidates: RootFontSizeCandidate[] = [];
    const remFunctions: RemFunctionDef[] = [];
    const tokenFiles: { file: string; tokens: TokenDef[] }[] = [];
    const tailwindCss: Partial<TailwindConfig>[] = [];
    let tailwindPresentInCss = false;

    for (const file of styleFiles.slice(0, options.workspace.maxFiles)) {
        const rel = toPosix(relative(root, file));
        const languageId = languageForFileName(file);
        if (!languageId) {
            continue;
        }
        let text: string;
        try {
            text = readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        if (text.length > 2_000_000) {
            continue;
        }
        const doc = parseDocument(text, languageId);
        candidates.push(...findRootFontSizes(doc, rel));
        remFunctions.push(...findRemFunctions(doc, rel, options.functionName));
        if (options.tokens.enable) {
            tokenFiles.push({ file: rel, tokens: extractTokensFromDocument(doc, rel, options, 16) });
        }
        if (/tailwind|@theme|@apply/.test(text)) {
            const tw = readTailwindCss(doc, 16);
            tailwindPresentInCss ||= tw.present;
            tailwindCss.push(tw.config);
        }
    }
    for (const file of tokenJson) {
        const rel = toPosix(relative(root, file));
        try {
            tokenFiles.push({ file: rel, tokens: extractTokensFromJson(readFileSync(file, 'utf8'), rel, options, 16) });
        } catch {
            // Unreadable token file: skip.
        }
    }

    const packages: PackageFacts[] = [];
    let postcss: PostcssPxToRem | undefined;
    for (const file of await glob(['package.json', '*/package.json', '*/*/package.json'], { cwd: root, ignore, absolute: true })) {
        const text = readFileSync(file, 'utf8');
        const pkg = readPackageJson(text);
        if (pkg) {
            packages.push(pkg);
        }
        postcss ??= parsePostcssPxToRem(text, toPosix(relative(root, file)));
    }
    for (const file of await glob(['postcss.config.{js,cjs,mjs,ts}', '.postcssrc', '.postcssrc.{json,js,cjs,yml,yaml}'], { cwd: root, absolute: true, dot: true })) {
        const found = parsePostcssPxToRem(readFileSync(file, 'utf8'), toPosix(relative(root, file)));
        if (found) {
            postcss = found;
            break;
        }
    }
    const tailwindConfigFiles = await glob(['tailwind.config.{js,cjs,mjs,ts}'], { cwd: root, absolute: true });
    const tailwindJs = tailwindConfigFiles.length ? readTailwindConfigJs(readFileSync(tailwindConfigFiles[0], 'utf8'), 16) : undefined;

    let rootFontSize = options.baseFontSize;
    let rootSource: string | undefined;
    let ambiguous = false;
    if (options.baseFontSizeDetection === 'auto') {
        const chosen = chooseRootFontSize({ explicit: explicitBase, postcss, candidates, fallback: options.baseFontSize });
        rootFontSize = chosen.px;
        ambiguous = chosen.ambiguous;
        rootSource = chosen.source ? `${chosen.source.description ?? ''}${chosen.source.file ? ` (${chosen.source.file})` : ''}` : undefined;
    }

    const explicitSources = options.tokens.sources.length > 0;
    const tokens = tokenFiles
        .filter(f => f.tokens.length && (explicitSources || TOKEN_FILE_PATH.test(f.file) || f.tokens.length >= 8 || f.file.endsWith('.json')))
        .flatMap(f => f.tokens)
        .map(t => (t.px !== undefined && rootFontSize !== 16 && /rem\b/i.test(t.rawValue) ? { ...t, px: (t.px * rootFontSize) / 16 } : t));

    const tailwindVersion = packages.find(p => p.tailwindVersion)?.tailwindVersion;
    const tailwindDetected = !!tailwindVersion || tailwindPresentInCss || tailwindConfigFiles.length > 0;
    let tailwind: TailwindConfig | undefined;
    if (options.tailwind.enable === 'on' || (options.tailwind.enable === 'auto' && tailwindDetected)) {
        tailwind = { ...DEFAULT_TAILWIND, version: tailwindVersion ?? (tailwindConfigFiles.length ? 3 : 4) };
        for (const partial of [tailwindJs, ...tailwindCss]) {
            if (partial) {
                tailwind = { ...tailwind, ...partial, fontSizes: { ...tailwind.fontSizes, ...partial.fontSizes }, spacing: { ...tailwind.spacing, ...partial.spacing } };
            }
        }
    }

    return {
        context: createContext(options, {
            rootFontSize,
            remFunctions,
            tokens: new TokenIndex(tokens),
            tailwind,
            reactNative: packages.some(p => p.reactNative),
            rootFontSizeSource: rootSource ? { description: rootSource } : undefined,
        }),
        rootSource,
        ambiguous,
        tailwindDetected,
        postcss,
    };
}

/** Lines changed against a git ref (default HEAD), per absolute file path. `'all'` for untracked files. */
export function changedLines(root: string, base = 'HEAD'): Map<string, Set<number> | 'all'> {
    const out = new Map<string, Set<number> | 'all'>();
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
    const diff = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', base], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    for (const [path, fileDiff] of splitDiffByFile(diff)) {
        out.set(resolve(gitRoot, path), changedLinesFromDiff(fileDiff));
    }
    // -z: raw paths, no C-quoting of special characters.
    const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: gitRoot, encoding: 'utf8' });
    for (const path of untracked.split('\0').filter(Boolean)) {
        out.set(resolve(gitRoot, path), 'all');
    }
    return out;
}

/** Keys explicitly set in the config file, for detection precedence. */
export function explicitBaseFontSize(loaded: LoadedConfig): number | undefined {
    const value = loaded.config ? flattenOptions(loaded.config).baseFontSize : undefined;
    return typeof value === 'number' ? value : undefined;
}
