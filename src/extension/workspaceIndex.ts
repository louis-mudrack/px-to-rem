import * as vscode from 'vscode';
import type { RemFunctionDef } from '../core/context';
import {
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
import { ALWAYS_EXCLUDED_GLOB, gitignoreToGlobs } from '../core/gitignore';
import type { Options } from '../core/options';
import { languageForFileName } from '../core/syntax';
import type { TailwindConfig } from '../core/tailwind';
import type { TokenDef } from '../core/tokens';
import { extractTokensFromDocument, extractTokensFromJson } from '../core/tokens/extract';
import { globMatch, type ConfigService } from './config';

/** Facts extracted from one stylesheet or token file. */
export interface FileFacts {
    uri: vscode.Uri;
    relativePath: string;
    rootCandidates: RootFontSizeCandidate[];
    remFunctions: RemFunctionDef[];
    /** Tokens computed with a 16px root; rem-valued tokens are rescaled by the project service. */
    tokens: TokenDef[];
    tailwind?: { present: boolean; config: Partial<TailwindConfig> };
    looksLikeTokenFile: boolean;
}

/** Facts about a workspace folder that come from configuration files. */
export interface FolderFacts {
    packages: PackageFacts[];
    postcss?: PostcssPxToRem;
    tailwindJs?: Partial<TailwindConfig>;
    tailwindConfigFile: boolean;
    gitignore: string[];
}

const STYLE_GLOB = '**/*.{css,scss,sass,less,styl,stylus,pcss,postcss,vue,svelte,astro}';
const TOKEN_JSON_GLOB = '**/{*.tokens.json,tokens.json,design-tokens*.json,tokens/**/*.json,design-tokens/**/*.json}';
const TOKEN_FILE_PATH = /(token|variable|vars|theme|settings|config|design|foundation|primitives|scale|base)/i;
const MAX_FILE_BYTES = 2_000_000;

const decoder = new TextDecoder();

async function readText(uri: vscode.Uri): Promise<string | undefined> {
    try {
        const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
        if (open) {
            return open.getText();
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength > MAX_FILE_BYTES) {
            return undefined;
        }
        return decoder.decode(bytes);
    } catch {
        return undefined;
    }
}

const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Background index of stylesheet facts (root font size declarations, rem()
 * definitions, design tokens, Tailwind themes) and folder-level config
 * (package.json, PostCSS, Tailwind, .gitignore). Kept up to date by file
 * watchers.
 */
export class WorkspaceIndex implements vscode.Disposable {
    private files = new Map<string, FileFacts>();
    private folders = new Map<string, FolderFacts>();
    /** The file map a running scan is filling; replaces `files` when the scan completes. */
    private building: Map<string, FileFacts> | undefined;
    /** Increments per scan, so a slower, older scan never replaces a newer one. */
    private generation = 0;
    private readonly emitter = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [];
    private changeTimer: ReturnType<typeof setTimeout> | undefined;
    private scanning: Promise<void> | undefined;
    private scanned = false;
    readonly onDidChange = this.emitter.event;

    constructor(private readonly config: ConfigService) {}

    get ready(): boolean {
        return this.scanned;
    }

    start(): void {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.{css,scss,sass,less,styl,stylus,pcss,postcss,vue,svelte,astro,json}');
        const configWatcher = vscode.workspace.createFileSystemWatcher('**/{package.json,postcss.config.*,.postcssrc*,tailwind.config.*,.gitignore}');
        const onFile = (uri: vscode.Uri) => void this.updateFile(uri);
        const onConfig = () =>
            void this.readFolders().then(folders => {
                this.folders = folders;
                this.changed();
            });
        this.disposables.push(
            watcher,
            configWatcher,
            watcher.onDidChange(onFile),
            watcher.onDidCreate(onFile),
            watcher.onDidDelete(uri => {
                this.building?.delete(uri.toString());
                if (this.files.delete(uri.toString())) {
                    this.changed();
                }
            }),
            configWatcher.onDidChange(onConfig),
            configWatcher.onDidCreate(onConfig),
            configWatcher.onDidDelete(onConfig),
            vscode.workspace.onDidSaveTextDocument(doc => void this.updateFile(doc.uri)),
            this.config.onDidChange(() => void this.rescan()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => void this.rescan()),
        );
        void this.rescan();
    }

    /** Resolves once the current scan has finished. */
    whenReady(): Promise<void> {
        return this.scanning ?? Promise.resolve();
    }

    private changed(): void {
        if (this.changeTimer) {
            clearTimeout(this.changeTimer);
        }
        this.changeTimer = setTimeout(() => this.emitter.fire(), 150);
    }

    rescan(): Promise<void> {
        this.scanning = this.scan()
            .catch(error => {
                // A failed scan must not break the extension; conversions fall back to settings.
                console.error('[px-to-rem] workspace scan failed', error);
            })
            .finally(() => {
                this.scanned = true;
                this.changed();
            });
        return this.scanning;
    }

    /**
     * Builds a complete new index and swaps it in at the end. Until then the
     * previous facts stay in place, so a rescan (after every settings change)
     * never shows providers an empty project with the default root font size
     * and no tokens.
     */
    private async scan(): Promise<void> {
        const generation = ++this.generation;
        const folders = await this.readFolders();
        if (generation !== this.generation) {
            return;
        }
        this.folders = folders;
        const files = new Map<string, FileFacts>();
        this.building = files;
        try {
            for (const folder of vscode.workspace.workspaceFolders ?? []) {
                const options = this.config.optionsFor(folder.uri);
                const uris = await this.findStyleFiles(folder, options);
                let n = 0;
                for (const uri of uris) {
                    if (generation !== this.generation) {
                        return;
                    }
                    setFacts(files, uri, await this.readFacts(uri, options));
                    if (++n % 40 === 0) {
                        await yieldToEventLoop();
                    }
                }
            }
            if (generation === this.generation) {
                this.files = files;
            }
        } finally {
            if (this.building === files) {
                this.building = undefined;
            }
        }
    }

    private async findStyleFiles(folder: vscode.WorkspaceFolder, options: Options): Promise<vscode.Uri[]> {
        const limit = options.workspace.maxFiles;
        const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, STYLE_GLOB), ALWAYS_EXCLUDED_GLOB, limit);
        const tokenGlobs = options.tokens.sources.length ? options.tokens.sources : options.tokens.autoDetect ? [TOKEN_JSON_GLOB] : [];
        for (const glob of tokenGlobs) {
            const extra = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, glob), ALWAYS_EXCLUDED_GLOB, 200);
            found.push(...extra);
        }
        const seen = new Set<string>();
        return found.filter(uri => {
            const key = uri.toString();
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return !this.isIgnored(uri, folder, options);
        });
    }

    /** Whether a file is excluded by `excludeFiles` or `.gitignore`. */
    isIgnored(uri: vscode.Uri, folder: vscode.WorkspaceFolder | undefined, options: Options): boolean {
        const relative = vscode.workspace.asRelativePath(uri, false);
        if (options.excludeFiles.some(g => globMatch(relative, g))) {
            return true;
        }
        if (options.respectGitignore && folder) {
            const gitignore = this.folders.get(folder.uri.toString())?.gitignore ?? [];
            const inFolder = relative.startsWith(folder.name + '/') ? relative.slice(folder.name.length + 1) : relative;
            if (gitignore.some(g => globMatch(inFolder, g))) {
                return true;
            }
        }
        return false;
    }

    private async updateFile(uri: vscode.Uri): Promise<void> {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder) {
            return;
        }
        const name = uri.path.toLowerCase();
        if (/\.json$/.test(name) && !/tokens?|design/.test(name)) {
            return;
        }
        if (!languageForFileName(uri.path) && !name.endsWith('.json')) {
            return;
        }
        const options = this.config.optionsFor(folder.uri);
        if (this.isIgnored(uri, folder, options)) {
            return;
        }
        const facts = await this.readFacts(uri, options);
        setFacts(this.files, uri, facts);
        // A running scan may have read this file already; keep its result current too.
        if (this.building) {
            setFacts(this.building, uri, facts);
        }
        this.changed();
    }

    /** The facts of one file, or undefined when it defines nothing the index cares about. */
    private async readFacts(uri: vscode.Uri, options: Options): Promise<FileFacts | undefined> {
        const text = await readText(uri);
        if (text === undefined) {
            return undefined;
        }
        const relativePath = vscode.workspace.asRelativePath(uri, false);
        const looksLikeTokenFile = TOKEN_FILE_PATH.test(relativePath);
        if (uri.path.toLowerCase().endsWith('.json')) {
            const tokens = options.tokens.enable ? extractTokensFromJson(text, relativePath, options, 16) : [];
            return { uri, relativePath, rootCandidates: [], remFunctions: [], tokens, looksLikeTokenFile: true };
        }
        const languageId = languageForFileName(uri.path);
        if (!languageId) {
            return undefined;
        }
        // Cheap pre-check: most files define nothing the index cares about.
        const interesting =
            /(html|:root|:host|@theme|@import\s+["']tailwindcss|@tailwind)/i.test(text) ||
            text.includes('$') ||
            text.includes('@') ||
            text.includes('--') ||
            /^\s*[\w-]+\s*=/m.test(text);
        if (!interesting) {
            return undefined;
        }
        const doc = parseDocument(text, languageId);
        const facts: FileFacts = {
            uri,
            relativePath,
            rootCandidates: findRootFontSizes(doc, relativePath),
            remFunctions: findRemFunctions(doc, relativePath, options.functionName),
            tokens: options.tokens.enable ? extractTokensFromDocument(doc, relativePath, options, 16) : [],
            looksLikeTokenFile,
        };
        if (/tailwind|@theme|@apply/.test(text)) {
            facts.tailwind = readTailwindCss(doc, 16);
        }
        return facts;
    }

    private async readFolders(): Promise<Map<string, FolderFacts>> {
        const folders = new Map<string, FolderFacts>();
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const facts: FolderFacts = { packages: [], tailwindConfigFile: false, gitignore: [] };
            const packageFiles = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, '{package.json,*/package.json,*/*/package.json}'),
                ALWAYS_EXCLUDED_GLOB,
                50,
            );
            for (const uri of packageFiles) {
                const text = await readText(uri);
                const pkg = text ? readPackageJson(text) : undefined;
                if (pkg) {
                    facts.packages.push(pkg);
                }
                if (!facts.postcss && text) {
                    facts.postcss = parsePostcssPxToRem(text, vscode.workspace.asRelativePath(uri, false));
                }
            }
            const postcssFiles = await vscode.workspace.findFiles(
                // VS Code's file search does not allow nested {} groups.
                new vscode.RelativePattern(
                    folder,
                    '{postcss.config.js,postcss.config.cjs,postcss.config.mjs,postcss.config.ts,.postcssrc,.postcssrc.json,.postcssrc.js,.postcssrc.cjs}',
                ),
                ALWAYS_EXCLUDED_GLOB,
                5,
            );
            for (const uri of postcssFiles) {
                const text = await readText(uri);
                const found = text ? parsePostcssPxToRem(text, vscode.workspace.asRelativePath(uri, false)) : undefined;
                if (found) {
                    facts.postcss = found;
                    break;
                }
            }
            const tailwindFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, 'tailwind.config.{js,cjs,mjs,ts}'), ALWAYS_EXCLUDED_GLOB, 1);
            if (tailwindFiles.length) {
                facts.tailwindConfigFile = true;
                const text = await readText(tailwindFiles[0]);
                if (text) {
                    facts.tailwindJs = readTailwindConfigJs(text, 16);
                }
            }
            const gitignoreText = await readText(vscode.Uri.joinPath(folder.uri, '.gitignore'));
            if (gitignoreText) {
                facts.gitignore = gitignoreToGlobs(gitignoreText);
            }
            folders.set(folder.uri.toString(), facts);
        }
        return folders;
    }

    filesIn(folder: vscode.WorkspaceFolder | undefined): FileFacts[] {
        const all = [...this.files.values()];
        if (!folder) {
            return all;
        }
        return all.filter(f => vscode.workspace.getWorkspaceFolder(f.uri)?.uri.toString() === folder.uri.toString());
    }

    folderFacts(folder: vscode.WorkspaceFolder | undefined): FolderFacts | undefined {
        return folder ? this.folders.get(folder.uri.toString()) : undefined;
    }

    dispose(): void {
        this.emitter.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

function setFacts(files: Map<string, FileFacts>, uri: vscode.Uri, facts: FileFacts | undefined): void {
    if (facts) {
        files.set(uri.toString(), facts);
    } else {
        files.delete(uri.toString());
    }
}
