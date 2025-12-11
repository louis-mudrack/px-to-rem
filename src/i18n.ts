import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

let currentLocale: any = null;

export function initializeLocale(context: vscode.ExtensionContext): void {
    const locale = getVSCodeLocale();
    loadLocale(context, locale);
}

function getVSCodeLocale(): string {
    const config = JSON.parse(process.env.VSCODE_NLS_CONFIG || '{}');
    return config.locale || 'en';
}

function loadLocale(context: vscode.ExtensionContext, locale: string): void {
    let localeFile = locale;
    
    // Try exact match first (e.g., de-DE)
    let localePath = context.asAbsolutePath(path.join('out', 'locales', `${localeFile}.json`));
    
    if (!fs.existsSync(localePath)) {
        // Try language code only (e.g., de from de-DE)
        localeFile = locale.split('-')[0];
        localePath = context.asAbsolutePath(path.join('out', 'locales', `${localeFile}.json`));
    }
    
    if (!fs.existsSync(localePath)) {
        // Fallback to English
        localeFile = 'en';
        localePath = context.asAbsolutePath(path.join('out', 'locales', `${localeFile}.json`));
    }
    
    try {
        const content = fs.readFileSync(localePath, 'utf8');
        currentLocale = JSON.parse(content);
    } catch (error) {
        // Fallback to English if loading fails
        console.error('Failed to load locale, using English fallback');
        currentLocale = null;
    }
}

export function t(key: string, replacements?: Record<string, string | number>): string {
    if (!currentLocale) {
        return key;
    }
    
    const keys = key.split('.');
    let value: any = currentLocale;
    
    for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
            value = value[k];
        } else {
            return key;
        }
    }
    
    if (typeof value !== 'string') {
        return key;
    }
    
    let result = value;
    
    if (replacements) {
        for (const [replaceKey, replaceValue] of Object.entries(replacements)) {
            result = result.replace(new RegExp(`{{${replaceKey}}}`, 'g'), String(replaceValue));
        }
    }
    
    return result;
}

export function tp(key: string, count: number, replacements?: Record<string, string | number>): string {
    const pluralKey = count === 1 ? key : `${key}_plural`;
    const allReplacements = { count, ...replacements };
    return t(pluralKey, allReplacements);
}
