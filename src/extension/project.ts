import * as vscode from 'vscode';
import { createContext, type ProjectContext } from '../core/context';
import { chooseRootFontSize } from '../core/detect';
import { DEFAULT_TAILWIND, type TailwindConfig } from '../core/tailwind';
import { TokenIndex, type TokenDef } from '../core/tokens';
import type { ConfigService } from './config';
import type { FileFacts, WorkspaceIndex } from './workspaceIndex';

export interface ProjectInfo {
    context: ProjectContext;
    /** Several different root font sizes were found. */
    rootAmbiguous: boolean;
    /** Tailwind found in the project (independent of the setting). */
    tailwindDetected: boolean;
    /** postcss-pxtorem converts at build time. */
    buildTimeConversion: boolean;
}

/** Tokens were indexed at a 16px root; rescale rem-based ones to the real root. */
function rescale(token: TokenDef, root: number): TokenDef {
    if (token.px === undefined || root === 16 || !/rem\b/i.test(token.rawValue)) {
        return token;
    }
    return { ...token, px: (token.px * root) / 16 };
}

function pickTokenFiles(files: FileFacts[], explicitSources: boolean): FileFacts[] {
    if (explicitSources) {
        return files.filter(f => f.tokens.length);
    }
    // Auto-detection: files that look like token files, or define many tokens.
    return files.filter(f => f.tokens.length && (f.looksLikeTokenFile || f.tokens.length >= 8));
}

/** Builds the ProjectContext of each workspace folder from the index and the settings. */
export class ProjectService implements vscode.Disposable {
    private readonly cache = new Map<string, ProjectInfo>();
    private readonly emitter = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [];
    readonly onDidChange = this.emitter.event;

    constructor(
        private readonly config: ConfigService,
        private readonly index: WorkspaceIndex,
    ) {
        this.disposables.push(
            config.onDidChange(() => this.invalidate()),
            index.onDidChange(() => this.invalidate()),
        );
    }

    private invalidate(): void {
        this.cache.clear();
        this.emitter.fire();
    }

    infoFor(uri: vscode.Uri | undefined): ProjectInfo {
        const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
        const key = folder?.uri.toString() ?? '';
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const options = this.config.optionsFor(folder?.uri);
        const files = this.index.filesIn(folder);
        const folderFacts = this.index.folderFacts(folder);

        let rootFontSize = options.baseFontSize;
        let rootFontSizeSource: ProjectContext['rootFontSizeSource'];
        let rootAmbiguous = false;
        if (options.baseFontSizeDetection === 'auto') {
            const chosen = chooseRootFontSize({
                explicit: this.config.explicitBaseFontSize(folder?.uri),
                postcss: folderFacts?.postcss,
                candidates: files.flatMap(f => f.rootCandidates),
                fallback: options.baseFontSize,
            });
            rootFontSize = chosen.px;
            rootFontSizeSource = chosen.source;
            rootAmbiguous = chosen.ambiguous;
        }

        const tokens = options.tokens.enable
            ? pickTokenFiles(files, options.tokens.sources.length > 0).flatMap(f => f.tokens.map(t => rescale(t, rootFontSize)))
            : [];

        const packages = folderFacts?.packages ?? [];
        const tailwindVersion = packages.find(p => p.tailwindVersion)?.tailwindVersion;
        const tailwindCss = files.filter(f => f.tailwind?.present);
        const tailwindDetected = !!tailwindVersion || tailwindCss.length > 0 || !!folderFacts?.tailwindConfigFile;
        let tailwind: TailwindConfig | undefined;
        if (options.tailwind.enable === 'on' || (options.tailwind.enable === 'auto' && tailwindDetected)) {
            tailwind = { ...DEFAULT_TAILWIND, version: tailwindVersion ?? (folderFacts?.tailwindConfigFile ? 3 : 4) };
            for (const partial of [folderFacts?.tailwindJs, ...tailwindCss.map(f => f.tailwind?.config)]) {
                if (partial) {
                    tailwind = {
                        ...tailwind,
                        ...partial,
                        fontSizes: { ...tailwind.fontSizes, ...partial.fontSizes },
                        spacing: { ...tailwind.spacing, ...partial.spacing },
                    };
                }
            }
        }

        const context = createContext(options, {
            rootFontSize,
            rootFontSizeSource,
            remFunctions: files.flatMap(f => f.remFunctions),
            tokens: new TokenIndex(tokens),
            tailwind,
            reactNative: packages.some(p => p.reactNative),
        });
        const info: ProjectInfo = {
            context,
            rootAmbiguous,
            tailwindDetected,
            buildTimeConversion: !!folderFacts?.postcss || packages.some(p => p.postcssPxToRem),
        };
        this.cache.set(key, info);
        return info;
    }

    contextFor(uri: vscode.Uri | undefined): ProjectContext {
        return this.infoFor(uri).context;
    }

    dispose(): void {
        this.emitter.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
