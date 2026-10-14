import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const nodeBuiltins = ['fs', 'path', 'os', 'child_process', 'util', 'crypto', 'url', 'process', 'stream', 'events'];
const restrictNode = nodeBuiltins.flatMap(name => [name, `node:${name}`]);

export default tseslint.config(
    { ignores: ['dist/**', 'cli/dist/**', 'node_modules/**', '.vscode-test/**', 'out/**', 'coverage/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: { globals: { ...globals.node } },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            curly: 'error',
        },
    },
    {
        // The engine runs in the desktop extension, the web extension and the CLI.
        files: ['src/core/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', { paths: ['vscode', ...restrictNode] }],
            'no-restricted-globals': ['error', 'process', 'require', 'Buffer', '__dirname'],
        },
    },
    {
        // The extension also runs on vscode.dev, so no Node APIs.
        files: ['src/extension/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', { paths: restrictNode }],
        },
    },
    {
        files: ['src/webview/**/*.ts'],
        languageOptions: { globals: { ...globals.browser } },
    },
);
