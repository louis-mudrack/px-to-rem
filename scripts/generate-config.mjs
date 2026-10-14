// Generates `contributes.configuration` in package.json, schemas/pxtoremrc.schema.json
// and the setting descriptions in package.nls.json from src/core/options.ts.
// Run with `npm run gen`; `node scripts/generate-config.mjs --check` fails when files are stale.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const check = process.argv.includes('--check');

const bundle = await esbuild.build({
    entryPoints: ['src/core/options.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
});
const { OPTION_DEFS, DEFAULT_RULE_SEVERITIES } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { DEFAULT_SMART_RULES } = await import(
    `data:text/javascript;base64,${Buffer.from(
        (await esbuild.build({ entryPoints: ['src/core/properties.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral' })).outputFiles[0].text,
    ).toString('base64')}`
);

const GROUPS = [
    { id: 'conversion', title: 'Conversion', keys: ['format', 'functionName', 'mode', 'baseFontSize', 'baseFontSizeDetection', 'precision', 'leadingZero', 'preserveZero', 'designWidth', 'designHeight', 'reverseUnits'] },
    { id: 'smart', title: 'Smart mode & filters', keys: ['smartRules', 'hairline', 'mediaQueries', 'mediaQueryBase', 'minValue', 'maxValue', 'includeProperties', 'excludeProperties', 'excludePatterns', 'ignoreUppercasePx', 'convertVariables', 'convertMixinArguments', 'interpolateInCalc'] },
    { id: 'fluid', title: 'Fluid type', prefix: 'fluid.' },
    { id: 'tokens', title: 'Design tokens', prefix: 'tokens.' },
    { id: 'frameworks', title: 'Frameworks & languages', keys: ['languages'], prefixes: ['tailwind.', 'js.'] },
    { id: 'editor', title: 'Editor', keys: ['convertOnSave', 'codeLens', 'maxFileSize'], prefixes: ['completion.', 'paste.', 'hover.', 'inlayHints.', 'statusBar.'] },
    { id: 'diagnostics', title: 'Diagnostics', prefix: 'diagnostics.' },
    { id: 'workspace', title: 'Workspace', keys: ['fileTypes', 'excludeFiles', 'respectGitignore'], prefixes: ['workspace.'] },
];

function groupOf(def) {
    if (def.deprecated) {
        return 'deprecated';
    }
    for (const g of GROUPS) {
        if (g.keys?.includes(def.key) || (g.prefix && def.key.startsWith(g.prefix)) || g.prefixes?.some(p => def.key.startsWith(p))) {
            return g.id;
        }
    }
    throw new Error(`No settings group for ${def.key}`);
}

const nls = JSON.parse(readFileSync('package.nls.json', 'utf8'));
for (const key of Object.keys(nls)) {
    if (key.startsWith('config.')) {
        delete nls[key];
    }
}

function vscodeProperty(def, order) {
    const prop = { type: def.type };
    if (def.key === 'smartRules') {
        prop.default = {};
    } else {
        prop.default = def.default;
    }
    const descKey = `config.${def.key}`;
    if (def.deprecated) {
        nls[descKey] = def.deprecated;
        prop.markdownDeprecationMessage = `%${descKey}%`;
    } else {
        nls[descKey] = def.description;
        prop.markdownDescription = `%${descKey}%`;
    }
    if (def.enum) {
        prop.enum = def.enum;
        if (def.enumDescriptions) {
            prop.enumDescriptions = def.enumDescriptions.map((d, i) => {
                const k = `config.${def.key}.${def.enum[i]}`;
                nls[k] = d;
                return `%${k}%`;
            });
        }
    }
    if (def.items) {
        prop.items = { ...def.items };
    }
    if (def.minimum !== undefined) {
        prop.minimum = def.minimum;
    }
    if (def.maximum !== undefined) {
        prop.maximum = def.maximum;
    }
    if (def.additionalProperties) {
        prop.additionalProperties = { ...def.additionalProperties };
    }
    if (def.key === 'diagnostics.rules') {
        prop.properties = Object.fromEntries(
            Object.entries(DEFAULT_RULE_SEVERITIES).map(([rule, severity]) => [rule, { type: 'string', enum: def.additionalProperties.enum, default: severity }]),
        );
    }
    if (def.scope) {
        prop.scope = def.scope;
    } else if (!['languages', 'maxFileSize'].includes(def.key)) {
        prop.scope = 'resource';
    }
    prop.order = order;
    return prop;
}

const configuration = [];
let order = 0;
for (const group of [...GROUPS, { id: 'deprecated', title: 'Deprecated' }]) {
    const properties = {};
    for (const def of OPTION_DEFS.filter(d => groupOf(d) === group.id)) {
        properties[`pxToRem.${def.key}`] = vscodeProperty(def, order++);
    }
    const titleKey = `config.title.${group.id}`;
    nls[titleKey] = `PX to REM: ${group.title}`;
    configuration.push({ id: `pxToRem.${group.id}`, title: `%${titleKey}%`, properties });
}

// JSON schema for .pxtoremrc.json --------------------------------------------------
function schemaProperty(def) {
    const prop = { type: def.type, description: def.description.replace(/`/g, ''), markdownDescription: def.description, default: def.default };
    if (def.key === 'smartRules') {
        prop.default = {};
        prop.examples = [{ border: 'convert', 'letter-spacing': 'rem' }];
        prop.description += ` Defaults: ${JSON.stringify(DEFAULT_SMART_RULES)}`;
    }
    if (def.enum) {
        prop.enum = def.enum;
        if (def.enumDescriptions) {
            prop.markdownEnumDescriptions = def.enumDescriptions;
        }
    }
    if (def.items) {
        prop.items = { ...def.items };
    }
    if (def.minimum !== undefined) {
        prop.minimum = def.minimum;
    }
    if (def.maximum !== undefined) {
        prop.maximum = def.maximum;
    }
    if (def.additionalProperties) {
        prop.additionalProperties = { ...def.additionalProperties };
    }
    if (def.key === 'diagnostics.rules') {
        prop.properties = Object.fromEntries(Object.keys(DEFAULT_RULE_SEVERITIES).map(rule => [rule, { type: 'string', enum: def.additionalProperties.enum }]));
    }
    return prop;
}

function nestedProperties() {
    const root = {};
    for (const def of OPTION_DEFS) {
        if (def.configFile === false || def.deprecated) {
            continue;
        }
        const parts = def.key.split('.');
        let cur = root;
        for (const part of parts.slice(0, -1)) {
            cur[part] ??= { type: 'object', properties: {}, additionalProperties: false };
            cur = cur[part].properties;
        }
        cur[parts[parts.length - 1]] = schemaProperty(def);
    }
    return root;
}

const optionProperties = nestedProperties();
const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://raw.githubusercontent.com/louis-mudrack/px-to-rem/master/schemas/pxtoremrc.schema.json',
    title: 'PX to REM Toolkit configuration (.pxtoremrc.json)',
    description: 'Project settings for the PX to REM Toolkit VS Code extension and the px-to-rem CLI.',
    type: 'object',
    properties: {
        $schema: { type: 'string' },
        ...optionProperties,
        overrides: {
            type: 'array',
            description: 'Settings for files matching glob patterns (relative to the project root).',
            items: {
                type: 'object',
                required: ['files'],
                properties: {
                    files: { description: 'Glob pattern(s).', oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
                    ...optionProperties,
                },
                additionalProperties: false,
            },
        },
    },
    additionalProperties: false,
};

// Write -------------------------------------------------------------------------
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.contributes ??= {};
pkg.contributes.configuration = configuration;

const outputs = [
    ['package.json', JSON.stringify(pkg, null, 2) + '\n'],
    ['schemas/pxtoremrc.schema.json', JSON.stringify(schema, null, 2) + '\n'],
    ['package.nls.json', JSON.stringify(Object.fromEntries(Object.entries(nls).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n'],
];

let stale = false;
for (const [file, content] of outputs) {
    let current = '';
    try {
        current = readFileSync(file, 'utf8');
    } catch {
        // New file.
    }
    if (current !== content) {
        stale = true;
        if (!check) {
            writeFileSync(file, content);
            console.log(`updated ${file}`);
        }
    }
}
if (check && stale) {
    console.error('Generated configuration is out of date. Run `npm run gen`.');
    process.exit(1);
}
