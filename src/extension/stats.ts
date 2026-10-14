import * as vscode from 'vscode';
import { analyzeDocument, buildReport, type FileStats, type WorkspaceReport } from '../core/analyze';
import { languageForFileName } from '../core/syntax';
import { findWorkspaceFiles } from './commands/workspace';
import type { Services } from './services';

export interface TrendPoint {
    /** YYYY-MM-DD */
    date: string;
    convertible: number;
    scalable: number;
    score: number;
}

const TREND_KEY = 'pxToRem.trend';
const MAX_TREND = 180;

interface CacheEntry {
    stamp: string;
    stats: FileStats;
}

const decoder = new TextDecoder();

/** Workspace-wide statistics (migration view, dashboard) with per-file caching and a daily trend. */
export class StatsService implements vscode.Disposable {
    private readonly cache = new Map<string, CacheEntry>();
    private generation = 0;
    private running: Promise<{ stats: FileStats[]; report: WorkspaceReport }> | undefined;
    private latest: { stats: FileStats[]; report: WorkspaceReport } | undefined;
    private readonly emitter = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [];
    readonly onDidChange = this.emitter.event;

    constructor(private readonly services: Services) {
        this.disposables.push(
            services.engine.onDidChange(() => {
                this.generation++;
                this.invalidate();
            }),
            vscode.workspace.onDidSaveTextDocument(() => this.invalidate()),
            vscode.workspace.onDidDeleteFiles(() => this.invalidate()),
            vscode.workspace.onDidCreateFiles(() => this.invalidate()),
        );
    }

    private invalidateTimer: ReturnType<typeof setTimeout> | undefined;
    private invalidate(): void {
        this.latest = undefined;
        if (this.invalidateTimer) {
            clearTimeout(this.invalidateTimer);
        }
        this.invalidateTimer = setTimeout(() => this.emitter.fire(), 500);
    }

    get current(): { stats: FileStats[]; report: WorkspaceReport } | undefined {
        return this.latest;
    }

    /** Computes (or returns cached) statistics for the whole workspace. */
    compute(token?: vscode.CancellationToken): Promise<{ stats: FileStats[]; report: WorkspaceReport }> {
        if (this.latest) {
            return Promise.resolve(this.latest);
        }
        if (!this.running) {
            this.running = this.run(token).finally(() => {
                this.running = undefined;
            });
        }
        return this.running;
    }

    private async run(token?: vscode.CancellationToken): Promise<{ stats: FileStats[]; report: WorkspaceReport }> {
        await this.services.index.whenReady();
        const uris = await findWorkspaceFiles(this.services);
        const stats: FileStats[] = [];
        let n = 0;
        for (const uri of uris) {
            if (token?.isCancellationRequested) {
                break;
            }
            const entry = await this.statsFor(uri);
            if (entry) {
                stats.push(entry);
            }
            if (++n % 30 === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }
        const options = this.services.config.optionsFor(vscode.workspace.workspaceFolders?.[0]?.uri);
        const report = buildReport(stats, options);
        this.latest = { stats, report };
        await this.recordTrend(report);
        return this.latest;
    }

    private async statsFor(uri: vscode.Uri): Promise<FileStats | undefined> {
        const languageId = languageForFileName(uri.path);
        if (!languageId) {
            return undefined;
        }
        const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
        let stamp: string;
        if (open) {
            stamp = `v${open.version}`;
        } else {
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                stamp = `m${stat.mtime}:${stat.size}`;
            } catch {
                return undefined;
            }
        }
        stamp += `:${this.generation}`;
        const key = uri.toString();
        const cached = this.cache.get(key);
        if (cached && cached.stamp === stamp) {
            return cached.stats;
        }
        let text: string;
        try {
            text = open ? open.getText() : decoder.decode(await vscode.workspace.fs.readFile(uri));
        } catch {
            return undefined;
        }
        const { doc, options, ctx } = this.services.engine.parseText(text, languageId, uri);
        const stats = analyzeDocument(doc, vscode.workspace.asRelativePath(uri, false), options, ctx);
        this.cache.set(key, { stamp, stats });
        return stats;
    }

    get trend(): TrendPoint[] {
        return this.services.context.workspaceState.get<TrendPoint[]>(TREND_KEY, []);
    }

    private async recordTrend(report: WorkspaceReport): Promise<void> {
        const date = new Date().toISOString().slice(0, 10);
        const points = this.trend.filter(p => p.date !== date);
        points.push({ date, convertible: report.convertible, scalable: report.scalable, score: report.score });
        await this.services.context.workspaceState.update(TREND_KEY, points.slice(-MAX_TREND));
    }

    dispose(): void {
        this.emitter.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
