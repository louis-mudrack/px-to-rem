import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function parseBaseFontSize(
    workspaceFolder: vscode.WorkspaceFolder,
    filePath: string,
    variableName: string
): Promise<number | null> {
    try {
        const fullPath = path.join(workspaceFolder.uri.fsPath, filePath);
        
        if (!fs.existsSync(fullPath)) {
            console.warn(`baseFontSize file not found: ${fullPath}`);
            return null;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        
        if (variableName.startsWith('$')) {
            const scssPattern = new RegExp(
                `\\${variableName}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`,
                'i'
            );
            const match = content.match(scssPattern);
            if (match) {
                return parseFloat(match[1]);
            }
        }
        
        if (variableName.startsWith('--')) {
            const cssPattern = new RegExp(
                `${variableName}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`,
                'i'
            );
            const match = content.match(cssPattern);
            if (match) {
                return parseFloat(match[1]);
            }
        }

        console.warn(`Variable ${variableName} not found in ${fullPath}`);
        return null;
    } catch (error) {
        console.error(`Error parsing baseFontSize from ${filePath}:`, error);
        return null;
    }
}

export function watchBaseFontSizeFile(
    workspaceFolder: vscode.WorkspaceFolder,
    filePath: string,
    onChange: (newValue: number) => void
): vscode.FileSystemWatcher {
    const fullPath = path.join(workspaceFolder.uri.fsPath, filePath);
    const watcher = vscode.workspace.createFileSystemWatcher(fullPath);

    watcher.onDidChange(() => {
        const config = vscode.workspace.getConfiguration('pxToRem');
        const variableName = config.get<string>('baseFontSizeVariable', '$base-font-size');
        
        parseBaseFontSize(workspaceFolder, filePath, variableName).then(value => {
            if (value !== null) {
                onChange(value);
            }
        });
    });

    return watcher;
}
