import { DEFAULT_SMART_RULES, type SmartAction } from './properties';

export type Mode = 'smart' | 'simple';
export type MediaQueryPolicy = 'em' | 'rem' | 'keep' | 'convert';
export type Severity = 'off' | 'hint' | 'information' | 'warning' | 'error';
export type CodeLensMode = 'off' | 'file' | 'rule' | 'line';
export type PasteMode = 'offer' | 'default' | 'off';

/** Every option the engine and the extension understand, fully resolved. */
export interface Options {
    format: string;
    functionName: string;
    mode: Mode;
    baseFontSize: number;
    baseFontSizeDetection: 'auto' | 'off';
    precision: number;
    leadingZero: boolean;
    preserveZero: boolean;
    minValue: number;
    maxValue: number;
    includeProperties: string[];
    excludeProperties: string[];
    excludePatterns: string[];
    ignoreUppercasePx: boolean;
    mediaQueries: MediaQueryPolicy;
    mediaQueryBase: number;
    interpolateInCalc: boolean;
    convertVariables: boolean;
    convertMixinArguments: boolean;
    smartRules: Record<string, SmartAction>;
    hairline: number;
    designWidth: number;
    designHeight: number;
    reverseUnits: string[];
    fluid: {
        minViewport: number;
        maxViewport: number;
        breakpoints: number[];
        unit: 'vw' | 'cqi';
        checkZoom: boolean;
    };
    tokens: {
        enable: boolean;
        sources: string[];
        autoDetect: boolean;
        preferTokens: boolean;
        reference: string;
        colors: boolean;
        colorTolerance: number;
    };
    tailwind: {
        enable: 'auto' | 'on' | 'off';
        preferScale: boolean;
    };
    js: {
        templateLiterals: boolean;
        objectStyles: boolean;
        unitlessNumbers: boolean;
    };
    languages: string[];
    fileTypes: string[];
    excludeFiles: string[];
    respectGitignore: boolean;
    maxFileSize: number;
    convertOnSave: boolean;
    completion: { enable: boolean };
    paste: { mode: PasteMode };
    hover: { enable: boolean };
    inlayHints: { enable: boolean; variables: boolean };
    codeLens: CodeLensMode;
    statusBar: { enable: boolean };
    diagnostics: {
        enable: boolean;
        rules: Record<string, Severity>;
        scope: 'all' | 'changedLines';
    };
    workspace: {
        saveAfterConvert: boolean;
        maxFiles: number;
    };
}

/** Diagnostic rule ids with their default severities. */
export const DEFAULT_RULE_SEVERITIES: Readonly<Record<string, Severity>> = {
    'px-unit': 'off',
    'font-size-px': 'information',
    'line-height-px': 'information',
    'letter-spacing-px': 'hint',
    'media-query-px': 'hint',
    'fixed-height-text': 'hint',
    'text-width-px': 'hint',
    'viewport-font-size': 'warning',
    'fluid-zoom': 'warning',
    'off-scale': 'hint',
    'off-palette': 'hint',
    'rem-function-missing': 'warning',
};

export const RULE_IDS = Object.keys(DEFAULT_RULE_SEVERITIES);

export const DEFAULT_LANGUAGES = [
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
    'javascriptreact',
    'typescriptreact',
    'javascript',
    'typescript',
];

/** Output presets accepted by `format`. Anything containing `{` is a custom template. */
export const FORMAT_PRESETS: Readonly<Record<string, string>> = {
    rem: '{rem}rem',
    'rem-function': '{fn}({px})',
    'rem-function-px': '{fn}({px}px)',
    em: '{em}em',
    vw: '{vw}vw',
    vh: '{vh}vh',
    vmin: '{vmin}vmin',
    vmax: '{vmax}vmax',
    rpx: '{rpx}rpx',
    pt: '{pt}pt',
};

export type OptionType = 'boolean' | 'number' | 'string' | 'array' | 'object';

/** Metadata used to generate VS Code settings and the `.pxtoremrc.json` schema. */
export interface OptionDef {
    key: string;
    type: OptionType;
    default: unknown;
    description: string;
    enum?: readonly string[];
    enumDescriptions?: readonly string[];
    items?: { type: string; enum?: readonly string[] };
    minimum?: number;
    maximum?: number;
    /** VS Code configuration scope. */
    scope?: 'window' | 'resource' | 'language-overridable';
    /** Value schema for object options. */
    additionalProperties?: { type: string; enum?: readonly string[] };
    /** Whether `.pxtoremrc.json` may set this option (editor-only options may not). */
    configFile?: boolean;
    /** Marks a pre-2.0 option that is still read but should not be used. */
    deprecated?: string;
    /** Settings UI order. */
    order?: number;
    tags?: string[];
}

const SMART_ACTIONS = ['convert', 'rem', 'em', 'unitless', 'keep'] as const;
const SEVERITIES = ['off', 'hint', 'information', 'warning', 'error'] as const;
const REVERSE_UNITS = ['rem', 'em', 'vw', 'vh', 'vmin', 'vmax', 'rpx', 'pt', 'function'] as const;

export const OPTION_DEFS: readonly OptionDef[] = [
    {
        key: 'format',
        type: 'string',
        default: 'auto',
        scope: 'language-overridable',
        description:
            'Output for converted values. Presets: `auto` (uses your `rem()` function in preprocessor files when the project defines one, otherwise `1rem`), `rem` (`1rem`), `rem-function` (`rem(16)`), `rem-function-px` (`rem(16px)`), `em`, `vw`, `vh`, `vmin`, `vmax`, `rpx`, `pt`. Or a template with `{rem}`, `{px}`, `{em}`, `{vw}`, `{vh}`, `{vmin}`, `{vmax}`, `{rpx}`, `{pt}` and `{fn}` (the function name), e.g. `toRem({px})`.',
    },
    {
        key: 'functionName',
        type: 'string',
        default: 'rem',
        description: 'Name of your px-to-rem function, used by the function formats, reverse conversion and helper generation.',
    },
    {
        key: 'mode',
        type: 'string',
        default: 'smart',
        enum: ['smart', 'simple'],
        enumDescriptions: [
            'Pick the best unit per property: font sizes and spacing become rem, line-height becomes unitless, letter-spacing becomes em, borders and shadows stay px, media queries become em.',
            'Convert every px value with the same format.',
        ],
        description: 'How values are converted.',
    },
    {
        key: 'baseFontSize',
        type: 'number',
        default: 16,
        minimum: 1,
        description: 'Root font size in px (1rem). Used when detection is off or finds nothing.',
    },
    {
        key: 'baseFontSizeDetection',
        type: 'string',
        default: 'auto',
        enum: ['auto', 'off'],
        enumDescriptions: [
            'Read the root font size from `html`/`:root` rules (e.g. `font-size: 62.5%` → 10px) or a postcss-pxtorem `rootValue`, unless `baseFontSize` is set explicitly.',
            'Always use `baseFontSize`.',
        ],
        description: 'Detect the root font size from the project.',
    },
    { key: 'precision', type: 'number', default: 4, minimum: 0, maximum: 10, description: 'Maximum number of decimal places in generated values.' },
    { key: 'leadingZero', type: 'boolean', default: true, description: 'Write `0.5rem` instead of `.5rem`.' },
    { key: 'preserveZero', type: 'boolean', default: true, description: 'Write `0px` as `0` instead of `0rem`.' },
    { key: 'minValue', type: 'number', default: 0, minimum: 0, description: 'Smallest absolute px value to convert (e.g. 2 keeps 1px).' },
    { key: 'maxValue', type: 'number', default: 9999, minimum: 0, description: 'Largest absolute px value to convert.' },
    {
        key: 'includeProperties',
        type: 'array',
        default: [],
        items: { type: 'string' },
        description: 'Only convert these properties (globs such as `padding*` work). Empty means all.',
    },
    {
        key: 'excludeProperties',
        type: 'array',
        default: [],
        items: { type: 'string' },
        description: 'Never convert these properties (globs such as `border*` work).',
    },
    {
        key: 'excludePatterns',
        type: 'array',
        default: [],
        items: { type: 'string' },
        description: 'Regular expressions; lines that match are left alone. Prefer `/* px-to-rem-disable-next-line */` comments.',
    },
    { key: 'ignoreUppercasePx', type: 'boolean', default: true, description: 'Leave `PX` (uppercase) alone, like postcss-pxtorem.' },
    {
        key: 'mediaQueries',
        type: 'string',
        default: 'em',
        enum: ['em', 'rem', 'keep', 'convert'],
        enumDescriptions: [
            'Convert breakpoints to em (relative to the browser default, so they follow the user font size).',
            'Convert breakpoints to rem (also relative to the browser default inside media queries).',
            'Leave media and container queries alone.',
            'Use `format` like everywhere else.',
        ],
        description: 'What to do with px in `@media` and `@container` queries.',
    },
    {
        key: 'mediaQueryBase',
        type: 'number',
        default: 16,
        minimum: 1,
        description: 'Font size media queries are relative to. Browsers use their default (16px), not your `html` font size.',
    },
    { key: 'interpolateInCalc', type: 'boolean', default: false, description: 'Wrap function output in `#{}` inside `calc()`, `clamp()`, `min()` and `max()` (Sass).' },
    { key: 'convertVariables', type: 'boolean', default: true, description: 'Convert values of Sass/Less/Stylus variables and CSS custom properties.' },
    { key: 'convertMixinArguments', type: 'boolean', default: true, description: 'Convert px passed to mixins (`@include size(16px)`). Breakpoint mixins are never touched.' },
    {
        key: 'smartRules',
        type: 'object',
        default: {},
        additionalProperties: { type: 'string', enum: SMART_ACTIONS },
        description:
            'Smart mode rules per property (globs allowed), merged over the defaults. Actions: `convert` (use `format`), `rem`, `em` (relative to the element font size), `unitless` (ratio to the element font size), `keep`.',
    },
    {
        key: 'hairline',
        type: 'number',
        default: 1,
        minimum: 0,
        description: 'Smart mode keeps values up to this many px as px (hairlines, 1px nudges). 0 turns it off.',
    },
    { key: 'designWidth', type: 'number', default: 1440, minimum: 1, description: 'Design viewport width in px, for vw, vmin, vmax and rpx.' },
    { key: 'designHeight', type: 'number', default: 900, minimum: 1, description: 'Design viewport height in px, for vh, vmin and vmax.' },
    {
        key: 'reverseUnits',
        type: 'array',
        default: ['rem', 'function'],
        items: { type: 'string', enum: REVERSE_UNITS },
        description: 'What "Convert back to px" rewrites: `rem`, `em`, `vw`, `vh`, `vmin`, `vmax`, `rpx`, `pt` and `function` (`rem(16)`).',
    },
    { key: 'fluid.minViewport', type: 'number', default: 375, minimum: 1, description: 'Smallest viewport width for fluid `clamp()` values.' },
    { key: 'fluid.maxViewport', type: 'number', default: 1440, minimum: 1, description: 'Largest viewport width for fluid `clamp()` values.' },
    {
        key: 'fluid.breakpoints',
        type: 'array',
        default: [320, 375, 768, 1024, 1280, 1440, 1920],
        items: { type: 'number' },
        description: 'Viewport widths shown when explaining `clamp()`, `calc()`, `min()` and `max()`.',
    },
    {
        key: 'fluid.unit',
        type: 'string',
        default: 'vw',
        enum: ['vw', 'cqi'],
        enumDescriptions: ['Scale with the viewport.', 'Scale with the nearest container (container query units).'],
        description: 'Unit that makes generated `clamp()` values fluid.',
    },
    { key: 'fluid.checkZoom', type: 'boolean', default: true, description: 'Check fluid font sizes against WCAG 1.4.4 (text must reach 200% with browser zoom).' },
    { key: 'tokens.enable', type: 'boolean', default: true, description: 'Use design tokens (CSS custom properties, Sass/Less/Stylus variables, token JSON files) for snapping, hovers and quick fixes.' },
    {
        key: 'tokens.sources',
        type: 'array',
        default: [],
        items: { type: 'string' },
        description: 'Files or globs that define tokens (`.css`, `.scss`, `.less`, `.styl`, DTCG/Tokens Studio/Style Dictionary `.json`). Empty means auto-detect.',
    },
    { key: 'tokens.autoDetect', type: 'boolean', default: true, description: 'Find tokens in the workspace when `tokens.sources` is empty.' },
    { key: 'tokens.preferTokens', type: 'boolean', default: false, description: 'When a px value exactly matches a token, convert it to the token (e.g. `var(--space-4)`) instead of rem.' },
    {
        key: 'tokens.reference',
        type: 'string',
        default: 'var(--{name})',
        description: 'How tokens from JSON files are referenced in CSS. `{name}` is the token path joined with `-`.',
    },
    { key: 'tokens.colors', type: 'boolean', default: true, description: 'Also match literal colours against colour tokens.' },
    {
        key: 'tokens.colorTolerance',
        type: 'number',
        default: 3,
        minimum: 0,
        description: 'Maximum colour difference (CIEDE2000) for suggesting a nearby colour token. Around 2 is barely visible.',
    },
    {
        key: 'tailwind.enable',
        type: 'string',
        default: 'auto',
        enum: ['auto', 'on', 'off'],
        enumDescriptions: ['On when the project depends on Tailwind CSS.', 'Always on.', 'Off.'],
        description: 'Convert Tailwind arbitrary values such as `p-[16px]`.',
    },
    { key: 'tailwind.preferScale', type: 'boolean', default: true, description: 'Use the scale class when one matches (`p-[16px]` → `p-4`) instead of `p-[1rem]`.' },
    { key: 'js.templateLiterals', type: 'boolean', default: true, description: 'Convert CSS in styled-components, emotion, Lit and Linaria templates.' },
    { key: 'js.objectStyles', type: 'boolean', default: true, description: "Convert px strings in style objects (`{ fontSize: '16px' }`)." },
    {
        key: 'js.unitlessNumbers',
        type: 'boolean',
        default: false,
        description: "Also convert numbers React treats as px (`{ fontSize: 16 }` → `{ fontSize: '1rem' }`). Off by default; React Native projects never convert.",
    },
    {
        key: 'languages',
        type: 'array',
        default: DEFAULT_LANGUAGES,
        items: { type: 'string' },
        configFile: false,
        description: 'Language ids the extension works in.',
    },
    {
        key: 'fileTypes',
        type: 'array',
        default: ['css', 'scss', 'sass', 'less', 'styl', 'pcss', 'vue', 'svelte', 'astro', 'html', 'jsx', 'tsx'],
        items: { type: 'string' },
        description: 'File extensions included in workspace conversion and statistics.',
    },
    {
        key: 'excludeFiles',
        type: 'array',
        default: [],
        items: { type: 'string' },
        description: 'Glob patterns for files to ignore (e.g. `**/*.min.css`, `**/vendor/**`). `node_modules` is always ignored.',
    },
    { key: 'respectGitignore', type: 'boolean', default: true, description: 'Skip files ignored by `.gitignore` in workspace operations.' },
    {
        key: 'maxFileSize',
        type: 'number',
        default: 1000000,
        minimum: 1000,
        configFile: false,
        description: 'Files larger than this many characters skip live features (diagnostics, hints, CodeLens).',
    },
    { key: 'convertOnSave', type: 'boolean', default: false, configFile: false, description: 'Convert px values when saving. Alternatively add `"source.pxToRem.convert": "explicit"` to `editor.codeActionsOnSave`.' },
    { key: 'completion.enable', type: 'boolean', default: true, configFile: false, description: 'Suggest rem (and matching tokens) while typing px values.' },
    {
        key: 'paste.mode',
        type: 'string',
        default: 'offer',
        enum: ['offer', 'default', 'off'],
        enumDescriptions: [
            'Pasting CSS keeps it as is and offers "Paste as rem" in the paste menu.',
            'Pasting CSS converts it; plain paste stays available in the paste menu.',
            'Do not touch pasting.',
        ],
        configFile: false,
        description: 'Convert CSS when pasting (from Figma, DevTools, …).',
    },
    { key: 'hover.enable', type: 'boolean', default: true, configFile: false, description: 'Show conversions, tokens and explanations on hover.' },
    { key: 'inlayHints.enable', type: 'boolean', default: true, configFile: false, description: 'Show px equivalents after rem, em, vw and `rem()` values.' },
    { key: 'inlayHints.variables', type: 'boolean', default: true, configFile: false, description: 'Also show resolved values after `var(--x)`, `$x` and `@x`.' },
    {
        key: 'codeLens',
        type: 'string',
        default: 'file',
        enum: ['off', 'file', 'rule', 'line'],
        enumDescriptions: ['No CodeLens.', 'One summary at the top of the file.', 'One per rule with px values.', 'One per line with px values.'],
        configFile: false,
        description: 'Where "Convert N px values" CodeLens appears.',
    },
    { key: 'statusBar.enable', type: 'boolean', default: true, configFile: false, description: 'Show the root font size and px count in the status bar.' },
    { key: 'diagnostics.enable', type: 'boolean', default: true, description: 'Report diagnostics (accessibility, off-scale values, …).' },
    {
        key: 'diagnostics.rules',
        type: 'object',
        default: {},
        additionalProperties: { type: 'string', enum: SEVERITIES },
        description: `Severity per rule, merged over the defaults. Rules: ${RULE_IDS.map(r => '`' + r + '`').join(', ')}.`,
    },
    {
        key: 'diagnostics.scope',
        type: 'string',
        default: 'all',
        enum: ['all', 'changedLines'],
        enumDescriptions: ['Report everywhere.', 'Only report on lines changed since the last commit (git).'],
        description: 'Where diagnostics are reported.',
    },
    { key: 'workspace.saveAfterConvert', type: 'boolean', default: false, configFile: false, description: 'Save files after a workspace conversion is applied.' },
    { key: 'workspace.maxFiles', type: 'number', default: 5000, minimum: 1, description: 'Maximum number of files scanned for workspace statistics and conversion.' },

    // Pre-2.0 options, still honoured.
    { key: 'directConversion', type: 'boolean', default: false, configFile: false, deprecated: 'Use `pxToRem.format`: "rem" (was true) or "rem-function" (was false).' },
    { key: 'keepPxInRem', type: 'boolean', default: false, configFile: false, deprecated: 'Use `pxToRem.format`: "rem-function-px".' },
    { key: 'scssInterpolation', type: 'boolean', default: false, configFile: false, deprecated: 'Use `pxToRem.interpolateInCalc`.' },
    { key: 'enableDiagnostics', type: 'boolean', default: false, configFile: false, deprecated: 'Use `pxToRem.diagnostics.rules` → `px-unit`.' },
    {
        key: 'diagnosticSeverity',
        type: 'string',
        default: 'information',
        enum: ['error', 'warning', 'information', 'hint'],
        configFile: false,
        deprecated: 'Use `pxToRem.diagnostics.rules` → `px-unit`.',
    },
    { key: 'enableCodeLens', type: 'boolean', default: true, configFile: false, deprecated: 'Use `pxToRem.codeLens`.' },
    { key: 'enableInlayHints', type: 'boolean', default: true, configFile: false, deprecated: 'Use `pxToRem.inlayHints.enable`.' },
].map(def => ({ ...def, description: def.description ?? def.deprecated ?? '' })) as OptionDef[];

const LEGACY_KEYS = new Set(OPTION_DEFS.filter(d => d.deprecated).map(d => d.key));

export function defaultOptions(): Options {
    const out: Record<string, unknown> = {};
    for (const def of OPTION_DEFS) {
        if (!LEGACY_KEYS.has(def.key)) {
            setPath(out, def.key, structuredClone(def.default));
        }
    }
    const options = out as unknown as Options;
    options.smartRules = { ...DEFAULT_SMART_RULES };
    options.diagnostics.rules = { ...DEFAULT_RULE_SEVERITIES };
    return options;
}

export function getPath(obj: unknown, key: string): unknown {
    let cur: unknown = obj;
    for (const part of key.split('.')) {
        if (cur === null || typeof cur !== 'object') {
            return undefined;
        }
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

export function setPath(obj: Record<string, unknown>, key: string, value: unknown): void {
    const parts = key.split('.');
    let cur = obj;
    for (const part of parts.slice(0, -1)) {
        if (typeof cur[part] !== 'object' || cur[part] === null) {
            cur[part] = {};
        }
        cur = cur[part] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
}

/** A partial set of options keyed by dotted paths (`tokens.sources`) or nested objects. */
export type PartialOptions = Record<string, unknown>;

/** Flattens `{ tokens: { sources: [] } }` to `{ 'tokens.sources': [] }` for known keys. */
export function flattenOptions(input: PartialOptions): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const def of OPTION_DEFS) {
        const direct = input[def.key];
        const nested = getPath(input, def.key);
        const value = direct !== undefined ? direct : nested;
        if (value !== undefined) {
            out[def.key] = value;
        }
    }
    return out;
}

/** Returns a copy of `base` with validated values from `layer` applied. Object options merge. */
export function applyOptions(base: Options, layer: PartialOptions): Options {
    const out = structuredClone(base) as unknown as Record<string, unknown>;
    const flat = flattenOptions(layer);
    for (const def of OPTION_DEFS) {
        if (!(def.key in flat) || LEGACY_KEYS.has(def.key)) {
            continue;
        }
        const value = coerce(def, flat[def.key]);
        if (value === undefined) {
            continue;
        }
        if (def.type === 'object') {
            setPath(out, def.key, { ...(getPath(out, def.key) as object), ...(value as object) });
        } else {
            setPath(out, def.key, value);
        }
    }
    return out as unknown as Options;
}

function coerce(def: OptionDef, value: unknown): unknown {
    switch (def.type) {
        case 'boolean':
            return typeof value === 'boolean' ? value : undefined;
        case 'number': {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return undefined;
            }
            let v = value;
            if (def.minimum !== undefined) {
                v = Math.max(def.minimum, v);
            }
            if (def.maximum !== undefined) {
                v = Math.min(def.maximum, v);
            }
            return v;
        }
        case 'string':
            if (typeof value !== 'string') {
                return undefined;
            }
            if (def.enum && !def.enum.includes(value)) {
                return undefined;
            }
            return value;
        case 'array':
            return Array.isArray(value) ? value.filter(v => (def.items?.type === 'number' ? typeof v === 'number' : typeof v === 'string')) : undefined;
        case 'object': {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return undefined;
            }
            const allowed = def.additionalProperties?.enum;
            const entries = Object.entries(value as Record<string, unknown>).filter(
                ([, v]) => typeof v === 'string' && (!allowed || allowed.includes(v)),
            );
            return Object.fromEntries(entries);
        }
    }
}

/** Values of pre-2.0 settings that the user set explicitly. */
export interface LegacySettings {
    directConversion?: boolean;
    keepPxInRem?: boolean;
    scssInterpolation?: boolean;
    enableDiagnostics?: boolean;
    diagnosticSeverity?: string;
    enableCodeLens?: boolean;
    enableInlayHints?: boolean;
}

/**
 * Maps explicitly-set pre-2.0 settings onto new options, unless the
 * corresponding new option was set explicitly too.
 */
export function legacyLayer(legacy: LegacySettings, explicitNewKeys: ReadonlySet<string>): PartialOptions {
    const layer: PartialOptions = {};
    if (!explicitNewKeys.has('format')) {
        if (legacy.directConversion === true) {
            layer.format = 'rem';
        } else if (legacy.keepPxInRem === true) {
            layer.format = 'rem-function-px';
        } else if (legacy.directConversion === false) {
            layer.format = 'rem-function';
        }
    }
    if (legacy.scssInterpolation !== undefined && !explicitNewKeys.has('interpolateInCalc')) {
        layer.interpolateInCalc = legacy.scssInterpolation;
    }
    if (legacy.enableDiagnostics === true && !explicitNewKeys.has('diagnostics.rules')) {
        const severity = (['error', 'warning', 'information', 'hint'] as const).find(s => s === legacy.diagnosticSeverity) ?? 'information';
        layer['diagnostics.rules'] = { 'px-unit': severity };
    }
    if (legacy.enableCodeLens === false && !explicitNewKeys.has('codeLens')) {
        layer.codeLens = 'off';
    }
    if (legacy.enableInlayHints === false && !explicitNewKeys.has('inlayHints.enable')) {
        layer['inlayHints.enable'] = false;
    }
    return layer;
}

/** A `.pxtoremrc.json` file. */
export interface ConfigFile extends PartialOptions {
    overrides?: { files: string | string[]; [key: string]: unknown }[];
}

/**
 * Applies a config file and the `overrides` entries whose globs match
 * `relativePath`. `matches` performs the glob test (minimatch in practice).
 */
export function applyConfigFile(
    base: Options,
    config: ConfigFile | undefined,
    relativePath: string | undefined,
    matches: (path: string, glob: string) => boolean,
): Options {
    if (!config) {
        return base;
    }
    const allowed = Object.fromEntries(
        Object.entries(flattenOptions(config)).filter(([key]) => OPTION_DEFS.find(d => d.key === key)?.configFile !== false),
    );
    let out = applyOptions(base, allowed);
    if (relativePath && Array.isArray(config.overrides)) {
        for (const override of config.overrides) {
            const globs = Array.isArray(override.files) ? override.files : [override.files];
            if (globs.some(g => typeof g === 'string' && matches(relativePath, g))) {
                const { files: _files, ...rest } = override;
                out = applyOptions(out, rest);
            }
        }
    }
    return out;
}

/** Resolves the `format` preset to a template. */
export function formatTemplate(format: string): string {
    if (format.includes('{')) {
        return format;
    }
    return FORMAT_PRESETS[format] ?? FORMAT_PRESETS.rem;
}

const CSS_NATIVE_FUNCTIONS = new Set(['var', 'calc', 'clamp', 'min', 'max', 'env', 'round', 'mod', 'abs']);

/**
 * Whether a template produces a preprocessor/JS function call (`rem(16)`),
 * which plain CSS cannot evaluate.
 */
export function isFunctionTemplate(template: string): boolean {
    const m = /^(?:#\{|\$\{)?\s*(\{fn\}|[A-Za-z_$][\w$.-]*)\s*\(/.exec(template);
    return !!m && !CSS_NATIVE_FUNCTIONS.has(m[1].toLowerCase());
}
