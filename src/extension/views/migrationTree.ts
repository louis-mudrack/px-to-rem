import * as vscode from 'vscode';
import type { FileStats } from '../../core/analyze';
import type { Services } from '../services';
import type { StatsService, TrendPoint } from '../stats';

type Node = { kind: 'summary' } | { kind: 'file'; stats: FileStats; uri: vscode.Uri } | { kind: 'loading' } | { kind: 'done' };

function percent(n: number): string {
    return `${Math.round(n * 100)}%`;
}

function trendText(trend: TrendPoint[], score: number): string | undefined {
    const today = new Date().toISOString().slice(0, 10);
    const previous = [...trend].reverse().find(p => p.date !== today);
    if (!previous) {
        return undefined;
    }
    const delta = Math.round((score - previous.score) * 100);
    if (delta === 0) {
        return vscode.l10n.t('unchanged since {0}', previous.date);
    }
    return delta > 0 ? vscode.l10n.t('+{0} points since {1}', delta, previous.date) : vscode.l10n.t('{0} points since {1}', delta, previous.date);
}

/** Explorer view: files with px values left and the share of scalable units. */
class MigrationTreeProvider implements vscode.TreeDataProvider<Node> {
    private readonly emitter = new vscode.EventEmitter<Node | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;
    private visible = false;

    constructor(private readonly stats: StatsService) {
        stats.onDidChange(() => {
            if (this.visible) {
                this.emitter.fire(undefined);
            }
        });
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        if (visible) {
            this.emitter.fire(undefined);
        }
    }

    refresh(): void {
        this.emitter.fire(undefined);
    }

    async getChildren(element?: Node): Promise<Node[]> {
        if (element) {
            return [];
        }
        const current = this.stats.current;
        if (!current) {
            void this.stats.compute().then(() => this.emitter.fire(undefined));
            return [{ kind: 'loading' }];
        }
        const files = current.stats.filter(s => s.convertible > 0).sort((a, b) => b.convertible - a.convertible || a.file.localeCompare(b.file));
        const nodes: Node[] = files.flatMap(stats => {
            const uri = resolveRelative(stats.file);
            return uri ? [{ kind: 'file' as const, stats, uri }] : [];
        });
        return [{ kind: 'summary' }, ...(nodes.length ? nodes : [{ kind: 'done' as const }])];
    }

    getTreeItem(node: Node): vscode.TreeItem {
        switch (node.kind) {
            case 'loading': {
                const item = new vscode.TreeItem(vscode.l10n.t('Scanning workspace…'));
                item.iconPath = new vscode.ThemeIcon('loading~spin');
                return item;
            }
            case 'done': {
                const item = new vscode.TreeItem(vscode.l10n.t('No px values left to convert'));
                item.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
                return item;
            }
            case 'summary': {
                const { report } = this.stats.current!;
                const item = new vscode.TreeItem(vscode.l10n.t('{0} scalable', percent(report.score)));
                item.description = vscode.l10n.t('{0} px left in {1} files', report.convertible, this.stats.current!.stats.filter(s => s.convertible).length);
                const trend = trendText(this.stats.trend, report.score);
                const md = new vscode.MarkdownString();
                md.appendMarkdown(
                    vscode.l10n.t(
                        '**{0}** of lengths already scale with the user font size ({1} scalable, {2} px left, {3} px kept on purpose).',
                        percent(report.score),
                        report.scalable,
                        report.convertible,
                        report.kept,
                    ),
                );
                if (trend) {
                    md.appendMarkdown(`\n\n${trend}`);
                }
                item.tooltip = md;
                item.iconPath = new vscode.ThemeIcon('graph');
                item.command = { title: '', command: 'px-to-rem.openDashboard' };
                return item;
            }
            case 'file': {
                const s = node.stats;
                const item = new vscode.TreeItem(node.uri);
                const total = s.convertible + s.scalable;
                item.description = vscode.l10n.t('{0} px · {1}', s.convertible, percent(total ? s.scalable / total : 1));
                item.tooltip = vscode.l10n.t('{0}: {1} px values to convert, {2} kept on purpose, {3} scalable', s.file, s.convertible, s.kept, s.scalable);
                item.contextValue = 'pxToRemFile';
                item.command = { title: '', command: 'vscode.open', arguments: [node.uri] };
                return item;
            }
        }
    }
}

/** Resolves a path from `asRelativePath` (prefixed with the folder name in multi-root workspaces). */
export function resolveRelative(relative: string): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 1) {
        return vscode.Uri.joinPath(folders[0].uri, relative);
    }
    const [name, ...rest] = relative.split('/');
    const folder = folders.find(f => f.name === name);
    return folder ? vscode.Uri.joinPath(folder.uri, rest.join('/')) : undefined;
}

export function registerMigrationView(_services: Services, stats: StatsService): vscode.Disposable[] {
    const provider = new MigrationTreeProvider(stats);
    const view = vscode.window.createTreeView('pxToRem.migration', { treeDataProvider: provider, showCollapseAll: false });
    provider.setVisible(view.visible);
    return [
        view,
        view.onDidChangeVisibility(e => provider.setVisible(e.visible)),
        vscode.commands.registerCommand('px-to-rem.migration.refresh', () => {
            void stats.compute().then(() => provider.refresh());
        }),
        vscode.commands.registerCommand('px-to-rem.migration.convertFile', (node?: Node) =>
            vscode.commands.executeCommand('px-to-rem.convertFolder', node?.kind === 'file' ? node.uri : undefined),
        ),
    ];
}
