import * as vscode from 'vscode';
import { CodeActionsProvider } from './codeActions';
import { CodeLensProvider } from './codeLens';
import { registerEditingCommands } from './commands/editing';
import { registerFluidCommands } from './commands/fluid';
import { registerMenuCommands } from './commands/menu';
import { registerSetupCommands } from './commands/setup';
import { registerWorkspaceCommands } from './commands/workspace';
import { CompletionProvider } from './completion';
import { ConfigService } from './config';
import { DiagnosticsController } from './diagnostics';
import { Engine } from './engine';
import { GitService } from './git';
import { HoverProvider } from './hover';
import { InlayHintsProvider } from './inlayHints';
import { PASTE_KIND, PasteProvider } from './paste';
import { ProjectService } from './project';
import { registerSaveHandler } from './saveHandler';
import type { Services } from './services';
import { StatsService } from './stats';
import { StatusBar } from './statusBar';
import { registerDashboard } from './views/dashboard';
import { registerMigrationView } from './views/migrationTree';
import { WorkspaceIndex } from './workspaceIndex';

/** Languages the providers are registered for; `pxToRem.languages` narrows this per document. */
const SELECTOR: vscode.DocumentSelector = [
    'css',
    'postcss',
    'tailwindcss',
    'scss',
    'sass',
    'less',
    'stylus',
    'html',
    'vue',
    'svelte',
    'astro',
    'php',
    'blade',
    'twig',
    'handlebars',
    'erb',
    'razor',
    'liquid',
    'mdx',
    'javascript',
    'typescript',
    'javascriptreact',
    'typescriptreact',
].map(language => ({ language }));

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const config = new ConfigService();
    await config.initialize();
    const index = new WorkspaceIndex(config);
    const project = new ProjectService(config, index);
    const engine = new Engine(config, project, index);
    const git = new GitService();
    const diagnostics = new DiagnosticsController(engine, git);
    const services: Services = { context, config, index, project, engine, git, diagnostics };
    const stats = new StatsService(services);

    context.subscriptions.push(config, index, project, engine, git, diagnostics, stats);
    context.subscriptions.push(
        new StatusBar(engine),
        vscode.languages.registerCodeActionsProvider(SELECTOR, new CodeActionsProvider(engine, diagnostics), CodeActionsProvider.metadata),
        vscode.languages.registerHoverProvider(SELECTOR, new HoverProvider(engine)),
        vscode.languages.registerInlayHintsProvider(SELECTOR, new InlayHintsProvider(engine)),
        vscode.languages.registerCodeLensProvider(SELECTOR, new CodeLensProvider(engine)),
        vscode.languages.registerCompletionItemProvider(SELECTOR, new CompletionProvider(engine), ...CompletionProvider.triggerCharacters),
        vscode.languages.registerDocumentPasteEditProvider(SELECTOR, new PasteProvider(engine), {
            providedPasteEditKinds: [PASTE_KIND],
            pasteMimeTypes: ['text/plain'],
        }),
        registerSaveHandler(engine, git),
        ...registerEditingCommands(services),
        ...registerWorkspaceCommands(services),
        ...registerFluidCommands(services),
        ...registerSetupCommands(services),
        ...registerMenuCommands(services),
        ...registerMigrationView(services, stats),
        ...registerDashboard(services, stats),
    );

    index.start();
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
