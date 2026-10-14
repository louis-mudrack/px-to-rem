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
    private readonly files = new Map<string, FileFacts>();
    private readonly folders = new Map<string, FolderFacts>();
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
        const onConfig = () => void this.scanFolders().then(() => this.changed());
        this.disposables.push(
            watcher,
            configWatcher,
            watcher.onDidChange(onFile),
            watcher.onDidCreate(onFile),
            watcher.onDidDelete(uri => {
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
        this.scanning = this.scan().finally(() => {
            this.scanned = true;
            this.changed();
        });
        return this.scanning;
    }

    private async scan(): Promise<void> {
        await this.scanFolders();
        this.files.clear();
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const options = this.config.optionsFor(folder.uri);
            const uris = await this.findStyleFiles(folder, options);
            let n = 0;
            for (const uri of uris) {
                await this.indexFile(uri, folder, options);
                if (++n % 40 === 0) {
                    await yieldToEventLoop();
                }
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
        await this.indexFile(uri, folder, options);
        this.changed();
    }

    private async indexFile(uri: vscode.Uri, folder: vscode.WorkspaceFolder, options: Options): Promise<void> {
        const text = await readText(uri);
        if (text === undefined) {
            this.files.delete(uri.toString());
            return;
        }
        const relativePath = vscode.workspace.asRelativePath(uri, false);
        const looksLikeTokenFile = TOKEN_FILE_PATH.test(relativePath);
        if (uri.path.toLowerCase().endsWith('.json')) {
            const tokens = options.tokens.enable ? extractTokensFromJson(text, relativePath, options, 16) : [];
            this.files.set(uri.toString(), { uri, relativePath, rootCandidates: [], remFunctions: [], tokens, looksLikeTokenFile: true });
            return;
        }
        const languageId = languageForFileName(uri.path);
        if (!languageId) {
            return;
        }
        // Cheap pre-check: most files define nothing the index cares about.
        const interesting =
            /(html|:root|:host|@theme|@import\s+["']tailwindcss|@tailwind)/i.test(text) ||
            text.includes('$') ||
            text.includes('@') ||
            text.includes('--') ||
            /^\s*[\w-]+\s*=/m.test(text);
        if (!interesting) {
            this.files.delete(uri.toString());
            return;
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
        this.files.set(uri.toString(), facts);
        void folder;
    }

    private async scanFolders(): Promise<void> {
        this.folders.clear();
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
                new vscode.RelativePattern(folder, '{postcss.config.{js,cjs,mjs,ts},.postcssrc,.postcssrc.{json,js,cjs,yml,yaml}}'),
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
            this.folders.set(folder.uri.toString(), facts);
        }
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
