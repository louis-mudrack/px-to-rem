import * as vscode from 'vscode';
import type { ProjectContext } from '../core/context';
import { parseDocument, type ParsedDocument } from '../core/document';
import type { Options } from '../core/options';
import { hostForLanguage } from '../core/syntax';
import type { ConfigService } from './config';
import type { ProjectService } from './project';
import type { WorkspaceIndex } from './workspaceIndex';

/** Everything a provider needs for one document. */
export interface DocState {
    document: vscode.TextDocument;
    doc: ParsedDocument;
    options: Options;
    ctx: ProjectContext;
}

interface CacheEntry {
    version: number;
    key: string;
    doc: ParsedDocument;
}

const SUPPORTED_SCHEMES = new Set(['file', 'untitled', 'vscode-vfs', 'vscode-remote', 'vscode-userdata', 'vscode-notebook-cell', 'memfs', 'github', 'vsls']);

/** Shared access to parsed documents, options and project context. */
export class Engine implements vscode.Disposable {
    private readonly cache = new Map<string, CacheEntry>();
    private readonly emitter = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [];
    /** Fires when settings or project facts change and everything should refresh. */
    readonly onDidChange = this.emitter.event;

    constructor(
        readonly config: ConfigService,
        readonly project: ProjectService,
        readonly index: WorkspaceIndex,
    ) {
        this.disposables.push(
            project.onDidChange(() => {
                this.cache.clear();
                this.emitter.fire();
            }),
            vscode.workspace.onDidCloseTextDocument(d => this.cache.delete(d.uri.toString())),
        );
    }

    options(document: vscode.TextDocument): Options {
        return this.config.optionsFor(document.uri, document.languageId);
    }

    /** Whether the extension works in this document at all. */
    isSupported(document: vscode.TextDocument): boolean {
        if (!SUPPORTED_SCHEMES.has(document.uri.scheme) || !hostForLanguage(document.languageId)) {
            return false;
        }
        const options = this.options(document);
        if (!options.languages.includes(document.languageId)) {
            return false;
        }
        if (document.uri.scheme === 'file' || document.uri.scheme === 'vscode-vfs') {
            const folder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (folder && this.index.isIgnored(document.uri, folder, options)) {
                return false;
            }
        }
        return true;
    }

    /** Whether live features (diagnostics, hints, lenses) should run: supported and not too large. */
    isLive(document: vscode.TextDocument): boolean {
        return this.isSupported(document) && document.getText().length <= this.options(document).maxFileSize;
    }

    state(document: vscode.TextDocument): DocState {
        const options = this.options(document);
        const ctx = this.project.contextFor(document.uri);
        const parseOptions = {
            tailwind: !!ctx.tailwind,
            jsObjects: options.js.objectStyles && !ctx.reactNative,
            jsUnitlessNumbers: options.js.unitlessNumbers && !ctx.reactNative,
            jsTemplates: options.js.templateLiterals,
        };
        const key = JSON.stringify(parseOptions) + document.languageId;
        const uri = document.uri.toString();
        const cached = this.cache.get(uri);
        let doc: ParsedDocument;
        if (cached && cached.version === document.version && cached.key === key) {
            doc = cached.doc;
        } else {
            doc = parseDocument(document.getText(), document.languageId, parseOptions);
            this.cache.set(uri, { version: document.version, key, doc });
        }
        return { document, doc, options, ctx };
    }

    /** Parses text that is not an open document (workspace operations, paste). */
    parseText(text: string, languageId: string, uri: vscode.Uri | undefined): { doc: ParsedDocument; options: Options; ctx: ProjectContext } {
        const options = this.config.optionsFor(uri, languageId);
        const ctx = this.project.contextFor(uri);
        const doc = parseDocument(text, languageId, {
            tailwind: !!ctx.tailwind,
            jsObjects: options.js.objectStyles && !ctx.reactNative,
            jsUnitlessNumbers: options.js.unitlessNumbers && !ctx.reactNative,
            jsTemplates: options.js.templateLiterals,
        });
        return { doc, options, ctx };
    }

    dispose(): void {
        this.emitter.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

/** Converts core offsets to a VS Code range. */
export function toRange(document: vscode.TextDocument, start: number, end: number): vscode.Range {
    return new vscode.Range(document.positionAt(start), document.positionAt(end));
}
