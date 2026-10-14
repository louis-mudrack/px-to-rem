import type { DeclarationNode, BlockNode } from './parser';
import type { FunctionCallNode, LengthNode, ParsedDocument } from './document';
import type { Options } from './options';
import type { Syntax } from './syntax';
import type { TailwindConfig } from './tailwind';
import { EMPTY_TOKENS, type SourceRef, type TokenIndex } from './tokens';

/** A user-defined px-to-rem function found in the project. */
export interface RemFunctionDef {
    name: string;
    syntax: Syntax | 'js';
    source?: SourceRef;
    /** Default base argument (`$base: 16px`), when declared. */
    base?: number;
}

/** Facts about the project that conversions depend on. */
export interface ProjectContext {
    rootFontSize: number;
    rootFontSizeSource?: SourceRef;
    remFunctions: RemFunctionDef[];
    tokens: TokenIndex;
    /** Set when Tailwind support is active. */
    tailwind?: TailwindConfig;
    /** React Native projects have no rem; JS object conversion is disabled. */
    reactNative?: boolean;
}

export function createContext(options: Options, partial: Partial<ProjectContext> = {}): ProjectContext {
    return {
        rootFontSize: options.baseFontSize,
        remFunctions: [],
        tokens: EMPTY_TOKENS,
        ...partial,
    };
}

interface DocIndex {
    lengthsByDecl: Map<DeclarationNode, LengthNode[]>;
    functionsByDecl: Map<DeclarationNode, FunctionCallNode[]>;
}

const indexes = new WeakMap<ParsedDocument, DocIndex>();

function indexOf(doc: ParsedDocument): DocIndex {
    let index = indexes.get(doc);
    if (!index) {
        index = { lengthsByDecl: new Map(), functionsByDecl: new Map() };
        for (const l of doc.lengths) {
            if (l.decl) {
                const list = index.lengthsByDecl.get(l.decl) ?? [];
                list.push(l);
                index.lengthsByDecl.set(l.decl, list);
            }
        }
        for (const f of doc.functions) {
            if (f.decl) {
                const list = index.functionsByDecl.get(f.decl) ?? [];
                list.push(f);
                index.functionsByDecl.set(f.decl, list);
            }
        }
        indexes.set(doc, index);
    }
    return index;
}

export function lengthsOf(doc: ParsedDocument, decl: DeclarationNode): LengthNode[] {
    return indexOf(doc).lengthsByDecl.get(decl) ?? [];
}

export function functionsOf(doc: ParsedDocument, decl: DeclarationNode): FunctionCallNode[] {
    return indexOf(doc).functionsByDecl.get(decl) ?? [];
}

type Relation = 'same' | 'descendant' | 'unknown';

/** How the elements of a nested rule relate to the elements of its parent rule. */
export function selectorRelation(selector: string | undefined): Relation {
    if (selector === undefined) {
        return 'unknown';
    }
    const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) {
        return 'unknown';
    }
    const relations = parts.map(part => {
        if (!part.includes('&')) {
            return 'descendant';
        }
        if (/^&\s*[>+~]?\s+\S/.test(part) || /^&\s*>/.test(part)) {
            return /^&\s*[+~]/.test(part) ? 'unknown' : 'descendant';
        }
        if (/^&[:.[#]/.test(part) && !/\s/.test(part)) {
            return 'same';
        }
        return 'unknown';
    });
    return relations.every(r => r === relations[0]) ? relations[0] : 'unknown';
}

function parentContext(block: BlockNode): { block: BlockNode; relation: Relation } | undefined {
    const relation: Relation = block.kind === 'atrule' ? 'same' : selectorRelation(block.selector);
    let p = block.parent;
    while (p && p.kind === 'atrule') {
        p = p.parent;
    }
    if (!p || p.kind !== 'rule') {
        return undefined;
    }
    return { block: p, relation };
}

/** Resolves the font size declared in `block` itself, in px. */
function declaredFontSize(doc: ParsedDocument, block: BlockNode, ctx: ProjectContext, functionName: string, depth: number): number | undefined {
    for (let i = block.declarations.length - 1; i >= 0; i--) {
        const decl = block.declarations[i];
        if (decl.property !== 'font-size' && decl.property !== 'font') {
            continue;
        }
        const lengths = lengthsOf(doc, decl).filter(l => l.functions.length === 0);
        const calls = functionsOf(doc, decl);
        let length: LengthNode | undefined;
        if (decl.property === 'font') {
            length = lengths.find(l => !l.shorthandFontSize && l.unit !== '%') ?? lengths.find(l => !l.shorthandFontSize);
        } else if (lengths.length === 1 && calls.length === 0) {
            length = lengths[0];
        }
        if (length) {
            switch (length.unit) {
                case 'px':
                    return length.value;
                case 'rem':
                    return length.value * ctx.rootFontSize;
                case 'em':
                case '%': {
                    const parent = inheritedFontSize(doc, block, ctx, functionName, depth + 1);
                    if (parent === undefined) {
                        return undefined;
                    }
                    return length.unit === 'em' ? length.value * parent : (length.value / 100) * parent;
                }
                default:
                    return undefined;
            }
        }
        const remCall = calls.find(c => c.name === functionName.toLowerCase() && c.args.length >= 1 && c.functions.length === 0);
        if (remCall && decl.property === 'font-size') {
            const arg = doc.text.slice(remCall.args[0].start, remCall.args[0].end).trim();
            const m = /^(-?\d*\.?\d+)(px)?$/i.exec(arg);
            if (m) {
                return Number(m[1]);
            }
        }
        return undefined;
    }
    return undefined;
}

/** Computed font size of the elements matched by `block`, when it can be determined statically. */
export function fontSizeOf(doc: ParsedDocument, block: BlockNode, ctx: ProjectContext, functionName = 'rem', depth = 0): number | undefined {
    if (depth > 32) {
        return undefined;
    }
    const own = declaredFontSize(doc, block, ctx, functionName, depth);
    if (own !== undefined) {
        return own;
    }
    const parent = parentContext(block);
    if (!parent || parent.relation === 'unknown') {
        return undefined;
    }
    return fontSizeOf(doc, parent.block, ctx, functionName, depth + 1);
}

/** Font size of the parent element (what `em` and `%` font sizes are relative to). */
export function inheritedFontSize(doc: ParsedDocument, block: BlockNode, ctx: ProjectContext, functionName = 'rem', depth = 0): number | undefined {
    if (depth > 32) {
        return undefined;
    }
    const parent = parentContext(block);
    if (!parent) {
        return undefined;
    }
    if (parent.relation === 'same') {
        return inheritedFontSize(doc, parent.block, ctx, functionName, depth + 1);
    }
    if (parent.relation === 'descendant') {
        return fontSizeOf(doc, parent.block, ctx, functionName, depth + 1);
    }
    return undefined;
}

/** The base `em` values of a length are relative to, and whether it had to be assumed. */
export function emBaseFor(doc: ParsedDocument, length: LengthNode, ctx: ProjectContext, functionName: string): { px: number; assumed: boolean } {
    const property = length.decl?.property;
    if (length.shorthandFontSize) {
        return { px: length.shorthandFontSize.value, assumed: length.shorthandFontSize.unit !== 'px' };
    }
    const found =
        property === 'font-size' || property === 'font'
            ? inheritedFontSize(doc, length.block, ctx, functionName)
            : fontSizeOf(doc, length.block, ctx, functionName);
    return found !== undefined ? { px: found, assumed: false } : { px: ctx.rootFontSize, assumed: true };
}
