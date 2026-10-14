import type { ProjectContext } from './context';
import type { ParsedDocument } from './document';
import type { EvalEnv } from './expr';
import type { Options } from './options';

/**
 * Raw values of variables visible from a document: its own `$x`, `@x`,
 * `--x` and Stylus definitions, then project tokens.
 */
export function variableResolver(doc: ParsedDocument, ctx: ProjectContext): (name: string) => string | undefined {
    const local = new Map<string, string>();
    for (const decl of doc.declarations) {
        if (decl.variable && !local.has(decl.variable.name)) {
            local.set(decl.variable.name, doc.text.slice(decl.valueSpan.start, decl.valueSpan.end));
        }
    }
    return name => local.get(name) ?? ctx.tokens.get(name)?.rawValue;
}

/** Evaluation environment for expressions in a document (viewport filled in by the caller). */
export function evalEnv(doc: ParsedDocument, options: Options, ctx: ProjectContext, emBase = ctx.rootFontSize): Omit<EvalEnv, 'viewportWidth' | 'viewportHeight'> {
    const fn = options.functionName.toLowerCase();
    return {
        rootFontSize: ctx.rootFontSize,
        emBase,
        resolveVariable: variableResolver(doc, ctx),
        resolveFunction: (name, args) => (name.toLowerCase() === fn && args.length >= 1 ? args[0] : undefined),
    };
}
