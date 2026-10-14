import * as assert from 'node:assert';
import Mocha from 'mocha';
import * as vscode from 'vscode';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | Promise<T>, check: (v: T) => boolean, timeout = 15000): Promise<T> {
    const start = Date.now();
    let last: T = await fn();
    while (!check(last)) {
        if (Date.now() - start > timeout) {
            throw new Error(`Timed out; last value: ${JSON.stringify(last)}`);
        }
        await sleep(150);
        last = await fn();
    }
    return last;
}

function file(relative: string): vscode.Uri {
    return vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, relative);
}

async function open(relative: string): Promise<vscode.TextEditor> {
    const doc = await vscode.workspace.openTextDocument(file(relative));
    return vscode.window.showTextDocument(doc);
}

async function reset(editor: vscode.TextEditor, text: string): Promise<void> {
    await editor.edit(b => b.replace(new vscode.Range(0, 0, editor.document.lineCount, 0), text));
}

function position(doc: vscode.TextDocument, needle: string, delta = 1): vscode.Position {
    const offset = doc.getText().indexOf(needle);
    assert.ok(offset >= 0, `${needle} not found`);
    return doc.positionAt(offset + delta);
}

function defineTests(): void {
    suite('PX to REM Toolkit', function () {
        this.timeout(60000);

        suiteSetup(async () => {
            const ext = vscode.extensions.getExtension('LouisMudrack.px-to-rem-function');
            assert.ok(ext, 'extension is installed');
            await open('styles/card.scss');
            await waitFor(() => ext.isActive, v => v);
        });

        test('detects the root font size and the rem() helper, then converts with smart mode', async () => {
            const editor = await open('styles/card.scss');
            const original = editor.document.getText();
            // The workspace scan finishes asynchronously; retry until it sees html { font-size: 62.5% } and rem().
            const converted = await waitFor(
                async () => {
                    await reset(editor, original);
                    await vscode.commands.executeCommand('px-to-rem.convert');
                    return editor.document.getText();
                },
                text => text.includes('rem(20)'),
            );
            assert.strictEqual(
                converted,
                '.card {\n  font-size: rem(18);\n  line-height: 1.5;\n  padding: rem(20);\n  border: 1px solid #ccc;\n}\n',
            );
            await reset(editor, original);
        });

        test('plain CSS gets rem units relative to the detected 10px root', async () => {
            const editor = await open('styles/plain.css');
            const original = editor.document.getText();
            await vscode.commands.executeCommand('px-to-rem.convert');
            assert.strictEqual(editor.document.getText(), '.plain {\n  margin: 2rem;\n  font-size: 1.6rem;\n}\n');
            await reset(editor, original);
        });

        test('converts only the selection', async () => {
            const editor = await open('styles/plain.css');
            const original = editor.document.getText();
            const start = position(editor.document, '20px', 0);
            editor.selection = new vscode.Selection(start, start.translate(0, 4));
            await vscode.commands.executeCommand('px-to-rem.convert');
            assert.strictEqual(editor.document.getText(), '.plain {\n  margin: 2rem;\n  font-size: 16px;\n}\n');
            await reset(editor, original);
        });

        test('converts Vue style blocks and style attributes', async () => {
            const editor = await open('components/Box.vue');
            const original = editor.document.getText();
            await vscode.commands.executeCommand('px-to-rem.convert');
            const text = editor.document.getText();
            assert.ok(text.includes('style="padding: 1rem"'), text);
            assert.ok(text.includes('margin: rem(30)'), text);
            await reset(editor, original);
        });

        test('hover explains the conversion', async () => {
            const editor = await open('styles/card.scss');
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', editor.document.uri, position(editor.document, '27px'));
            const text = hovers.flatMap(h => h.contents.map(c => (typeof c === 'string' ? c : 'value' in c ? c.value : ''))).join('\n');
            assert.ok(text.includes('1.5'), text);
            assert.ok(/unitless/i.test(text), text);
        });

        test('quick fixes offer conversions, tokens and ignore comments', async () => {
            const editor = await open('styles/card.scss');
            const pos = position(editor.document, '20px');
            const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', editor.document.uri, new vscode.Range(pos, pos));
            const titles = actions.map(a => a.title);
            assert.ok(titles.includes('Convert to rem(20)'), titles.join(' | '));
            assert.ok(titles.some(t => t.startsWith('Ignore px values')), titles.join(' | '));
        });

        test('source action for codeActionsOnSave converts the file', async () => {
            const editor = await open('styles/plain.css');
            const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                'vscode.executeCodeActionProvider',
                editor.document.uri,
                new vscode.Range(0, 0, 0, 0),
                'source.pxToRem.convert',
            );
            assert.strictEqual(actions.length, 1);
            assert.strictEqual(actions[0].edit?.get(editor.document.uri).length, 2);
        });

        test('inlay hints show px for rem values', async () => {
            const editor = await open('styles/plain.css');
            const original = editor.document.getText();
            await reset(editor, '.a { margin: 1.5rem; }\n');
            const hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
                'vscode.executeInlayHintProvider',
                editor.document.uri,
                new vscode.Range(0, 0, 1, 0),
            );
            const labels = hints.map(h => (typeof h.label === 'string' ? h.label : h.label.map(p => p.value).join('')));
            assert.deepStrictEqual(labels, ['=15px']);
            await reset(editor, original);
        });

        test('diagnostics flag px font sizes', async () => {
            const editor = await open('styles/plain.css');
            const diagnostics = await waitFor(
                () => vscode.languages.getDiagnostics(editor.document.uri).filter(d => d.source === 'px-to-rem'),
                d => d.length > 0,
            );
            const codes = diagnostics.map(d => (typeof d.code === 'object' ? d.code.value : d.code));
            assert.ok(codes.includes('font-size-px'), codes.join(','));
        });

        test('completion suggests rem while typing px', async () => {
            const editor = await open('styles/plain.css');
            const original = editor.document.getText();
            await reset(editor, '.a { margin: 24px');
            const list = await vscode.commands.executeCommand<vscode.CompletionList>(
                'vscode.executeCompletionItemProvider',
                editor.document.uri,
                new vscode.Position(0, 17),
                'x',
            );
            const labels = list.items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
            assert.ok(labels.includes('2.4rem'), labels.join(','));
            await reset(editor, original);
        });

        test('cycle unit rotates px → rem → em', async () => {
            const editor = await open('styles/plain.css');
            const original = editor.document.getText();
            await reset(editor, '.a { margin: 20px; }\n');
            editor.selection = new vscode.Selection(new vscode.Position(0, 14), new vscode.Position(0, 14));
            await vscode.commands.executeCommand('px-to-rem.cycleUnit');
            assert.strictEqual(editor.document.getText(), '.a { margin: 2rem; }\n');
            await vscode.commands.executeCommand('px-to-rem.cycleUnit');
            assert.strictEqual(editor.document.getText(), '.a { margin: 2em; }\n');
            await reset(editor, original);
        });

        test('convert on save', async () => {
            const config = vscode.workspace.getConfiguration('pxToRem');
            await config.update('convertOnSave', true, vscode.ConfigurationTarget.Workspace);
            try {
                const editor = await open('styles/plain.css');
                const original = editor.document.getText();
                await reset(editor, '.a { gap: 40px; }\n');
                await editor.document.save();
                assert.strictEqual(editor.document.getText(), '.a { gap: 4rem; }\n');
                await reset(editor, original);
                await editor.document.save();
            } finally {
                await config.update('convertOnSave', undefined, vscode.ConfigurationTarget.Workspace);
            }
        });

        test('commands that open UI do not throw', async () => {
            await vscode.commands.executeCommand('px-to-rem.openDashboard');
            await sleep(500);
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });
    });
}

export function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });
    mocha.suite.emit('pre-require', globalThis, 'suite.ts', mocha);
    defineTests();
    return new Promise((resolve, reject) => {
        mocha.run(failures => (failures ? reject(new Error(`${failures} integration tests failed`)) : resolve()));
    });
}
