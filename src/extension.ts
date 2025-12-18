import * as vscode from 'vscode';
import { minimatch } from 'minimatch';
import type { PxMatch, ExtensionConfig, ConversionStats } from './types';
import { initializeLocale, t, tp } from './i18n';
import { parseBaseFontSize, watchBaseFontSizeFile } from './baseFontSizeParser';

let statusBarItem: vscode.StatusBarItem;
let diagnosticCollection: vscode.DiagnosticCollection;
let dynamicBaseFontSize: number | null = null;
let baseFontSizeWatcher: vscode.FileSystemWatcher | null = null;

function getConfig(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration('pxToRem');
    return {
        preserveZero: config.get<boolean>('preserveZero', false),
        excludePatterns: config.get<string[]>('excludePatterns', []),
        excludeFiles: config.get<string[]>('excludeFiles', []),
        fileTypes: config.get<string[]>('fileTypes', ['css', 'scss', 'sass', 'less']),
        keepPxInRem: config.get<boolean>('keepPxInRem', false),
        scssInterpolation: config.get<boolean>('scssInterpolation', false),
        directConversion: config.get<boolean>('directConversion', false),
        baseFontSize: config.get<number>('baseFontSize', 16),
        minValue: config.get<number>('minValue', 0),
        maxValue: config.get<number>('maxValue', 9999),
        includeProperties: config.get<string[]>('includeProperties', []),
        excludeProperties: config.get<string[]>('excludeProperties', []),
        enableDiagnostics: config.get<boolean>('enableDiagnostics', false),
        enableCodeLens: config.get<boolean>('enableCodeLens', true),
        diagnosticSeverity: config.get<string>('diagnosticSeverity', 'information'),
        enableInlayHints: config.get<boolean>('enableInlayHints', true),
        useDynamicBaseFontSize: config.get<boolean>('useDynamicBaseFontSize', false),
        baseFontSizeFile: config.get<string>('baseFontSizeFile', 'src/styles/variables.scss'),
        baseFontSizeVariable: config.get<string>('baseFontSizeVariable', '$base-font-size')
    };
}

function getActualBaseFontSize(config: ExtensionConfig): number {
    if (config.useDynamicBaseFontSize && dynamicBaseFontSize !== null) {
        return dynamicBaseFontSize;
    }
    return config.baseFontSize;
}

function createExcludeRegexes(patterns: string[]): RegExp[] {
    return patterns.map(pattern => {
        try {
            return new RegExp(pattern);
        } catch (e) {
            return new RegExp('');
        }
    });
}

function shouldSkipLine(line: string, excludeRegexes: RegExp[]): boolean {
    return excludeRegexes.some(regex => regex.test(line));
}

function isInsideRemFunction(text: string, position: number): boolean {
    let openCount = 0;
    let remIndex = -1;
    
    for (let i = position - 1; i >= Math.max(0, position - 100); i--) {
        if (text.substring(i, i + 4) === 'rem(') {
            remIndex = i;
            break;
        }
    }
    
    if (remIndex === -1) {
        return false;
    }
    
    for (let i = remIndex + 4; i < position; i++) {
        if (text[i] === '(') {
            openCount++;
        } else if (text[i] === ')') {
            openCount--;
            if (openCount < 0) {
                return false;
            }
        }
    }
    
    return openCount >= 0;
}

function isInsideCalcFunction(text: string, position: number): boolean {
    let openCount = 0;
    let calcIndex = -1;
    
    for (let i = position - 1; i >= Math.max(0, position - 200); i--) {
        if (text.substring(i, i + 5) === 'calc(') {
            calcIndex = i;
            break;
        }
    }
    
    if (calcIndex === -1) {
        return false;
    }
    
    for (let i = calcIndex + 5; i < position; i++) {
        if (text[i] === '(') {
            openCount++;
        } else if (text[i] === ')') {
            openCount--;
            if (openCount < 0) {
                return false;
            }
        }
    }
    
    return openCount >= 0;
}

function isInsideClampFunction(text: string, position: number): boolean {
    let openCount = 0;
    let clampIndex = -1;
    
    for (let i = position - 1; i >= Math.max(0, position - 200); i--) {
        if (text.substring(i, i + 6) === 'clamp(') {
            clampIndex = i;
            break;
        }
    }
    
    if (clampIndex === -1) {
        return false;
    }
    
    for (let i = clampIndex + 6; i < position; i++) {
        if (text[i] === '(') {
            openCount++;
        } else if (text[i] === ')') {
            openCount--;
            if (openCount < 0) {
                return false;
            }
        }
    }
    
    return openCount >= 0;
}

function shouldConvertProperty(property: string, config: ExtensionConfig): boolean {
    const normalizedProp = property.trim().toLowerCase();
    
    if (config.includeProperties.length > 0) {
        return config.includeProperties.some(p => 
            normalizedProp === p.toLowerCase()
        );
    }
    
    if (config.excludeProperties.length > 0) {
        return !config.excludeProperties.some(p => 
            normalizedProp === p.toLowerCase()
        );
    }
    
    return true;
}

function shouldConvertValue(value: number, config: ExtensionConfig): boolean {
    return value >= config.minValue && value <= config.maxValue;
}

function findPxMatches(text: string, excludeRegexes: RegExp[], config: ExtensionConfig): PxMatch[] {
    const pxRegex = /(-?\d+(?:\.\d+)?)px/g;
    const matches: PxMatch[] = [];
    const lines = text.split('\n');
    
    let currentOffset = 0;
    
    for (const line of lines) {
        if (shouldSkipLine(line, excludeRegexes)) {
            currentOffset += line.length + 1;
            continue;
        }
        
        const propertyMatch = line.match(/^\s*([a-zA-Z-]+)\s*:/);
        const property = propertyMatch ? propertyMatch[1] : '';
        
        if (property && !shouldConvertProperty(property, config)) {
            currentOffset += line.length + 1;
            continue;
        }
        
        let match;
        while ((match = pxRegex.exec(line)) !== null) {
            const value = parseFloat(match[1]);
            const absolutePosition = currentOffset + match.index;
            
            if (!shouldConvertValue(Math.abs(value), config)) {
                continue;
            }
            
            if (isInsideRemFunction(text, absolutePosition)) {
                continue;
            }
            
            const isInCalc = isInsideCalcFunction(text, absolutePosition);
            
            matches.push({
                value: value,
                fullMatch: match[0],
                index: absolutePosition,
                isInCalc: isInCalc
            });
        }
        
        currentOffset += line.length + 1;
    }
    
    return matches;
}

function convertPxValue(value: number, withPx: boolean, config: ExtensionConfig, isInCalc: boolean = false): string {
    if (config.preserveZero && value === 0) {
        return '0';
    }
    
    if (config.directConversion) {
        const remValue = value / getActualBaseFontSize(config);
        return `${remValue}rem`;
    }
    
    const pxSuffix = (withPx || config.keepPxInRem) ? 'px' : '';
    const remCall = `rem(${value}${pxSuffix})`;
    
    if (config.scssInterpolation && isInCalc) {
        return `#{${remCall}}`;
    }
    
    return remCall;
}

function convertPxToRem(forcePxSuffix: boolean = false): void {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
        vscode.window.showErrorMessage(t('messages.noEditor'));
        return;
    }
    
    const config = getConfig();
    const document = editor.document;
    const text = document.getText();
    
    const excludeRegexes = createExcludeRegexes(config.excludePatterns);
    const matches = findPxMatches(text, excludeRegexes, config);
    
    if (matches.length === 0) {
        return;
    }
    
    const startTime = Date.now();
    let skippedCount = 0;
    
    editor.edit((editBuilder: vscode.TextEditorEdit) => {
        matches.reverse().forEach((match: PxMatch) => {
            const range = new vscode.Range(
                document.positionAt(match.index),
                document.positionAt(match.index + match.fullMatch.length)
            );
            
            const replacement = convertPxValue(match.value, forcePxSuffix, config, match.isInCalc);
            editBuilder.replace(range, replacement);
        });
    }).then((success: boolean) => {
        if (success) {
            const duration = Date.now() - startTime;
            const format = forcePxSuffix ? 'rem(Npx)' : config.directConversion ? 'Nrem' : 'rem(N)';
            
            const message = tp('messages.convertedWithStats', matches.length, {
                format,
                skipped: skippedCount.toString(),
                duration: duration.toString()
            });
            
            vscode.window.showInformationMessage(message);
            updateStatusBar();
        } else {
            vscode.window.showErrorMessage(t('messages.conversionError'));
        }
    });
}

function convertSelection(): void {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
        vscode.window.showErrorMessage(t('messages.noEditor'));
        return;
    }
    
    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showInformationMessage(t('messages.noSelection'));
        return;
    }
    
    const config = getConfig();
    const document = editor.document;
    const selectedText = document.getText(selection);
    
    const excludeRegexes = createExcludeRegexes(config.excludePatterns);
    const matches = findPxMatches(selectedText, excludeRegexes, config);
    
    if (matches.length === 0) {
        return;
    }
    
    const startTime = Date.now();
    
    editor.edit((editBuilder: vscode.TextEditorEdit) => {
        matches.reverse().forEach((match: PxMatch) => {
            const absolutePosition = document.offsetAt(selection.start) + match.index;
            const range = new vscode.Range(
                document.positionAt(absolutePosition),
                document.positionAt(absolutePosition + match.fullMatch.length)
            );
            
            const replacement = convertPxValue(match.value, false, config, match.isInCalc);
            editBuilder.replace(range, replacement);
        });
    }).then((success: boolean) => {
        if (success) {
            const duration = Date.now() - startTime;
            const format = config.directConversion ? 'Nrem' : 'rem(N)';
            
            const message = tp('messages.convertedWithStats', matches.length, {
                format,
                skipped: '0',
                duration: duration.toString()
            });
            
            vscode.window.showInformationMessage(message);
            updateStatusBar();
        } else {
            vscode.window.showErrorMessage(t('messages.conversionError'));
        }
    });
}

function findRemMatches(text: string): PxMatch[] {
    const matches: PxMatch[] = [];
    
    const directRemRegex = /(-?\d+(?:\.\d+)?)rem/g;
    const remFunctionRegex = /rem\((-?\d+(?:\.\d+)?)(px)?\)/g;
    const scssInterpolationRegex = /#\{rem\((-?\d+(?:\.\d+)?)(px)?\)\}/g;
    
    let match;
    
    while ((match = directRemRegex.exec(text)) !== null) {
        matches.push({
            value: parseFloat(match[1]),
            fullMatch: match[0],
            index: match.index,
            isInCalc: false
        });
    }
    
    while ((match = remFunctionRegex.exec(text)) !== null) {
        matches.push({
            value: parseFloat(match[1]),
            fullMatch: match[0],
            index: match.index,
            isInCalc: false
        });
    }
    
    while ((match = scssInterpolationRegex.exec(text)) !== null) {
        matches.push({
            value: parseFloat(match[1]),
            fullMatch: match[0],
            index: match.index,
            isInCalc: false
        });
    }
    
    return matches;
}

function reverseConvert(): void {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
        vscode.window.showErrorMessage(t('messages.noEditor'));
        return;
    }
    
    const config = getConfig();
    const document = editor.document;
    const text = document.getText();
    
    const matches = findRemMatches(text);
    
    if (matches.length === 0) {
        return;
    }
    
    editor.edit((editBuilder: vscode.TextEditorEdit) => {
        matches.reverse().forEach((match: PxMatch) => {
            const range = new vscode.Range(
                document.positionAt(match.index),
                document.positionAt(match.index + match.fullMatch.length)
            );
            
            const pxValue = config.directConversion 
                ? Math.round(match.value * getActualBaseFontSize(config))
                : match.value;
            
            const replacement = `${pxValue}px`;
            editBuilder.replace(range, replacement);
        });
    }).then((success: boolean) => {
        if (success) {
            const message = tp('messages.reverseConverted', matches.length);
            vscode.window.showInformationMessage(message);
            updateStatusBar();
        } else {
            vscode.window.showErrorMessage(t('messages.conversionError'));
        }
    });
}

async function convertWorkspace(): Promise<void> {
    const config = getConfig();
    
    const fileTypesPattern = `**/*.{${config.fileTypes.join(',')}}`;
    const files = await vscode.workspace.findFiles(
        fileTypesPattern,
        '**/node_modules/**'
    );
    
    const filteredFiles = files.filter(file => {
        const relativePath = vscode.workspace.asRelativePath(file);
        return !config.excludeFiles.some(pattern => minimatch(relativePath, pattern));
    });
    
    if (filteredFiles.length === 0) {
        vscode.window.showInformationMessage(t('messages.noFilesFound'));
        return;
    }
    
    const answer = await vscode.window.showInformationMessage(
        tp('messages.filesFound', filteredFiles.length),
        t('messages.yes'),
        t('messages.no')
    );
    
    if (answer !== t('messages.yes')) {
        return;
    }
    
    let totalConverted = 0;
    let filesProcessed = 0;
    
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: t('messages.progressTitle'),
        cancellable: false
    }, async (progress, token) => {
        for (const file of filteredFiles) {
            const document = await vscode.workspace.openTextDocument(file);
            const text = document.getText();
            
            const excludeRegexes = createExcludeRegexes(config.excludePatterns);
            const matches = findPxMatches(text, excludeRegexes, config);
            
            if (matches.length > 0) {
                const edit = new vscode.WorkspaceEdit();
                
                matches.forEach((match: PxMatch) => {
                    const range = new vscode.Range(
                        document.positionAt(match.index),
                        document.positionAt(match.index + match.fullMatch.length)
                    );
                    
                    const replacement = convertPxValue(match.value, false, config, match.isInCalc);
                    edit.replace(document.uri, range, replacement);
                });
                
                await vscode.workspace.applyEdit(edit);
                await document.save();
                
                totalConverted += matches.length;
                filesProcessed++;
            }
            
            progress.report({ 
                increment: 100 / filteredFiles.length,
                message: `${filesProcessed}/${filteredFiles.length}` 
            });
        }
    });
    
    const message = tp('messages.workspaceConverted', totalConverted, {
        files: filesProcessed.toString()
    });
    
    vscode.window.showInformationMessage(message);
}

async function convertFileType(): Promise<void> {
    const config = getConfig();
    
    const options = [
        { 
            label: t('messages.allTypes'), 
            value: config.fileTypes 
        },
        { label: 'CSS', value: ['css'] },
        { label: 'SCSS', value: ['scss'] },
        { label: 'Sass', value: ['sass'] },
        { label: 'LESS', value: ['less'] }
    ];
    
    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: t('messages.selectFileType')
    });
    
    if (!selected) {
        return;
    }
    
    const originalFileTypes = config.fileTypes;
    config.fileTypes = selected.value;
    
    const fileTypesPattern = `**/*.{${config.fileTypes.join(',')}}`;
    const files = await vscode.workspace.findFiles(
        fileTypesPattern,
        '**/node_modules/**'
    );
    
    const filteredFiles = files.filter(file => {
        const relativePath = vscode.workspace.asRelativePath(file);
        return !config.excludeFiles.some(pattern => minimatch(relativePath, pattern));
    });
    
    if (filteredFiles.length === 0) {
        vscode.window.showInformationMessage(t('messages.noFilesFound'));
        config.fileTypes = originalFileTypes;
        return;
    }
    
    const answer = await vscode.window.showInformationMessage(
        tp('messages.filesFound', filteredFiles.length),
        t('messages.yes'),
        t('messages.no')
    );
    
    if (answer !== t('messages.yes')) {
        config.fileTypes = originalFileTypes;
        return;
    }
    
    let totalConverted = 0;
    let filesProcessed = 0;
    
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: t('messages.progressTitle'),
        cancellable: false
    }, async (progress, token) => {
        for (const file of filteredFiles) {
            const document = await vscode.workspace.openTextDocument(file);
            const text = document.getText();
            
            const excludeRegexes = createExcludeRegexes(config.excludePatterns);
            const matches = findPxMatches(text, excludeRegexes, config);
            
            if (matches.length > 0) {
                const edit = new vscode.WorkspaceEdit();
                
                matches.forEach((match: PxMatch) => {
                    const range = new vscode.Range(
                        document.positionAt(match.index),
                        document.positionAt(match.index + match.fullMatch.length)
                    );
                    
                    const replacement = convertPxValue(match.value, false, config, match.isInCalc);
                    edit.replace(document.uri, range, replacement);
                });
                
                await vscode.workspace.applyEdit(edit);
                await document.save();
                
                totalConverted += matches.length;
                filesProcessed++;
            }
            
            progress.report({ 
                increment: 100 / filteredFiles.length,
                message: `${filesProcessed}/${filteredFiles.length}` 
            });
        }
    });
    
    const fileTypeLabel = selected.label;
    const message = tp('messages.fileTypeConverted', totalConverted, {
        files: filesProcessed.toString(),
        fileType: fileTypeLabel
    });
    
    vscode.window.showInformationMessage(message);
    config.fileTypes = originalFileTypes;
}

async function switchProfile(): Promise<void> {
    const profiles = [
        {
            label: t('profiles.scssFunction.label'),
            description: t('profiles.scssFunction.description'),
            settings: {
                directConversion: false,
                keepPxInRem: false,
                scssInterpolation: true,
                preserveZero: true,
                minValue: 0,
                maxValue: 9999,
                excludeProperties: []
            }
        },
        {
            label: t('profiles.directConversion.label'),
            description: t('profiles.directConversion.description'),
            settings: {
                directConversion: true,
                keepPxInRem: false,
                scssInterpolation: false,
                preserveZero: true,
                minValue: 0,
                maxValue: 9999,
                excludeProperties: []
            }
        },
        {
            label: t('profiles.scssWithPx.label'),
            description: t('profiles.scssWithPx.description'),
            settings: {
                directConversion: false,
                keepPxInRem: true,
                scssInterpolation: false,
                preserveZero: true,
                minValue: 0,
                maxValue: 9999,
                excludeProperties: []
            }
        },
        {
            label: t('profiles.minimal.label'),
            description: t('profiles.minimal.description'),
            settings: {
                directConversion: false,
                keepPxInRem: false,
                scssInterpolation: false,
                preserveZero: true,
                minValue: 8,
                maxValue: 9999,
                excludeProperties: ['border-width', 'outline-width']
            }
        }
    ];
    
    const selected = await vscode.window.showQuickPick(profiles, {
        placeHolder: t('messages.selectFileType')
    });
    
    if (!selected) {
        return;
    }
    
    const config = vscode.workspace.getConfiguration('pxToRem');
    
    await config.update('directConversion', selected.settings.directConversion, true);
    await config.update('keepPxInRem', selected.settings.keepPxInRem, true);
    await config.update('scssInterpolation', selected.settings.scssInterpolation, true);
    await config.update('preserveZero', selected.settings.preserveZero, true);
    await config.update('minValue', selected.settings.minValue, true);
    await config.update('maxValue', selected.settings.maxValue, true);
    await config.update('excludeProperties', selected.settings.excludeProperties, true);
    
    vscode.window.showInformationMessage(
        t('messages.profileActivated', { name: selected.label })
    );
}

async function exportSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration('pxToRem');
    const settings = {
        directConversion: config.get('directConversion'),
        baseFontSize: config.get('baseFontSize'),
        keepPxInRem: config.get('keepPxInRem'),
        preserveZero: config.get('preserveZero'),
        scssInterpolation: config.get('scssInterpolation'),
        minValue: config.get('minValue'),
        maxValue: config.get('maxValue'),
        includeProperties: config.get('includeProperties'),
        excludeProperties: config.get('excludeProperties'),
        excludePatterns: config.get('excludePatterns'),
        excludeFiles: config.get('excludeFiles'),
        fileTypes: config.get('fileTypes'),
        enableDiagnostics: config.get('enableDiagnostics'),
        enableCodeLens: config.get('enableCodeLens'),
        diagnosticSeverity: config.get('diagnosticSeverity')
    };

    const json = JSON.stringify(settings, null, 2);
    
    const document = await vscode.workspace.openTextDocument({
        content: json,
        language: 'json'
    });
    
    await vscode.window.showTextDocument(document);
    vscode.window.showInformationMessage(t('messages.settingsExported'));
}

async function importSettings(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor || editor.document.languageId !== 'json') {
        vscode.window.showErrorMessage(t('messages.openJsonFile'));
        return;
    }
    
    try {
        const text = editor.document.getText();
        const settings = JSON.parse(text);
        
        const config = vscode.workspace.getConfiguration('pxToRem');
        
        for (const [key, value] of Object.entries(settings)) {
            await config.update(key, value, true);
        }
        
        vscode.window.showInformationMessage(t('messages.settingsImported'));
    } catch (error) {
        vscode.window.showErrorMessage(t('messages.invalidJson'));
    }
}

function updateStatusBar(): void {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
        statusBarItem.hide();
        return;
    }
    
    const document = editor.document;
    const languageId = document.languageId;
    const supportedLanguages = ['css', 'scss', 'sass', 'less', 'html', 'vue', 'jsx', 'tsx'];
    
    if (!supportedLanguages.includes(languageId)) {
        statusBarItem.hide();
        return;
    }
    
    const config = getConfig();
    const text = document.getText();
    const excludeRegexes = createExcludeRegexes(config.excludePatterns);
    const matches = findPxMatches(text, excludeRegexes, config);
    
    if (matches.length === 0) {
        statusBarItem.hide();
        return;
    }
    
    statusBarItem.text = `📏 ${matches.length} px`;
    statusBarItem.command = 'px-to-rem.convert';
    statusBarItem.show();
}

function updateDiagnostics(document: vscode.TextDocument): void {
    const config = getConfig();
    
    if (!config.enableDiagnostics) {
        diagnosticCollection.clear();
        return;
    }
    
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const excludeRegexes = createExcludeRegexes(config.excludePatterns);
    const matches = findPxMatches(text, excludeRegexes, config);
    
    let severity = vscode.DiagnosticSeverity.Information;
    switch (config.diagnosticSeverity) {
        case 'error':
            severity = vscode.DiagnosticSeverity.Error;
            break;
        case 'warning':
            severity = vscode.DiagnosticSeverity.Warning;
            break;
        case 'hint':
            severity = vscode.DiagnosticSeverity.Hint;
            break;
    }
    
    matches.forEach((match: PxMatch) => {
        const range = new vscode.Range(
            document.positionAt(match.index),
            document.positionAt(match.index + match.fullMatch.length)
        );
        
        const preview = convertPxValue(match.value, false, config, match.isInCalc);
        
        const diagnostic = new vscode.Diagnostic(
            range,
            t('diagnostics.useRemInstead', { preview, value: match.fullMatch }),
            severity
        );
        
        diagnostics.push(diagnostic);
    });
    
    diagnosticCollection.set(document.uri, diagnostics);
}

function providePxHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const config = getConfig();
    const actualBaseFontSize = getActualBaseFontSize(config);
    
    const pxRange = document.getWordRangeAtPosition(position, /(-?\d+(?:\.\d+)?)px/);
    if (pxRange) {
        const word = document.getText(pxRange);
        const match = word.match(/(-?\d+(?:\.\d+)?)px/);
        
        if (match) {
            const value = parseFloat(match[1]);
            const preview = convertPxValue(value, false, config, false);
            
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**${word}** → **${preview}**`);
            markdown.appendMarkdown(t('hover.pressToConvert'));
            
            return new vscode.Hover(markdown, pxRange);
        }
    }
    
    if (config.enableInlayHints) {
        const remFuncRange = document.getWordRangeAtPosition(position, /rem\((-?\d+(?:\.\d+)?)(px)?\)/);
        if (remFuncRange) {
            const word = document.getText(remFuncRange);
            const match = word.match(/rem\((-?\d+(?:\.\d+)?)(px)?\)/);
            
            if (match) {
                const value = parseFloat(match[1]);
                const pxValue = match[2] ? value : Math.round(value * actualBaseFontSize);
                const remValue = match[2] ? (value / actualBaseFontSize).toFixed(3) : value;
                
                const markdown = new vscode.MarkdownString();
                if (match[2]) {
                    markdown.appendMarkdown(`**${word}** → **${remValue}rem** (${pxValue}px)`);
                } else {
                    markdown.appendMarkdown(`**${word}** → **${pxValue}px**`);
                }
                
                return new vscode.Hover(markdown, remFuncRange);
            }
        }
        
        const remRange = document.getWordRangeAtPosition(position, /(-?\d+(?:\.\d+)?)rem/);
        if (remRange) {
            const word = document.getText(remRange);
            const match = word.match(/(-?\d+(?:\.\d+)?)rem/);
            
            if (match) {
                const remValue = parseFloat(match[1]);
                const pxValue = Math.round(remValue * actualBaseFontSize);
                
                const markdown = new vscode.MarkdownString();
                markdown.appendMarkdown(`**${word}** → **${pxValue}px**`);
                if (config.useDynamicBaseFontSize) {
                    markdown.appendMarkdown(` *(base: ${actualBaseFontSize}px)*`);
                }
                
                return new vscode.Hover(markdown, remRange);
            }
        }
    }
    
    return undefined;
}

class PxToRemInlayHintsProvider implements vscode.InlayHintsProvider {
    provideInlayHints(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.InlayHint[] {
        const config = getConfig();
        
        if (!config.enableInlayHints) {
            return [];
        }
        
        const hints: vscode.InlayHint[] = [];
        const text = document.getText(range);
        const actualBaseFontSize = getActualBaseFontSize(config);
        const startOffset = document.offsetAt(range.start);
        
        const remFuncRegex = /rem\((-?\d+(?:\.\d+)?)(px)?\)/g;
        let match;
        
        while ((match = remFuncRegex.exec(text)) !== null) {
            const value = parseFloat(match[1]);
            const hasPx = !!match[2];
            const pxValue = hasPx ? value : Math.round(value * actualBaseFontSize);
            
            const absoluteOffset = startOffset + match.index + match[0].length;
            const position = document.positionAt(absoluteOffset);
            
            const hint = new vscode.InlayHint(
                position,
                ` → ${pxValue}px`,
                vscode.InlayHintKind.Type
            );
            hint.paddingLeft = true;
            hint.tooltip = hasPx 
                ? `${match[0]} = ${(value / actualBaseFontSize).toFixed(3)}rem = ${pxValue}px`
                : `${match[0]} = ${pxValue}px (base: ${actualBaseFontSize}px)`;
            
            hints.push(hint);
        }
        
        const remRegex = /(-?\d+(?:\.\d+)?)rem\b/g;
        
        while ((match = remRegex.exec(text)) !== null) {
            const remValue = parseFloat(match[1]);
            const pxValue = Math.round(remValue * actualBaseFontSize);
            
            const absoluteOffset = startOffset + match.index + match[0].length;
            const position = document.positionAt(absoluteOffset);
            
            const hint = new vscode.InlayHint(
                position,
                ` → ${pxValue}px`,
                vscode.InlayHintKind.Type
            );
            hint.paddingLeft = true;
            hint.tooltip = `${match[0]} = ${pxValue}px (base: ${actualBaseFontSize}px)`;
            
            hints.push(hint);
        }
        
        return hints;
    }
}

class PxToRemCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const config = getConfig();
        
        if (!config.enableCodeLens) {
            return [];
        }
        
        const codeLenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const lines = text.split('\n');
        const excludeRegexes = createExcludeRegexes(config.excludePatterns);
        
        lines.forEach((line: string, lineIndex: number) => {
            if (shouldSkipLine(line, excludeRegexes)) {
                return;
            }
            
            const pxRegex = /(-?\d+(?:\.\d+)?)px/g;
            const matches: RegExpExecArray[] = [];
            let match;
            
            while ((match = pxRegex.exec(line)) !== null) {
                const value = parseFloat(match[1]);
                if (shouldConvertValue(Math.abs(value), config)) {
                    matches.push(match);
                }
            }
            
            if (matches.length > 0) {
                const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
                const convertLens = new vscode.CodeLens(range, {
                    title: tp('codeLens.convertValues', matches.length),
                    command: 'px-to-rem.convertLine',
                    arguments: [lineIndex]
                });
                
                codeLenses.push(convertLens);
            }
        });
        
        return codeLenses;
    }
}

async function convertLine(lineIndex: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    
    if (!editor) {
        return;
    }
    
    const config = getConfig();
    const document = editor.document;
    const line = document.lineAt(lineIndex);
    const lineText = line.text;
    
    const pxRegex = /(-?\d+(?:\.\d+)?)px/g;
    const matches: { value: number; start: number; end: number }[] = [];
    let match;
    
    while ((match = pxRegex.exec(lineText)) !== null) {
        matches.push({
            value: parseFloat(match[1]),
            start: match.index,
            end: match.index + match[0].length
        });
    }
    
    if (matches.length === 0) {
        return;
    }
    
    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        matches.reverse().forEach((m: { value: number; start: number; end: number }) => {
            const range = new vscode.Range(
                lineIndex, m.start,
                lineIndex, m.end
            );
            
            const replacement = convertPxValue(m.value, false, config, false);
            editBuilder.replace(range, replacement);
        });
    });
    
    vscode.window.showInformationMessage(
        tp('messages.convertedInLine', matches.length)
    );
}

class PxToRemCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection
    ): vscode.CodeAction[] {
        const config = getConfig();
        const actions: vscode.CodeAction[] = [];
        
        const lineText = document.lineAt(range.start.line).text;
        const pxRegex = /(-?\d+(?:\.\d+)?)px/g;
        let match;
        
        while ((match = pxRegex.exec(lineText)) !== null) {
            const matchStart = match.index;
            const matchEnd = match.index + match[0].length;
            
            if (matchStart <= range.start.character && range.start.character <= matchEnd) {
                const value = parseFloat(match[1]);
                
                const remFormatted = convertPxValue(value, false, config, false);
                const action1 = new vscode.CodeAction(
                    t('quickFix.convertTo', { value: remFormatted }),
                    vscode.CodeActionKind.QuickFix
                );
                action1.edit = new vscode.WorkspaceEdit();
                action1.edit.replace(
                    document.uri,
                    new vscode.Range(
                        range.start.line, matchStart,
                        range.start.line, matchEnd
                    ),
                    remFormatted
                );
                actions.push(action1);
                
                const directRem = `${(value / getActualBaseFontSize(config))}rem`;
                const action2 = new vscode.CodeAction(
                    t('quickFix.convertTo', { value: directRem }),
                    vscode.CodeActionKind.QuickFix
                );
                action2.edit = new vscode.WorkspaceEdit();
                action2.edit.replace(
                    document.uri,
                    new vscode.Range(
                        range.start.line, matchStart,
                        range.start.line, matchEnd
                    ),
                    directRem
                );
                actions.push(action2);
                
                const remWithPx = `rem(${value}px)`;
                const action3 = new vscode.CodeAction(
                    t('quickFix.convertTo', { value: remWithPx }),
                    vscode.CodeActionKind.QuickFix
                );
                action3.edit = new vscode.WorkspaceEdit();
                action3.edit.replace(
                    document.uri,
                    new vscode.Range(
                        range.start.line, matchStart,
                        range.start.line, matchEnd
                    ),
                    remWithPx
                );
                actions.push(action3);
                
                break;
            }
        }
        
        return actions;
    }
}

export function activate(context: vscode.ExtensionContext): void {
    initializeLocale(context);
    
    const config = getConfig();
    if (config.useDynamicBaseFontSize) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            parseBaseFontSize(
                workspaceFolder,
                config.baseFontSizeFile,
                config.baseFontSizeVariable
            ).then(value => {
                if (value !== null) {
                    dynamicBaseFontSize = value;
                    vscode.window.showInformationMessage(
                        `✅ Dynamic baseFontSize loaded: ${value}px from ${config.baseFontSizeVariable}`
                    );
                } else {
                    vscode.window.showWarningMessage(
                        `⚠️ Could not load dynamic baseFontSize. Using static value: ${config.baseFontSize}px`
                    );
                }
            });
            
            baseFontSizeWatcher = watchBaseFontSizeFile(
                workspaceFolder,
                config.baseFontSizeFile,
                (newValue) => {
                    dynamicBaseFontSize = newValue;
                    vscode.window.showInformationMessage(
                        `✅ Dynamic baseFontSize updated: ${newValue}px`
                    );
                }
            );
            context.subscriptions.push(baseFontSizeWatcher);
        }
    }
    
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
    
    diagnosticCollection = vscode.languages.createDiagnosticCollection('px-to-rem');
    context.subscriptions.push(diagnosticCollection);
    
    const convertCommand = vscode.commands.registerCommand(
        'px-to-rem.convert',
        () => convertPxToRem()
    );

    const convertWithPxCommand = vscode.commands.registerCommand(
        'px-to-rem.convertWithPx',
        () => convertPxToRem(true)
    );

    const convertWorkspaceCommand = vscode.commands.registerCommand(
        'px-to-rem.convertWorkspace',
        convertWorkspace
    );
    
    const convertFileTypeCommand = vscode.commands.registerCommand(
        'px-to-rem.convertFileType',
        convertFileType
    );

    const switchProfileCommand = vscode.commands.registerCommand(
        'px-to-rem.switchProfile',
        switchProfile
    );

    const convertSelectionCommand = vscode.commands.registerCommand(
        'px-to-rem.convertSelection',
        convertSelection
    );

    const reverseConvertCommand = vscode.commands.registerCommand(
        'px-to-rem.reverseConvert',
        reverseConvert
    );

    const exportSettingsCommand = vscode.commands.registerCommand(
        'px-to-rem.exportSettings',
        exportSettings
    );

    const importSettingsCommand = vscode.commands.registerCommand(
        'px-to-rem.importSettings',
        importSettings
    );

    const convertLineCommand = vscode.commands.registerCommand(
        'px-to-rem.convertLine',
        convertLine
    );

    vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
        if (editor) {
            updateStatusBar();
            updateDiagnostics(editor.document);
        }
    });

    vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
            updateStatusBar();
            updateDiagnostics(event.document);
        }
    });

    vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
        if (event.affectsConfiguration('pxToRem')) {
            updateStatusBar();
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                updateDiagnostics(editor.document);
            }
        }
    });

    const hoverProvider = vscode.languages.registerHoverProvider(
        ['css', 'scss', 'sass', 'less', 'html', 'vue', 'jsx', 'tsx'],
        {
            provideHover(document: vscode.TextDocument, position: vscode.Position) {
                return providePxHover(document, position);
            }
        }
    );

    const codeLensProvider = vscode.languages.registerCodeLensProvider(
        ['css', 'scss', 'sass', 'less'],
        new PxToRemCodeLensProvider()
    );

    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        ['css', 'scss', 'sass', 'less', 'html', 'vue', 'jsx', 'tsx'],
        new PxToRemCodeActionProvider(),
        {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        }
    );

    const inlayHintsProvider = vscode.languages.registerInlayHintsProvider(
        ['css', 'scss', 'sass', 'less'],
        new PxToRemInlayHintsProvider()
    );

    context.subscriptions.push(
        convertCommand, 
        convertWithPxCommand, 
        convertWorkspaceCommand,
        convertFileTypeCommand,
        switchProfileCommand,
        convertSelectionCommand,
        reverseConvertCommand,
        exportSettingsCommand,
        importSettingsCommand,
        convertLineCommand,
        hoverProvider,
        codeLensProvider,
        codeActionProvider,
        inlayHintsProvider
    );

    updateStatusBar();
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        updateDiagnostics(editor.document);
    }
}

export function deactivate(): void {}
