import * as vscode from 'vscode';
import { MESSAGES, type MessageId } from '../core/messages';

/** Localizes an engine message; string arguments that are message ids are localized too. */
export function msg(id: MessageId, ...args: (string | number)[]): string {
    const localizedArgs = args.map(a => (typeof a === 'string' && a in MESSAGES ? vscode.l10n.t(MESSAGES[a as MessageId]) : a));
    return vscode.l10n.t(MESSAGES[id], ...localizedArgs);
}
