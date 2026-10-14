import * as vscode from 'vscode';
import { planConversion, planRebase, type LengthFilter } from '../../core/convert';
import { formatNumber } from '../../core/format';
import { ALWAYS_EXCLUDED_GLOB } from '../../core/gitignore';
import { languageForFileName } from '../../core/syntax';
import { LineIndex, type TextEdit } from '../../core/text';
import { lineFilter } from '../git';
import type { Services } from '../services';

interface FileJob {
    uri: vscode.Uri;
    filter?: LengthFilter;
}

const decoder = new TextDecoder();

async function readText(uri: vscode.Uri): Promise<string | undefined> {
    const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (open) {
        return open.getText();
    }
    try {
        return decoder.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
        return undefined;
    }
}

/** Files of the configured types under `base` (or the workspace), minus ignored ones. */
export async function findWorkspaceFiles(services: Services, base?: vscode.Uri, extensions?: string[]): Promise<vscode.Uri[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const out: vscode.Uri[] = [];
    for (const folder of folders) {
        if (base && !base.toString().startsWith(folder.uri.toString())) {
            continue;
        }
        const options = services.config.optionsFor(folder.uri);
        const exts = extensions ?? options.fileTypes;
        if (!exts.length) {
            continue;
        }
        const glob = exts.length === 1 ? `**/*.${exts[0]}` : `**/*.{${exts.join(',')}}`;
        const pattern = base && base.toString() !== folder.uri.toString() ? new vscode.RelativePattern(base, glob) : new vscode.RelativePattern(folder, glob);
        const uris = await vscode.workspace.findFiles(pattern, ALWAYS_EXCLUDED_GLOB, options.workspace.maxFiles);
        for (const uri of uris) {
            const languageId = languageForFileName(uri.path);
            if (!languageId || !options.languages.includes(languageId) || services.index.isIgnored(uri, folder, options)) {
                continue;
            }
            out.push(uri);
        }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Plans edits for many files and applies them through VS Code's refactor
 * preview, so every change can be reviewed and undone in one step.
 */
async function applyWithPreview(
    services: Services,
    jobs: FileJob[],
    plan: (text: string, uri: vscode.Uri, languageId: string, filter?: LengthFilter) => TextEdit[],
    label: string,
): Promise<void> {
    if (!jobs.length) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No matching files found.'));
        return;
    }
    const edit = new vscode.WorkspaceEdit();
    let total = 0;
    let files = 0;
    const touched: vscode.Uri[] = [];
    const cancelled = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('PX to REM: analysing {0} files', jobs.length), cancellable: true },
        async (progress, token) => {
            let done = 0;
            for (const job of jobs) {
                if (token.isCancellationRequested) {
                    return true;
                }
                const text = await readText(job.uri);
                const languageId = languageForFileName(job.uri.path);
                if (text !== undefined && languageId) {
                    const edits = plan(text, job.uri, languageId, job.filter);
                    if (edits.length) {
                        const lines = new LineIndex(text);
                        const relative = vscode.workspace.asRelativePath(job.uri);
                        const metadata: vscode.WorkspaceEditEntryMetadata = { needsConfirmation: true, label: relative, description: label };
                        for (const e of edits) {
                            const start = lines.positionAt(e.start);
                            const end = lines.positionAt(e.end);
                            edit.replace(job.uri, new vscode.Range(start.line, start.character, end.line, end.character), e.newText, metadata);
                        }
                        total += edits.length;
                        files++;
                        touched.push(job.uri);
                    }
                }
                done++;
                progress.report({ increment: 100 / jobs.length, message: `${done}/${jobs.length}` });
                if (done % 25 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }
            return false;
        },
    );
    if (cancelled) {
        return;
    }
    if (!total) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No px values to convert in {0} files.', jobs.length));
        return;
    }
    const applied = await vscode.workspace.applyEdit(edit, { isRefactoring: true });
    if (!applied) {
        return;
    }
    if (services.config.optionsFor(touched[0]).workspace.saveAfterConvert) {
        for (const uri of touched) {
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
            await doc?.save();
        }
    }
    void vscode.window.showInformationMessage(vscode.l10n.t('{0}: {1} changes in {2} files.', label, total, files));
}

function conversionPlanner(services: Services) {
    return (text: string, uri: vscode.Uri, languageId: string, filter?: LengthFilter) => {
        const { doc, options, ctx } = services.engine.parseText(text, languageId, uri);
        return planConversion(doc, options, ctx, filter).edits;
    };
}

type Scope = 'workspace' | 'folder' | 'type' | 'changedFiles' | 'changedLines';

async function convertWorkspace(services: Services, preset?: { scope: Scope; base?: vscode.Uri; extensions?: string[] }): Promise<void> {
    let scope = preset?.scope;
    let base = preset?.base;
    let extensions = preset?.extensions;
    if (!scope) {
        const picked = await vscode.window.showQuickPick(
            [
                { label: vscode.l10n.t('$(files) All files'), description: vscode.l10n.t('Every file of the configured types'), scope: 'workspace' as Scope },
                { label: vscode.l10n.t('$(folder) A folder…'), scope: 'folder' as Scope },
                { label: vscode.l10n.t('$(file-code) Files of one type…'), scope: 'type' as Scope },
                { label: vscode.l10n.t('$(git-commit) Changed files'), description: vscode.l10n.t('Files with uncommitted changes'), scope: 'changedFiles' as Scope },
                { label: vscode.l10n.t('$(diff) Changed lines only'), description: vscode.l10n.t('Only lines changed since the last commit'), scope: 'changedLines' as Scope },
            ],
            { placeHolder: vscode.l10n.t('What should be converted? You can review every change before it is applied.') },
        );
        if (!picked) {
            return;
        }
        scope = picked.scope;
    }

    if (scope === 'folder' && !base) {
        const chosen = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri });
        if (!chosen?.length) {
            return;
        }
        base = chosen[0];
    }
    if (scope === 'type' && !extensions) {
        const types = services.config.optionsFor(undefined).fileTypes;
        const picked = await vscode.window.showQuickPick(types.map(t => ({ label: `.${t}`, ext: t })), {
            placeHolder: vscode.l10n.t('File types to convert'),
            canPickMany: true,
        });
        if (!picked?.length) {
            return;
        }
        extensions = picked.map(p => p.ext);
    }

    let jobs: FileJob[];
    if (scope === 'changedFiles' || scope === 'changedLines') {
        const changed = await services.git.changedFiles();
        const candidates = new Set((await findWorkspaceFiles(services)).map(u => u.toString()));
        jobs = [];
        for (const uri of changed) {
            if (!candidates.has(uri.toString())) {
                continue;
            }
            if (scope === 'changedLines') {
                const lines = await services.git.changedLines(uri);
                jobs.push({ uri, filter: lineFilter(lines) });
            } else {
                jobs.push({ uri });
            }
        }
    } else {
        jobs = (await findWorkspaceFiles(services, base, extensions)).map(uri => ({ uri }));
    }
    await applyWithPreview(services, jobs, conversionPlanner(services), vscode.l10n.t('px → rem'));
}

/** Keeps rendered sizes identical while changing the root font size. */
async function rebase(services: Services): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const info = services.project.infoFor(editor?.document.uri);
    const oldText = await vscode.window.showInputBox({
        title: vscode.l10n.t('Rebase rem values (1/2)'),
        prompt: vscode.l10n.t('Current root font size in px (what 1rem is today)'),
        value: formatNumber(info.context.rootFontSize, { precision: 4, leadingZero: true }),
        validateInput: v => (Number(v) > 0 ? undefined : vscode.l10n.t('Enter a positive number')),
    });
    if (!oldText) {
        return;
    }
    const newText = await vscode.window.showInputBox({
        title: vscode.l10n.t('Rebase rem values (2/2)'),
        prompt: vscode.l10n.t('New root font size in px (16 is the browser default)'),
        value: '16',
        validateInput: v => (Number(v) > 0 ? undefined : vscode.l10n.t('Enter a positive number')),
    });
    if (!newText) {
        return;
    }
    const oldBase = Number(oldText);
    const newBase = Number(newText);
    const scope = await vscode.window.showQuickPick(
        [
            { label: vscode.l10n.t('Whole workspace'), workspace: true },
            ...(editor ? [{ label: vscode.l10n.t('Current file only'), workspace: false }] : []),
        ],
        { placeHolder: vscode.l10n.t('Rewrite every rem value so pages look exactly the same with a {0}px root', newBase) },
    );
    if (!scope) {
        return;
    }
    const uris = scope.workspace ? await findWorkspaceFiles(services) : [editor!.document.uri];
    await applyWithPreview(
        services,
        uris.map(uri => ({ uri })),
        (text, uri, languageId) => {
            const { doc, options } = services.engine.parseText(text, languageId, uri);
            const plan = planRebase(doc, oldBase, newBase, options);
            return [...plan.edits, ...plan.rootDeclarations];
        },
        vscode.l10n.t('rem rebase {0}px → {1}px', oldBase, newBase),
    );
    const fns = info.context.remFunctions.filter(f => f.base !== undefined && f.base !== newBase);
    if (fns.length) {
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Also update the default base of {0}() in {1} to {2}px.', fns[0].name, fns[0].source?.file ?? '', newBase),
        );
    }
}

export function registerWorkspaceCommands(services: Services): vscode.Disposable[] {
    const reg = vscode.commands.registerCommand;
    return [
        reg('px-to-rem.convertWorkspace', () => convertWorkspace(services)),
        reg('px-to-rem.convertFileType', () => convertWorkspace(services, { scope: 'type' })),
        reg('px-to-rem.convertFolder', async (uri?: vscode.Uri) => {
            if (uri) {
                try {
                    if ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File) {
                        return applyWithPreview(services, [{ uri }], conversionPlanner(services), vscode.l10n.t('px → rem'));
                    }
                } catch {
                    // Fall through to folder handling.
                }
            }
            return convertWorkspace(services, uri ? { scope: 'folder', base: uri } : { scope: 'folder' });
        }),
        reg('px-to-rem.convertChangedFiles', () => convertWorkspace(services, { scope: 'changedLines' })),
        reg('px-to-rem.rebase', () => rebase(services)),
    ];
}
