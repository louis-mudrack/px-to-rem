import * as vscode from 'vscode';
import { planConversion } from '../core/convert';
import { toRange, type Engine } from './engine';
import type { GitService } from './git';
import { lineFilter } from './git';

/** `pxToRem.convertOnSave`: converts px values as part of saving (honours the git-aware scope). */
export function registerSaveHandler(engine: Engine, git: GitService): vscode.Disposable {
    return vscode.workspace.onWillSaveTextDocument(event => {
        const document = event.document;
        if (event.reason === vscode.TextDocumentSaveReason.AfterDelay || !engine.isSupported(document)) {
            return;
        }
        const options = engine.options(document);
        if (!options.convertOnSave) {
            return;
        }
        event.waitUntil(
            (async () => {
                const state = engine.state(document);
                const filter = options.diagnostics.scope === 'changedLines' ? lineFilter(await git.changedLines(document.uri)) : undefined;
                const plan = planConversion(state.doc, state.options, state.ctx, filter);
                return plan.edits.map(e => vscode.TextEdit.replace(toRange(document, e.start, e.end), e.newText));
            })(),
        );
    });
}
