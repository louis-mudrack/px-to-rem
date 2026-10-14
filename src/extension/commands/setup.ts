import * as vscode from 'vscode';
import { formatNumber } from '../../core/format';
import { generateRemHelper, type HelperTarget } from '../../core/generate';
import { parseJsonc } from '../../core/jsonc';
import { flattenOptions, OPTION_DEFS } from '../../core/options';
import { CONFIG_FILE_NAMES } from '../config';
import type { Services } from '../services';

const SCHEMA_URL = 'https://raw.githubusercontent.com/louis-mudrack/px-to-rem/master/schemas/pxtoremrc.schema.json';

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length <= 1) {
        return folders[0];
    }
    return vscode.window.showWorkspaceFolderPick({ placeHolder: vscode.l10n.t('Which project?') });
}

/** Writes (or merges into) the folder's `.pxtoremrc.json` and opens it. */
async function writeConfigFile(services: Services, folder: vscode.WorkspaceFolder, values: Record<string, unknown>, open = true): Promise<void> {
    const existing = services.config.configFileFor(folder.uri);
    const uri = existing?.uri ?? vscode.Uri.joinPath(folder.uri, CONFIG_FILE_NAMES[0]);
    let current: Record<string, unknown> = { $schema: SCHEMA_URL };
    if (existing?.config) {
        current = { ...existing.config };
    }
    const merged = { ...current, ...values };
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(merged, null, 2) + '\n'));
    if (open) {
        await vscode.window.showTextDocument(uri);
    }
}

/** Guided setup: shows what was detected and writes `.pxtoremrc.json`. */
async function setup(services: Services): Promise<void> {
    const folder = await pickFolder();
    if (!folder) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Open a folder first.'));
        return;
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('PX to REM: looking at your project…') }, () =>
        services.index.whenReady(),
    );
    const info = services.project.infoFor(folder.uri);
    const ctx = info.context;
    const values: Record<string, unknown> = {};

    const facts: string[] = [];
    facts.push(
        vscode.l10n.t(
            'Root font size {0}px{1}',
            formatNumber(ctx.rootFontSize, { precision: 2, leadingZero: true }),
            ctx.rootFontSizeSource?.description ? ` (${ctx.rootFontSizeSource.description})` : '',
        ),
    );
    if (ctx.remFunctions.length) {
        facts.push(vscode.l10n.t('{0}() helper in {1}', ctx.remFunctions[0].name, ctx.remFunctions[0].source?.file ?? '?'));
    }
    if (ctx.tokens.size) {
        facts.push(vscode.l10n.t('{0} design tokens', ctx.tokens.size));
    }
    if (info.tailwindDetected) {
        facts.push('Tailwind CSS');
    }
    if (info.buildTimeConversion) {
        facts.push(vscode.l10n.t('postcss-pxtorem at build time'));
    }

    const mode = await vscode.window.showQuickPick(
        [
            { label: vscode.l10n.t('Smart (recommended)'), description: vscode.l10n.t('rem for sizes, unitless line-height, em letter-spacing, px borders, em breakpoints'), value: 'smart' },
            { label: vscode.l10n.t('Simple'), description: vscode.l10n.t('Every px value the same way'), value: 'simple' },
        ],
        { title: vscode.l10n.t('Set up PX to REM — found: {0}', facts.join(' · ')), placeHolder: vscode.l10n.t('How should values be converted?') },
    );
    if (!mode) {
        return;
    }
    values.mode = mode.value;

    const formats = [
        { label: 'auto', description: ctx.remFunctions.length ? vscode.l10n.t('Uses your {0}() helper in Sass/Less/Stylus, rem elsewhere', ctx.remFunctions[0].name) : vscode.l10n.t('rem, or your rem() helper once you have one') },
        { label: 'rem', description: '16px → 1rem' },
        { label: 'rem-function', description: '16px → rem(16)' },
        { label: 'rem-function-px', description: '16px → rem(16px)' },
        { label: 'vw', description: vscode.l10n.t('Relative to the design width') },
        { label: 'rpx', description: vscode.l10n.t('Mini programs (750rpx = screen width)') },
    ];
    const format = await vscode.window.showQuickPick(formats, { placeHolder: vscode.l10n.t('Output format') });
    if (!format) {
        return;
    }
    values.format = format.label;
    if (format.label === 'vw' || format.label === 'rpx') {
        const width = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Design width in px'), value: format.label === 'rpx' ? '750' : '1440' });
        if (width && Number(width) > 0) {
            values.designWidth = Number(width);
        }
    }

    if (ctx.tokens.lengths.length) {
        const prefer = await vscode.window.showQuickPick(
            [
                { label: vscode.l10n.t('Yes'), description: vscode.l10n.t('16px → var(--space-4) when a token matches exactly'), value: true },
                { label: vscode.l10n.t('No'), description: vscode.l10n.t('Convert to rem; tokens stay available as quick fixes'), value: false },
            ],
            { placeHolder: vscode.l10n.t('Use design tokens when converting?') },
        );
        if (prefer) {
            values['tokens'] = { preferTokens: prefer.value };
        }
    }

    const scope = await vscode.window.showQuickPick(
        [
            { label: vscode.l10n.t('Everywhere'), value: 'all' },
            { label: vscode.l10n.t('Only on lines I change'), description: vscode.l10n.t('Great for gradual migrations (uses git)'), value: 'changedLines' },
        ],
        { placeHolder: vscode.l10n.t('Where should accessibility and design-system hints appear?') },
    );
    if (scope) {
        values.diagnostics = { scope: scope.value };
    }

    await writeConfigFile(services, folder, values);

    const save = await vscode.window.showInformationMessage(
        vscode.l10n.t('Saved .pxtoremrc.json. Convert px automatically when saving files?'),
        vscode.l10n.t('Convert on save'),
        vscode.l10n.t('Not now'),
    );
    if (save === vscode.l10n.t('Convert on save')) {
        await vscode.workspace.getConfiguration('pxToRem', folder.uri).update('convertOnSave', true, vscode.ConfigurationTarget.Workspace);
    }
}

const PRESETS: { label: string; description: string; values: Record<string, unknown> }[] = [
    { label: '$(sparkle) Smart', description: 'rem/em/unitless per property, auto format', values: { mode: 'smart', format: 'auto' } },
    { label: '$(symbol-unit) rem everywhere', description: '16px → 1rem', values: { mode: 'simple', format: 'rem' } },
    { label: '$(symbol-method) rem() function', description: '16px → rem(16)', values: { mode: 'simple', format: 'rem-function' } },
    { label: '$(symbol-method) rem(px) function', description: '16px → rem(16px)', values: { mode: 'simple', format: 'rem-function-px' } },
    { label: '$(filter) Minimal', description: 'Only values ≥ 4px, borders stay px', values: { mode: 'smart', minValue: 4, excludeProperties: ['border*', 'outline*'] } },
    { label: '$(device-desktop) vw', description: 'Relative to a 1440px design', values: { mode: 'simple', format: 'vw', designWidth: 1440 } },
    { label: '$(device-mobile) rpx', description: 'Mini programs, 750px design', values: { mode: 'simple', format: 'rpx', designWidth: 750 } },
];

async function choosePreset(services: Services): Promise<void> {
    const picked = await vscode.window.showQuickPick(PRESETS, { placeHolder: vscode.l10n.t('Choose a conversion preset') });
    if (!picked) {
        return;
    }
    const folder = await pickFolder();
    if (folder && services.config.configFileFor(folder.uri)?.config) {
        await writeConfigFile(services, folder, picked.values, false);
    } else {
        const config = vscode.workspace.getConfiguration('pxToRem', folder?.uri);
        const target = folder ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        for (const [key, value] of Object.entries(picked.values)) {
            await config.update(key, value, target);
        }
    }
    void vscode.window.showInformationMessage(vscode.l10n.t('Preset "{0}" applied.', picked.label.replace(/\$\([^)]*\)\s*/, '')));
}

/** Creates `.pxtoremrc.json` from the settings currently in effect (replaces "Export settings"). */
async function createConfigFromSettings(services: Services): Promise<void> {
    const folder = await pickFolder();
    if (!folder) {
        return;
    }
    const settings = vscode.workspace.getConfiguration('pxToRem', folder.uri);
    const values: Record<string, unknown> = {};
    for (const def of OPTION_DEFS) {
        if (def.configFile === false || def.deprecated) {
            continue;
        }
        const inspected = settings.inspect(def.key);
        const value = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
        if (value !== undefined) {
            values[def.key] = value;
        }
    }
    const effective = services.config.optionsFor(folder.uri);
    values.format = values.format ?? effective.format;
    values.mode = values.mode ?? effective.mode;
    await writeConfigFile(services, folder, values);
}

/** Imports settings from the active JSON editor into `.pxtoremrc.json`. */
async function importSettings(services: Services): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !/json/.test(editor.document.languageId)) {
        void vscode.window.showErrorMessage(vscode.l10n.t('Open a JSON file with the settings first.'));
        return;
    }
    const parsed = parseJsonc(editor.document.getText());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        void vscode.window.showErrorMessage(vscode.l10n.t('The file is not a JSON object.'));
        return;
    }
    const raw = parsed as Record<string, unknown>;
    // Accept both `pxToRem.format` style keys and plain keys.
    const unprefixed = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/^pxToRem\./, ''), v]));
    const values = flattenOptions(unprefixed);
    if (!Object.keys(values).length) {
        void vscode.window.showErrorMessage(vscode.l10n.t('No PX to REM settings found in this file.'));
        return;
    }
    const folder = await pickFolder();
    if (!folder) {
        return;
    }
    await writeConfigFile(services, folder, values);
}

async function setFormat(format: string, uri?: vscode.Uri): Promise<void> {
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    await vscode.workspace
        .getConfiguration('pxToRem', folder?.uri)
        .update('format', format, folder ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
}

/** Opens a new editor with a px-to-rem helper for the current language. */
async function generateHelper(services: Services, uri?: vscode.Uri): Promise<void> {
    const document = uri ? vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString()) : vscode.window.activeTextEditor?.document;
    const lang = document?.languageId ?? 'scss';
    const guess: HelperTarget =
        lang === 'sass' ? 'sass' : lang === 'less' ? 'less' : lang === 'stylus' ? 'stylus' : lang === 'css' || lang === 'postcss' ? 'css' : /typescript/.test(lang) ? 'ts' : /javascript/.test(lang) ? 'js' : 'scss';
    const targets: { label: string; target: HelperTarget; language: string }[] = [
        { label: 'SCSS', target: 'scss', language: 'scss' },
        { label: 'Sass (indented)', target: 'sass', language: 'sass' },
        { label: 'Stylus', target: 'stylus', language: 'stylus' },
        { label: 'Less', target: 'less', language: 'less' },
        { label: 'CSS @function', target: 'css', language: 'css' },
        { label: 'TypeScript', target: 'ts', language: 'typescript' },
        { label: 'JavaScript', target: 'js', language: 'javascript' },
    ];
    targets.sort((a, b) => (a.target === guess ? -1 : b.target === guess ? 1 : 0));
    const picked = await vscode.window.showQuickPick(targets, { placeHolder: vscode.l10n.t('Generate the helper for…') });
    if (!picked) {
        return;
    }
    const options = services.config.optionsFor(document?.uri);
    const root = services.project.contextFor(document?.uri).rootFontSize;
    const content = generateRemHelper(picked.target, options.functionName, root);
    const doc = await vscode.workspace.openTextDocument({ content, language: picked.language });
    await vscode.window.showTextDocument(doc);
    void vscode.window.showInformationMessage(vscode.l10n.t('Save this file in your styles folder and import it where {0}() is used.', options.functionName));
}

export function registerSetupCommands(services: Services): vscode.Disposable[] {
    const reg = vscode.commands.registerCommand;
    return [
        reg('px-to-rem.setup', () => setup(services)),
        reg('px-to-rem.switchProfile', () => choosePreset(services)),
        reg('px-to-rem.exportSettings', () => createConfigFromSettings(services)),
        reg('px-to-rem.importSettings', () => importSettings(services)),
        reg('px-to-rem.setFormat', (format: string, uri?: vscode.Uri) => setFormat(format, uri)),
        reg('px-to-rem.generateHelper', (uri?: vscode.Uri) => generateHelper(services, uri)),
        reg('px-to-rem.refresh', () => services.index.rescan()),
    ];
}
