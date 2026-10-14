import * as vscode from 'vscode';
import { changedLinesFromDiff } from '../core/gitDiff';
import { changedLinesBetween } from '../core/lineDiff';

// Minimal typing of the built-in Git extension API (vscode.git, API version 1).
interface GitChange {
    readonly uri: vscode.Uri;
    readonly status: number;
}
interface GitRepositoryState {
    readonly workingTreeChanges: GitChange[];
    readonly indexChanges: GitChange[];
    readonly untrackedChanges?: GitChange[];
    readonly onDidChange: vscode.Event<void>;
}
interface GitRepository {
    readonly rootUri: vscode.Uri;
    readonly state: GitRepositoryState;
    diffWithHEAD(path: string): Promise<string>;
    show(ref: string, path: string): Promise<string>;
}
interface GitAPI {
    readonly repositories: GitRepository[];
    getRepository(uri: vscode.Uri): GitRepository | null;
    readonly onDidOpenRepository: vscode.Event<GitRepository>;
}
interface GitExtension {
    readonly enabled: boolean;
    getAPI(version: 1): GitAPI;
}

const UNTRACKED = 7;
const INTENT_TO_ADD = 9;
const ADDED = 1;

/** `'all'`: the file is new. `undefined`: git is unavailable or the file is not in a repository. */
export type ChangedLines = Set<number> | 'all' | undefined;

/** Lines changed since HEAD, via the built-in Git extension (absent on vscode.dev without a repo). */
export class GitService implements vscode.Disposable {
    private api: GitAPI | undefined;
    private readonly cache = new Map<string, { stamp: number; version: number; lines: ChangedLines }>();
    private stamp = 0;
    private readonly emitter = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [];
    readonly onDidChange = this.emitter.event;

    private async getApi(): Promise<GitAPI | undefined> {
        if (this.api) {
            return this.api;
        }
        const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!ext) {
            return undefined;
        }
        try {
            const exports = ext.isActive ? ext.exports : await ext.activate();
            if (!exports?.enabled) {
                return undefined;
            }
            this.api = exports.getAPI(1);
            const watch = (repo: GitRepository) => {
                this.disposables.push(
                    repo.state.onDidChange(() => {
                        this.stamp++;
                        this.cache.clear();
                        this.emitter.fire();
                    }),
                );
            };
            this.api.repositories.forEach(watch);
            this.disposables.push(this.api.onDidOpenRepository(watch));
            return this.api;
        } catch {
            return undefined;
        }
    }

    async available(uri: vscode.Uri): Promise<boolean> {
        const api = await this.getApi();
        return !!api?.getRepository(uri);
    }

    /**
     * Lines changed relative to HEAD. For open documents the editor content is
     * compared (unsaved edits count); otherwise the file on disk.
     */
    async changedLines(uri: vscode.Uri): Promise<ChangedLines> {
        const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
        const key = uri.toString();
        const version = document?.version ?? -1;
        const cached = this.cache.get(key);
        if (cached && cached.stamp === this.stamp && cached.version === version) {
            return cached.lines;
        }
        const api = await this.getApi();
        const repo = api?.getRepository(uri);
        if (!repo) {
            return undefined;
        }
        const all = [...repo.state.workingTreeChanges, ...repo.state.indexChanges, ...(repo.state.untrackedChanges ?? [])];
        const change = all.find(c => c.uri.toString() === key);
        let lines: ChangedLines;
        if (change && (change.status === UNTRACKED || change.status === INTENT_TO_ADD || change.status === ADDED)) {
            lines = 'all';
        } else if (document) {
            try {
                const head = await repo.show('HEAD', uri.fsPath);
                lines = changedLinesBetween(head, document.getText());
            } catch {
                lines = 'all';
            }
        } else if (!change) {
            lines = new Set();
        } else {
            try {
                lines = changedLinesFromDiff(await repo.diffWithHEAD(uri.fsPath));
            } catch {
                lines = undefined;
            }
        }
        this.cache.set(key, { stamp: this.stamp, version, lines });
        return lines;
    }

    /** Files with changes (working tree, index, untracked) in all repositories. */
    async changedFiles(): Promise<vscode.Uri[]> {
        const api = await this.getApi();
        if (!api) {
            return [];
        }
        const seen = new Map<string, vscode.Uri>();
        for (const repo of api.repositories) {
            for (const c of [...repo.state.workingTreeChanges, ...repo.state.indexChanges, ...(repo.state.untrackedChanges ?? [])]) {
                if (c.status !== 6 /* DELETED */) {
                    seen.set(c.uri.toString(), c.uri);
                }
            }
        }
        return [...seen.values()];
    }

    dispose(): void {
        this.emitter.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

/** Builds a line filter for engine operations. */
export function lineFilter(lines: ChangedLines): ((item: { line: number }) => boolean) | undefined {
    if (lines === undefined || lines === 'all') {
        return undefined;
    }
    return item => lines.has(item.line);
}
