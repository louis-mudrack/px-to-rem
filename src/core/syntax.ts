/** Stylesheet dialects the parser understands. */
export type Syntax = 'css' | 'scss' | 'sass' | 'less' | 'stylus';

/** How a document hosts CSS. */
export type HostKind = 'stylesheet' | 'markup' | 'script';

export interface HostInfo {
    kind: HostKind;
    /** Dialect of the whole file, for stylesheets. */
    syntax?: Syntax;
}

const STYLESHEETS: Record<string, Syntax> = {
    css: 'css',
    postcss: 'css',
    tailwindcss: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    stylus: 'stylus',
};

const SCRIPTS = new Set(['javascript', 'typescript', 'javascriptreact', 'typescriptreact']);

/** Language ids that are treated as HTML-like markup with <style> blocks and style="" attributes. */
const MARKUP = new Set([
    'html',
    'vue',
    'vue-html',
    'svelte',
    'astro',
    'php',
    'blade',
    'twig',
    'handlebars',
    'erb',
    'razor',
    'aspnetcorerazor',
    'django-html',
    'jinja-html',
    'nunjucks',
    'liquid',
    'mdx',
]);

export function hostForLanguage(languageId: string): HostInfo | undefined {
    const syntax = STYLESHEETS[languageId];
    if (syntax) {
        return { kind: 'stylesheet', syntax };
    }
    if (SCRIPTS.has(languageId)) {
        return { kind: 'script' };
    }
    if (MARKUP.has(languageId)) {
        return { kind: 'markup' };
    }
    return undefined;
}

const EXTENSIONS: Record<string, string> = {
    css: 'css',
    pcss: 'postcss',
    postcss: 'postcss',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    styl: 'stylus',
    stylus: 'stylus',
    html: 'html',
    htm: 'html',
    vue: 'vue',
    svelte: 'svelte',
    astro: 'astro',
    php: 'php',
    twig: 'twig',
    hbs: 'handlebars',
    handlebars: 'handlebars',
    erb: 'erb',
    njk: 'nunjucks',
    liquid: 'liquid',
    mdx: 'mdx',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascriptreact',
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    tsx: 'typescriptreact',
};

/** Guesses the VS Code language id for a file name (used by the CLI and the workspace index). */
export function languageForFileName(fileName: string): string | undefined {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.blade.php')) {
        return 'blade';
    }
    const dot = lower.lastIndexOf('.');
    if (dot < 0) {
        return undefined;
    }
    return EXTENSIONS[lower.slice(dot + 1)];
}

/** File extensions the extension can work with, for glob patterns. */
export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSIONS);

/** Maps a `lang`/`type` attribute value on a <style> tag to a dialect. */
export function syntaxForStyleLang(lang: string | undefined): Syntax {
    switch ((lang ?? '').toLowerCase().replace(/^text\//, '')) {
        case 'scss':
            return 'scss';
        case 'sass':
            return 'sass';
        case 'less':
            return 'less';
        case 'styl':
        case 'stylus':
            return 'stylus';
        default:
            return 'css';
    }
}

/** Whether the dialect supports `//` line comments. */
export function hasLineComments(syntax: Syntax): boolean {
    return syntax !== 'css';
}

/** Whether the dialect is indentation based (no braces or semicolons required). */
export function isIndented(syntax: Syntax): boolean {
    return syntax === 'sass' || syntax === 'stylus';
}

/** Whether the dialect has user-defined functions such as `rem()`. */
export function isPreprocessor(syntax: Syntax): boolean {
    return syntax !== 'css';
}
