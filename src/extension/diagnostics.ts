import * as vscode from 'vscode';
import { audit, ruleUrl, type Finding } from '../core/audit';
import type { Engine } from './engine';
import { toRange } from './engine';
import type { GitService } from './git';
import { msg } from './l10n';

const SEVERITY: Record<Finding['severity'], vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    information: vscode.DiagnosticSeverity.Information,
    hint: vscode.DiagnosticSeverity.Hint,
};

/** Runs the audit on open documents and publishes diagnostics. */
export class DiagnosticsController implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('px-to-rem');
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Findings per document, for quick fixes. */
    private readonly findings = new Map<string, { version: number; findings: Finding[] }>();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly engine: Engine,
        private readonly git: GitService,
    ) {
        this.disposables.push(
            this.collection,
            vscode.workspace.onDidOpenTextDocument(d => this.schedule(d, 0)),
            vscode.workspace.onDidChangeTextDocument(e => this.schedule(e.document)),
            vscode.workspace.onDidCloseTextDocument(d => {
                this.collection.delete(d.uri);
                this.findings.delete(d.uri.toString());
            }),
            engine.onDidChange(() => this.refreshAll()),
            git.onDidChange(() => this.refreshAll(true)),
        );
        this.refreshAll();
    }

    refreshAll(onlyChangedLineScope = false): void {
        for (const document of vscode.workspace.textDocuments) {
            if (onlyChangedLineScope && this.engine.isSupported(document) && this.engine.options(document).diagnostics.scope !== 'changedLines') {
                continue;
            }
            this.schedule(document, 0);
        }
    }

    private schedule(document: vscode.TextDocument, delay = 300): void {
        const key = document.uri.toString();
        const existing = this.timers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        this.timers.set(
            key,
            setTimeout(() => {
                this.timers.delete(key);
                void this.update(document);
            }, delay),
        );
    }

    private async update(document: vscode.TextDocument): Promise<void> {
        if (document.isClosed) {
            return;
        }
        if (!this.engine.isLive(document)) {
            this.collection.delete(document.uri);
            this.findings.delete(document.uri.toString());
            return;
        }
        const version = document.version;
        const state = this.engine.state(document);
        let lines: Set<number> | undefined;
        if (state.options.diagnostics.scope === 'changedLines') {
            const changed = await this.git.changedLines(document.uri);
            lines = changed instanceof Set ? changed : undefined;
        }
        if (document.version !== version) {
            return;
        }
        const findings = audit(state.doc, state.options, state.ctx, { projectReady: this.engine.index.ready, lines });
        this.findings.set(document.uri.toString(), { version, findings });
        this.collection.set(
            document.uri,
            findings.map(f => {
                const diagnostic = new vscode.Diagnostic(toRange(document, f.start, f.end), msg(f.message, ...f.args), SEVERITY[f.severity]);
                diagnostic.source = 'px-to-rem';
                diagnostic.code = { value: f.rule, target: vscode.Uri.parse(ruleUrl(f.rule)) };
                return diagnostic;
            }),
        );
    }

    /** Findings of the current document version that intersect a range. */
    findingsAt(document: vscode.TextDocument, range: vscode.Range): Finding[] {
        const entry = this.findings.get(document.uri.toString());
        if (!entry || entry.version !== document.version) {
            return [];
        }
        const start = document.offsetAt(range.start);
        const end = document.offsetAt(range.end);
        return entry.findings.filter(f => f.start <= end && start <= f.end);
    }

    dispose(): void {
        for (const t of this.timers.values()) {
            clearTimeout(t);
        }
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
