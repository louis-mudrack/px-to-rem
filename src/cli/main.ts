import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { analyzeDocument, buildReport, type FileStats } from '../core/analyze';
import { audit, ruleUrl, type Finding } from '../core/audit';
import { planConversion, planRebase } from '../core/convert';
import { parseDocument } from '../core/document';
import { formatNumber } from '../core/format';
import { message, type MessageId } from '../core/messages';
import { OPTION_DEFS, type PartialOptions } from '../core/options';
import { languageForFileName } from '../core/syntax';
import { applyEdits, LineIndex } from '../core/text';
import { buildProject, changedLines, explicitBaseFontSize, findFiles, loadConfig, optionsFor, toPosix, type LoadedConfig } from './project';

export interface Io {
    cwd: string;
    out: (text: string) => void;
    err: (text: string) => void;
    /** Whether output may use colours. */
    color: boolean;
}

const VERSION = '2.0.0';

const HELP = `px-to-rem ${VERSION} — PX to REM Toolkit on the command line

Usage
  px-to-rem check  [patterns…]   Report px values to convert and accessibility/design-system issues
  px-to-rem fix    [patterns…]   Convert px values in place
  px-to-rem report [patterns…]   Workspace statistics: score, grid, type scale, outliers, token proposals
  px-to-rem rebase --from <px> --to <px> [patterns…]
                                 Rewrite rem values for a new root font size (e.g. 62.5% → 100%)
  px-to-rem init                 Write a .pxtoremrc.json with what was detected

Patterns are globs relative to the current directory. Without patterns every
file of pxToRem.fileTypes is used. node_modules, build output and .gitignore'd
files are skipped.

Options
  --config <file>        Use this config file instead of finding .pxtoremrc.json
  --changed [ref]        Only lines changed since <ref> (default HEAD), untracked files fully
  --reporter <name>      stylish (default), json or github (workflow annotations)
  --max-warnings <n>     check: fail when there are more than n warnings (default: unlimited)
  --no-px                check: only run the audit rules, not "px can be converted"
  --dry-run              fix/rebase: show what would change without writing
  --json                 report: machine-readable output
  --root-declarations    rebase: also update html { font-size }
  --set <key>=<value>    Override any option, e.g. --set format=rem --set mode=simple
  -q, --quiet            Only print errors
  -h, --help             Show this help
  -v, --version          Show the version

Exit codes: 0 ok, 1 problems found (check) or files would change (fix --dry-run), 2 usage or runtime error.
`;

interface Args {
    command: string;
    patterns: string[];
    flags: Map<string, string | true>;
    sets: PartialOptions;
}

function parseArgs(argv: string[]): Args {
    const flags = new Map<string, string | true>();
    const patterns: string[] = [];
    const sets: PartialOptions = {};
    let command = '';
    const valued = new Set(['config', 'reporter', 'max-warnings', 'from', 'to', 'set']);
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-h') {
            flags.set('help', true);
        } else if (arg === '-v') {
            flags.set('version', true);
        } else if (arg === '-q') {
            flags.set('quiet', true);
        } else if (arg.startsWith('--')) {
            const eq = arg.indexOf('=');
            const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
            let value: string | true = eq > 0 ? arg.slice(eq + 1) : true;
            if (eq < 0 && valued.has(name) && i + 1 < argv.length) {
                value = argv[++i];
            } else if (eq < 0 && name === 'changed' && argv[i + 1] && !argv[i + 1].startsWith('-') && !/[*{?]|\.\w+$/.test(argv[i + 1])) {
                // `--changed main` takes a ref; `--changed src/**/*.css` does not.
                value = argv[++i];
            }
            if (name === 'set' && typeof value === 'string') {
                const eq = value.indexOf('=');
                if (eq > 0) {
                    sets[value.slice(0, eq)] = coerceSet(value.slice(0, eq), value.slice(eq + 1));
                }
            } else {
                flags.set(name, value);
            }
        } else if (!command) {
            command = arg;
        } else {
            patterns.push(arg);
        }
    }
    return { command, patterns, flags, sets };
}

function coerceSet(key: string, raw: string): unknown {
    const def = OPTION_DEFS.find(d => d.key === key);
    if (!def) {
        throw new Error(`Unknown option for --set: ${key}`);
    }
    switch (def.type) {
        case 'boolean':
            return raw === 'true';
        case 'number':
            return Number(raw);
        case 'array':
            return raw.split(',').map(s => s.trim()).filter(Boolean).map(s => (def.items?.type === 'number' ? Number(s) : s));
        case 'object':
            return JSON.parse(raw);
        default:
            return raw;
    }
}

interface FileResult {
    file: string;
    findings: (Finding & { column: number; endLine: number; endColumn: number; text: string })[];
}

function paint(io: Io, code: number, text: string): string {
    return io.color ? `\u001b[${code}m${text}\u001b[0m` : text;
}

async function context(io: Io, args: Args) {
    const configFlag = args.flags.get('config');
    const loaded = loadConfig(io.cwd, typeof configFlag === 'string' ? configFlag : undefined);
    const baseOptions = optionsFor(loaded, undefined, args.sets);
    const project = await buildProject(loaded, baseOptions, explicitBaseFontSize(loaded) ?? (typeof args.sets.baseFontSize === 'number' ? (args.sets.baseFontSize as number) : undefined));
    const files = await findFiles(loaded.root, args.patterns, baseOptions, io.cwd);
    let changed: Map<string, Set<number> | 'all'> | undefined;
    const changedFlag = args.flags.get('changed');
    if (changedFlag) {
        changed = changedLines(loaded.root, typeof changedFlag === 'string' ? changedFlag : 'HEAD');
    }
    return { loaded, baseOptions, project, files, changed };
}

function parseFile(loaded: LoadedConfig, file: string, sets: PartialOptions, project: Awaited<ReturnType<typeof buildProject>>) {
    const languageId = languageForFileName(file)!;
    const text = readFileSync(file, 'utf8');
    const options = optionsFor(loaded, file, sets);
    const ctx = project.context;
    const doc = parseDocument(text, languageId, {
        tailwind: !!ctx.tailwind,
        jsObjects: options.js.objectStyles && !ctx.reactNative,
        jsUnitlessNumbers: options.js.unitlessNumbers && !ctx.reactNative,
        jsTemplates: options.js.templateLiterals,
    });
    return { text, doc, options, ctx };
}

function lineFilterFor(changed: Map<string, Set<number> | 'all'> | undefined, file: string) {
    if (!changed) {
        return undefined;
    }
    const lines = changed.get(file);
    if (lines === undefined) {
        return () => false;
    }
    return lines === 'all' ? undefined : (item: { line: number }) => lines.has(item.line);
}

async function check(io: Io, args: Args): Promise<number> {
    const { loaded, project, files, changed } = await context(io, args);
    const includePx = !args.flags.has('no-px');
    const results: FileResult[] = [];
    let fixable = 0;
    for (const file of files) {
        if (changed && !changed.has(file)) {
            continue;
        }
        const { doc, options, ctx } = parseFile(loaded, file, args.sets, project);
        const filter = lineFilterFor(changed, file);
        const lines = new LineIndex(doc.text);
        const findings = audit(doc, { ...options, diagnostics: { ...options.diagnostics, rules: { ...options.diagnostics.rules, 'px-unit': 'off' } } }, ctx, {
            projectReady: true,
            lines: filter ? new Set(doc.lengths.map(l => l.line).filter(l => filter({ line: l }))) : undefined,
        });
        if (includePx) {
            const plan = planConversion(doc, options, ctx, filter);
            fixable += plan.edits.length;
            for (const edit of plan.edits) {
                // An accessibility finding on the same value already says what to use: make it the error instead of repeating it.
                const existing = findings.find(f => f.start === edit.length.start && f.end === edit.length.end);
                if (existing) {
                    existing.severity = 'error';
                    continue;
                }
                findings.push({
                    rule: 'px-unit',
                    severity: 'error',
                    start: edit.length.start,
                    end: edit.length.end,
                    line: edit.length.line,
                    message: 'diag.px-unit',
                    args: [doc.text.slice(edit.length.start, edit.length.end), edit.newText],
                    fixes: [],
                });
            }
        }
        if (findings.length) {
            results.push({
                file: toPosix(relative(io.cwd, file)),
                findings: findings
                    .sort((a, b) => a.start - b.start)
                    .map(f => {
                        const start = lines.positionAt(f.start);
                        const end = lines.positionAt(f.end);
                        return { ...f, column: start.character, endLine: end.line, endColumn: end.character, text: message(f.message as MessageId, ...f.args.map(a => (typeof a === 'string' && a.startsWith('category.') ? message(a as MessageId) : a))) };
                    }),
            });
        }
    }

    const reporter = (args.flags.get('reporter') as string | undefined) ?? 'stylish';
    const quiet = args.flags.has('quiet');
    let errors = 0;
    let warnings = 0;
    for (const r of results) {
        for (const f of r.findings) {
            if (f.severity === 'error') {
                errors++;
            } else if (f.severity === 'warning') {
                warnings++;
            }
        }
    }

    if (reporter === 'json') {
        io.out(
            JSON.stringify(
                results.map(r => ({
                    file: r.file,
                    findings: r.findings.map(f => ({
                        rule: f.rule,
                        severity: f.severity,
                        line: f.line + 1,
                        column: f.column + 1,
                        endLine: f.endLine + 1,
                        endColumn: f.endColumn + 1,
                        message: f.text,
                        url: ruleUrl(f.rule),
                    })),
                })),
                null,
                2,
            ),
        );
    } else if (reporter === 'github') {
        for (const r of results) {
            for (const f of r.findings) {
                if (quiet && f.severity !== 'error') {
                    continue;
                }
                const level = f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'notice';
                const text = f.text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
                io.out(`::${level} file=${r.file},line=${f.line + 1},col=${f.column + 1},endLine=${f.endLine + 1},endColumn=${f.endColumn + 1},title=px-to-rem (${f.rule})::${text}`);
            }
        }
    } else {
        for (const r of results) {
            const shown = r.findings.filter(f => !quiet || f.severity === 'error').filter(f => f.severity !== 'hint' || args.flags.has('verbose'));
            if (!shown.length) {
                continue;
            }
            io.out(paint(io, 4, r.file));
            for (const f of shown) {
                const sev = f.severity === 'error' ? paint(io, 31, 'error  ') : f.severity === 'warning' ? paint(io, 33, 'warning') : paint(io, 36, 'info   ');
                io.out(`  ${`${f.line + 1}:${f.column + 1}`.padEnd(8)} ${sev}  ${f.text}  ${paint(io, 90, f.rule)}`);
            }
            io.out('');
        }
        const total = errors + warnings;
        if (total) {
            io.out(paint(io, errors ? 31 : 33, `✖ ${total} problem${total === 1 ? '' : 's'} (${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'})`));
            if (fixable) {
                io.out(`  ${fixable} px value${fixable === 1 ? '' : 's'} can be converted with \`px-to-rem fix\`.`);
            }
        } else if (!quiet) {
            io.out(paint(io, 32, `✔ ${files.length} file${files.length === 1 ? '' : 's'} checked, no problems.`));
        }
    }

    const maxWarnings = Number(args.flags.get('max-warnings') ?? -1);
    return errors > 0 || (maxWarnings >= 0 && warnings > maxWarnings) ? 1 : 0;
}

async function fix(io: Io, args: Args): Promise<number> {
    const { loaded, project, files, changed } = await context(io, args);
    const dryRun = args.flags.has('dry-run');
    let total = 0;
    let touched = 0;
    for (const file of files) {
        if (changed && !changed.has(file)) {
            continue;
        }
        const { text, doc, options, ctx } = parseFile(loaded, file, args.sets, project);
        const plan = planConversion(doc, options, ctx, lineFilterFor(changed, file));
        if (!plan.edits.length) {
            continue;
        }
        total += plan.edits.length;
        touched++;
        const rel = toPosix(relative(io.cwd, file));
        if (dryRun) {
            const lines = new LineIndex(text);
            io.out(paint(io, 4, rel));
            for (const e of plan.edits) {
                const pos = lines.positionAt(e.start);
                io.out(`  ${`${pos.line + 1}:${pos.character + 1}`.padEnd(8)} ${text.slice(e.start, e.end)} → ${e.newText}`);
            }
        } else {
            writeFileSync(file, applyEdits(text, plan.edits));
            if (!args.flags.has('quiet')) {
                io.out(`${rel}: ${plan.edits.length}`);
            }
        }
    }
    if (!args.flags.has('quiet')) {
        io.out(
            total
                ? `${dryRun ? 'Would convert' : 'Converted'} ${total} px value${total === 1 ? '' : 's'} in ${touched} file${touched === 1 ? '' : 's'}.`
                : 'No px values to convert.',
        );
    }
    return dryRun && total ? 1 : 0;
}

async function report(io: Io, args: Args): Promise<number> {
    const { loaded, baseOptions, project, files } = await context(io, args);
    const stats: FileStats[] = [];
    for (const file of files) {
        const { doc, options, ctx } = parseFile(loaded, file, args.sets, project);
        stats.push(analyzeDocument(doc, toPosix(relative(io.cwd, file)), options, ctx));
    }
    const r = buildReport(stats, baseOptions);
    if (args.flags.has('json')) {
        io.out(JSON.stringify({ rootFontSize: project.context.rootFontSize, rootSource: project.rootSource, tokens: project.context.tokens.size, report: r, files: stats.map(({ samples: _samples, ...s }) => s) }, null, 2));
        return 0;
    }
    const px = (n: number) => `${formatNumber(n, { precision: 2, leadingZero: true })}px`;
    io.out(paint(io, 1, `PX to REM report — ${files.length} files`));
    io.out(`  Scalable:        ${Math.round(r.score * 100)}%  (${r.scalable} scalable, ${r.convertible} px to convert, ${r.kept} kept on purpose)`);
    io.out(`  Root font size:  ${px(project.context.rootFontSize)}${project.rootSource ? `  from ${project.rootSource}` : ''}${project.ambiguous ? '  (several values found)' : ''}`);
    io.out(`  Design tokens:   ${project.context.tokens.size}`);
    io.out(`  4px grid:        ${Math.round(r.grid.four * 100)}% of ${r.grid.total} spacing/size values (8px grid: ${Math.round(r.grid.eight * 100)}%)`);
    if (r.typeScale) {
        io.out(`  Type scale:      ${r.typeScale.name} (${r.typeScale.ratio}) from ${px(r.typeScale.base)}, ${Math.round(r.typeScale.fit * 100)}% of sizes fit`);
    }
    if (r.outliers.length) {
        io.out('');
        io.out(paint(io, 1, 'Off-grid values'));
        for (const o of r.outliers.slice(0, 15)) {
            const where = o.occurrences.slice(0, 2).map(w => `${w.file}:${w.line + 1}`).join(', ');
            io.out(`  ${px(o.px).padEnd(10)} ${String(o.count).padStart(4)}×  nearest ${px(o.nearestGrid).padEnd(8)} ${where}`);
        }
    }
    io.out('');
    io.out(paint(io, 1, 'Proposed tokens'));
    io.out(`  spacing:    ${r.spacingProposal.map(px).join(' ')}`);
    io.out(`  font sizes: ${r.fontSizeProposal.map(px).join(' ')}`);
    if (r.radiusProposal.length) {
        io.out(`  radius:     ${r.radiusProposal.map(px).join(' ')}`);
    }
    const worst = [...stats].filter(s => s.convertible).sort((a, b) => b.convertible - a.convertible).slice(0, 10);
    if (worst.length) {
        io.out('');
        io.out(paint(io, 1, 'Most px values'));
        for (const s of worst) {
            io.out(`  ${String(s.convertible).padStart(5)}  ${s.file}`);
        }
    }
    return 0;
}

async function rebase(io: Io, args: Args): Promise<number> {
    const from = Number(args.flags.get('from'));
    const to = Number(args.flags.get('to'));
    if (!(from > 0) || !(to > 0)) {
        io.err('rebase needs --from <px> and --to <px>, e.g. --from 10 --to 16');
        return 2;
    }
    const { loaded, files } = await context(io, args);
    const dryRun = args.flags.has('dry-run');
    let total = 0;
    for (const file of files) {
        const languageId = languageForFileName(file)!;
        const text = readFileSync(file, 'utf8');
        const options = optionsFor(loaded, file, args.sets);
        const doc = parseDocument(text, languageId);
        const plan = planRebase(doc, from, to, options);
        const edits = args.flags.has('root-declarations') ? [...plan.edits, ...plan.rootDeclarations] : plan.edits;
        if (!edits.length) {
            continue;
        }
        total += edits.length;
        const rel = toPosix(relative(io.cwd, file));
        if (dryRun) {
            io.out(`${rel}: ${edits.length}`);
        } else {
            writeFileSync(file, applyEdits(text, edits));
            io.out(`${rel}: ${edits.length}`);
        }
        if (plan.rootDeclarations.length && !args.flags.has('root-declarations')) {
            io.out(`  note: ${rel} sets the html font size; add --root-declarations to update it too.`);
        }
    }
    io.out(`${dryRun ? 'Would rewrite' : 'Rewrote'} ${total} value${total === 1 ? '' : 's'} (${from}px → ${to}px root).`);
    return dryRun && total ? 1 : 0;
}

async function init(io: Io, args: Args): Promise<number> {
    const loaded = loadConfig(io.cwd);
    if (loaded.path) {
        io.err(`${toPosix(relative(io.cwd, loaded.path))} already exists.`);
        return 2;
    }
    const options = optionsFor(loaded, undefined, args.sets);
    const project = await buildProject(loaded, options);
    const ctx = project.context;
    const config: Record<string, unknown> = {
        $schema: 'https://raw.githubusercontent.com/louis-mudrack/px-to-rem/master/schemas/pxtoremrc.schema.json',
        mode: 'smart',
        format: 'auto',
    };
    if (ctx.rootFontSize !== 16 && !project.postcss) {
        config.baseFontSize = ctx.rootFontSize;
    }
    const path = resolve(io.cwd, '.pxtoremrc.json');
    writeFileSync(path, JSON.stringify({ ...config, ...args.sets }, null, 2) + '\n');
    io.out(`Created .pxtoremrc.json`);
    io.out(`  root font size: ${ctx.rootFontSize}px${project.rootSource ? ` (${project.rootSource})` : ''}`);
    io.out(`  rem() helper:   ${ctx.remFunctions.length ? `${ctx.remFunctions[0].name}() in ${ctx.remFunctions[0].source?.file ?? '?'}` : 'none'}`);
    io.out(`  design tokens:  ${ctx.tokens.size}`);
    io.out(`  tailwind:       ${project.tailwindDetected ? 'yes' : 'no'}`);
    return 0;
}

export async function run(argv: string[], io: Io): Promise<number> {
    let args: Args;
    try {
        args = parseArgs(argv);
    } catch (e) {
        io.err(String(e instanceof Error ? e.message : e));
        return 2;
    }
    if (args.flags.has('version')) {
        io.out(VERSION);
        return 0;
    }
    if (args.flags.has('help') || !args.command || args.command === 'help') {
        io.out(HELP);
        return args.command || args.flags.has('help') ? 0 : 2;
    }
    try {
        switch (args.command) {
            case 'check':
                return await check(io, args);
            case 'fix':
                return await fix(io, args);
            case 'report':
                return await report(io, args);
            case 'rebase':
                return await rebase(io, args);
            case 'init':
                return await init(io, args);
            default:
                io.err(`Unknown command "${args.command}". Run px-to-rem --help.`);
                return 2;
        }
    } catch (e) {
        io.err(`px-to-rem: ${e instanceof Error ? e.message : String(e)}`);
        return 2;
    }
}
