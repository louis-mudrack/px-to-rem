import type * as vscode from 'vscode';
import type { ConfigService } from './config';
import type { DiagnosticsController } from './diagnostics';
import type { Engine } from './engine';
import type { GitService } from './git';
import type { ProjectService } from './project';
import type { WorkspaceIndex } from './workspaceIndex';

/** Everything commands and views need. */
export interface Services {
    context: vscode.ExtensionContext;
    config: ConfigService;
    index: WorkspaceIndex;
    project: ProjectService;
    engine: Engine;
    git: GitService;
    diagnostics: DiagnosticsController;
}
