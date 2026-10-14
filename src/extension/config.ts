import { minimatch } from 'minimatch';
import * as vscode from 'vscode';
import { parseJsonc } from '../core/jsonc';
import {
    applyConfigFile,
    applyOptions,
    defaultOptions,
    flattenOptions,
    legacyLayer,
    OPTION_DEFS,
    type ConfigFile,
    type LegacySettings,
    type Options,
} from '../core/options';

export const CONFIG_FILE_NAMES = ['.pxtoremrc.json', '.pxtoremrc', 'pxtorem.config.json'];
const CONFIG_GLOB = `{${CONFIG_FILE_NAMES.join(',')}}`;

interface LoadedConfig {
    uri: vscode.Uri;
    config?: ConfigFile;
    error?: string;
}

/** Glob test used for `excludeFiles` and config-file overrides. */
export function globMatch(path: string, glob: string): boolean {
    return minimatch(path, glob, { dot: true, matchBase: !glob.includes('/'), nocase: true });
}

/**
 * Resolves options per document: defaults → VS Code settings (all scopes,
 * language-specific values included) → pre-2.0 settings → `.pxtoremrc.json`
 * → matching `overrides`.
 */
export class ConfigService implements vscode.Disposable {
    private readonly files = new Map<string, LoadedConfig>();
    private readonly cache = new Map<string, Options>();
    private readonly emitter = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [];
    readonly onDidChange = this.emitter.event;

    async initialize(): Promise<void> {
        await this.loadAll();
        const watcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_GLOB}`);
        const reload = () => void this.loadAll().then(() => this.changed());
        this.disposables.push(
            watcher,
            watcher.onDidCreate(reload),
            watcher.onDidChange(reload),
            watcher.onDidDelete(reload),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('pxToRem')) {
                    this.changed();
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(reload),
        );
    }

    private changed(): void {
        this.cache.clear();
        this.emitter.fire();
    }

    private async loadAll(): Promise<void> {
        this.files.clear();
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            for (const name of CONFIG_FILE_NAMES) {
                const uri = vscode.Uri.joinPath(folder.uri, name);
                try {
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    const parsed = parseJsonc(new TextDecoder().decode(bytes));
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        this.files.set(folder.uri.toString(), { uri, config: parsed as ConfigFile });
                    } else {
                        this.files.set(folder.uri.toString(), { uri, error: 'invalid' });
                    }
                    break;
                } catch {
                    // Not present: try the next name.
                }
            }
        }
    }

    /** The config file of the workspace folder containing `uri`, if any. */
    configFileFor(uri: vscode.Uri | undefined): LoadedConfig | undefined {
        const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
        return folder ? this.files.get(folder.uri.toString()) : undefined;
    }

    optionsFor(uri: vscode.Uri | undefined, languageId?: string): Options {
        const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
        const loaded = folder ? this.files.get(folder.uri.toString()) : undefined;
        const relativePath = uri && folder ? vscode.workspace.asRelativePath(uri, false) : undefined;
        const usesOverrides = !!loaded?.config?.overrides?.length;
        const key = `${folder?.uri.toString() ?? ''}|${languageId ?? ''}|${usesOverrides ? relativePath ?? '' : ''}`;
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }

        const scope: vscode.ConfigurationScope | undefined = languageId ? { uri: uri ?? folder?.uri, languageId } : (uri ?? folder?.uri);
        const settings = vscode.workspace.getConfiguration('pxToRem', scope);
        const layer: Record<string, unknown> = {};
        const legacy: Record<string, unknown> = {};
        const explicit = new Set<string>();
        for (const def of OPTION_DEFS) {
            const inspected = settings.inspect(def.key);
            if (!inspected) {
                continue;
            }
            const isSet =
                inspected.globalValue !== undefined ||
                inspected.workspaceValue !== undefined ||
                inspected.workspaceFolderValue !== undefined ||
                inspected.globalLanguageValue !== undefined ||
                inspected.workspaceLanguageValue !== undefined ||
                inspected.workspaceFolderLanguageValue !== undefined;
            if (!isSet) {
                continue;
            }
            const value = settings.get(def.key);
            if (def.deprecated) {
                legacy[def.key] = value;
            } else {
                layer[def.key] = value;
                explicit.add(def.key);
            }
        }

        let options = applyOptions(defaultOptions(), layer);
        if (loaded?.config) {
            for (const k of Object.keys(flattenOptions(loaded.config))) {
                explicit.add(k);
            }
        }
        options = applyOptions(options, legacyLayer(legacy as LegacySettings, explicit));
        options = applyConfigFile(options, loaded?.config, relativePath, globMatch);
        this.cache.set(key, options);
        return options;
    }

    /** baseFontSize when the user set it explicitly (settings or config file); detection must not override it. */
    explicitBaseFontSize(uri: vscode.Uri | undefined): number | undefined {
        const loaded = this.configFileFor(uri);
        const fromFile = loaded?.config ? flattenOptions(loaded.config).baseFontSize : undefined;
        if (typeof fromFile === 'number') {
            return fromFile;
        }
        const inspected = vscode.workspace.getConfiguration('pxToRem', uri).inspect<number>('baseFontSize');
        return inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
    }

    /** Whether a file is excluded by `excludeFiles`. */
    isExcluded(uri: vscode.Uri, options: Options): boolean {
        if (!options.excludeFiles.length) {
            return false;
        }
        const relative = vscode.workspace.asRelativePath(uri, false);
        return options.excludeFiles.some(glob => globMatch(relative, glob));
    }

    dispose(): void {
        this.emitter.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
