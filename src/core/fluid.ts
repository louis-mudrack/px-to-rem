/** Fluid values: clamp() generation, the WCAG zoom check, explanations and breakpoint merging. */
import type { ProjectContext } from './context';
import type { ParsedDocument } from './document';
import { dependsOnViewport, evaluate, parseExpression, respondsToFontSize, type EvalEnv } from './expr';
import { formatNumber } from './format';
import type { Options } from './options';
import type { BlockNode, DeclarationNode } from './parser';
import type { Span, TextEdit } from './text';

export interface ClampSpec {
    /** Value in px at `minViewport`. */
    minPx: number;
    /** Value in px at `maxViewport`. */
    maxPx: number;
    minViewport: number;
    maxViewport: number;
    rootFontSize: number;
    unit: 'vw' | 'cqi';
    precision: number;
    leadingZero: boolean;
}

/**
 * `clamp(MIN, INTERCEPT + SLOPEunit, MAX)` with rem endpoints, e.g. 16px@375 →
 * 24px@1440 at root 16 → `clamp(1rem, 0.8239rem + 0.7512vw, 1.5rem)`. If
 * minPx > maxPx (shrinking), the clamp bounds are swapped so it stays valid and
 * the slope is negative (`… - 0.5vw`). If minPx === maxPx (or the viewports
 * are equal) it returns just the rem value.
 */
export function generateClamp(spec: ClampSpec): string {
    const style = { precision: spec.precision, leadingZero: spec.leadingZero };
    const rem = (px: number) => `${formatNumber(px / spec.rootFontSize, style)}rem`;
    if (spec.minPx === spec.maxPx || spec.minViewport === spec.maxViewport) {
        return rem(spec.maxPx);
    }
    const slope = (spec.maxPx - spec.minPx) / (spec.maxViewport - spec.minViewport);
    const intercept = spec.minPx - slope * spec.minViewport;
    const slopeText = formatNumber(Math.abs(slope) * 100, style);
    const interceptText = formatNumber(intercept / spec.rootFontSize, style);
    let preferred: string;
    if (slopeText === '0') {
        preferred = `${interceptText}rem`;
    } else if (interceptText === '0') {
        preferred = `${slope < 0 ? '-' : ''}${slopeText}${spec.unit}`;
    } else {
        preferred = `${interceptText}rem ${slope < 0 ? '-' : '+'} ${slopeText}${spec.unit}`;
    }
    return `clamp(${rem(Math.min(spec.minPx, spec.maxPx))}, ${preferred}, ${rem(Math.max(spec.minPx, spec.maxPx))})`;
}

export interface ZoomResult {
    passes: boolean;
    /** Viewport (device px at 100% zoom) where the best achievable text scale is lowest. */
    worstViewport: number;
    /** Best achievable scale (rendered size at some zoom ≤ 500% / size at 100%) at worstViewport. 2 means it reaches 200%. */
    worstScale: number;
}

const ZOOM_MIN_WINDOW = 320;
const ZOOM_MAX_WINDOW = 2560;
const ZOOM_WINDOW_STEP = 10;
/** Zoom levels 100% … 500% in 5% steps, as twentieths. */
const ZOOM_STEPS = 80;

/**
 * WCAG 1.4.4 check for a font-size that may depend on the viewport.
 * f(w) = computed font-size in CSS px when the layout viewport is w CSS px wide.
 * With browser zoom Z, a window of W device px has a layout viewport of W/Z CSS px, and text renders at Z * f(W/Z) device px.
 * For each W in [320, 2560] (step 10), computes max over Z in [1, 5] (step 0.05) of Z*f(W/Z) / f(W). It passes if that is >= 2 for every W.
 * Ignores W values where f is undefined (or not positive). With no measurable W it passes with an infinite worstScale.
 */
export function checkZoom(f: (viewportWidth: number) => number | undefined): ZoomResult {
    let worstViewport = 0;
    let worstScale = Infinity;
    for (let w = ZOOM_MIN_WINDOW; w <= ZOOM_MAX_WINDOW; w += ZOOM_WINDOW_STEP) {
        const base = f(w);
        if (base === undefined || !(base > 0)) {
            continue;
        }
        let best = 0;
        for (let k = 0; k <= ZOOM_STEPS; k++) {
            const zoom = 1 + k / 20;
            const size = f(w / zoom);
            if (size !== undefined) {
                best = Math.max(best, (zoom * size) / base);
            }
        }
        if (best < worstScale) {
            worstScale = best;
            worstViewport = w;
        }
    }
    return { passes: worstScale >= 2 - 1e-9, worstViewport, worstScale };
}

export interface ExplainRow {
    viewport: number;
    px: number | undefined;
}

export interface Explanation {
    rows: ExplainRow[];
    viewportDependent: boolean;
    respondsToFontSize: boolean;
    zoom?: ZoomResult;
}

/**
 * Evaluates `text` at each breakpoint and, when `isFontSize` and the value is
 * viewport dependent and `checkZoomEnabled`, runs checkZoom. The viewport
 * height is `env.viewportHeight` when given, otherwise 9/16 of the width.
 * Returns undefined when `text` is not an expression.
 */
export function explainValue(
    text: string,
    env: Omit<EvalEnv, 'viewportWidth' | 'viewportHeight'> & { viewportHeight?: number },
    breakpoints: number[],
    isFontSize: boolean,
    checkZoomEnabled: boolean,
): Explanation | undefined {
    const expr = parseExpression(text);
    if (!expr) {
        return undefined;
    }
    // One mutable environment: the zoom check evaluates thousands of viewports.
    const evalEnv: EvalEnv = { ...env, viewportWidth: 0, viewportHeight: 0 };
    const at = (viewportWidth: number) => {
        evalEnv.viewportWidth = viewportWidth;
        evalEnv.viewportHeight = env.viewportHeight ?? (viewportWidth * 9) / 16;
        return evaluate(expr, evalEnv);
    };
    const viewportDependent = dependsOnViewport(expr, env);
    const explanation: Explanation = {
        rows: breakpoints.map(viewport => ({ viewport, px: at(viewport) })),
        viewportDependent,
        respondsToFontSize: respondsToFontSize(expr, env),
    };
    if (isFontSize && viewportDependent && checkZoomEnabled) {
        explanation.zoom = checkZoom(at);
    }
    return explanation;
}

// ---------------------------------------------------------------------------
// Breakpoint merging

export interface MergePoint {
    viewport: number;
    px: number;
    decl: DeclarationNode;
}

export interface BreakpointMerge {
    /** The base declaration (outside media queries) that receives the clamp(). */
    decl: DeclarationNode;
    property: string;
    /** Sorted by viewport. */
    points: MergePoint[];
    clamp: string;
    /**
     * Replace the base value with the clamp and delete the media-query overrides
     * (whole lines incl. newline when they sit alone on their line); delete a
     * media block (or a rule inside a top-level media block) entirely when
     * nothing but whitespace/comments would remain. Edits do not overlap.
     */
    edits: TextEdit[];
    /** Largest difference between the fluid value and an intermediate breakpoint value. */
    maxDeviation: { viewport: number; expected: number; actual: number } | undefined;
}

type Direction = 'min' | 'max';

interface Breakpoint {
    direction: Direction;
    px: number;
}

/** Overrides of one property inside one media block. */
interface OverrideSource {
    media: BlockNode;
    /** Same-property declarations in source order; the last one wins. */
    decls: DeclarationNode[];
}

const NUM = '(\\d*\\.?\\d+)(px|em|rem)';
const MIN_MAX_FEATURE = new RegExp(`^\\( ?(min|max)-width ?: ?${NUM} ?\\)$`);
const RANGE_FEATURE = new RegExp(`^\\( ?width ?(>=?|<=?) ?${NUM} ?\\)$`);
const REVERSED_RANGE_FEATURE = new RegExp(`^\\( ?${NUM} ?(>=?|<=?) ?width ?\\)$`);

/** `(min-width: 768px)`, `screen and (max-width: 48em)`, `(width >= 768px)`; anything else is undefined. */
function parseBreakpoint(prelude: string, mediaQueryBase: number): Breakpoint | undefined {
    const query = prelude.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^(only )?screen and /, '');
    const px = (value: string, unit: string) => Number(value) * (unit === 'px' ? 1 : mediaQueryBase);
    let m = MIN_MAX_FEATURE.exec(query);
    if (m) {
        return { direction: m[1] as Direction, px: px(m[2], m[3]) };
    }
    m = RANGE_FEATURE.exec(query);
    if (m) {
        return { direction: m[1].startsWith('>') ? 'min' : 'max', px: px(m[2], m[3]) };
    }
    m = REVERSED_RANGE_FEATURE.exec(query);
    if (m) {
        return { direction: m[3].startsWith('<') ? 'min' : 'max', px: px(m[1], m[2]) };
    }
    return undefined;
}

const NUMBER = '(-?(?:\\d+\\.?\\d*|\\.\\d+))';
const LENGTH_VALUE = new RegExp(`^${NUMBER}(px|rem)$`, 'i');
const FUNCTION_VALUE = new RegExp(`^([\\w.-]+)\\(\\s*${NUMBER}(?:px)?\\s*\\)$`, 'i');

/** px of a single length value: `16px`, `1.5rem`, `0`, or a rem function call `rem(24)`. */
function singleLengthPx(text: string, ctx: ProjectContext, remFunctions: ReadonlySet<string>): number | undefined {
    const value = text.trim();
    if (value === '0') {
        return 0;
    }
    let m = LENGTH_VALUE.exec(value);
    if (m) {
        return m[2].toLowerCase() === 'px' ? Number(m[1]) : Number(m[1]) * ctx.rootFontSize;
    }
    m = FUNCTION_VALUE.exec(value);
    if (m && remFunctions.has(m[1].toLowerCase())) {
        return Number(m[2]);
    }
    return undefined;
}

function insideMedia(block: BlockNode | undefined): boolean {
    for (let b = block; b; b = b.parent) {
        if (b.kind === 'atrule' && b.name === 'media') {
            return true;
        }
    }
    return false;
}

function normalizeSelector(selector: string): string {
    return selector.replace(/\s+/g, ' ').replace(/ ?([,>+~]) ?/g, '$1').trim();
}

function isMediaBlock(node: BlockNode['children'][number]): node is BlockNode {
    return node.kind === 'atrule' && node.name === 'media';
}

/** Whether every child of `block` is a deleted declaration (or, for media blocks, a rule emptied that way). */
function isEmptied(block: BlockNode, deleted: ReadonlySet<DeclarationNode>): boolean {
    if (!block.children.length) {
        return false;
    }
    return block.children.every(child => {
        if (child.kind === 'declaration') {
            return deleted.has(child);
        }
        return block.kind === 'atrule' && child.kind === 'rule' && isEmptied(child, deleted);
    });
}

const isBlankLine = (s: string) => /^[ \t]*$/.test(s);

/** An edit deleting `span`: whole lines when it sits alone on them, otherwise the span and adjacent spaces. */
function deletion(doc: ParsedDocument, span: Span, isBlock: boolean): TextEdit {
    const { text, lines } = doc;
    const firstLine = lines.lineAt(span.start);
    const lastLine = lines.lineAt(span.end);
    const lineStart = lines.lineStart(firstLine);
    const lineEnd = lines.lineEnd(lastLine);
    if (isBlankLine(text.slice(lineStart, span.start)) && isBlankLine(text.slice(span.end, lineEnd))) {
        let start = lineStart;
        const end = lastLine + 1 < lines.lineCount ? lines.lineStart(lastLine + 1) : text.length;
        if (isBlock && firstLine > 0) {
            // Do not leave a blank line before a closing brace, another blank line or the end of the file.
            const previous = lines.lineText(firstLine - 1);
            const next = end < text.length ? lines.lineText(lines.lineAt(end)) : '';
            if (/^\s*$/.test(previous) && (/^\s*$/.test(next) || /^\s*\}/.test(next))) {
                start = lines.lineStart(firstLine - 1);
            }
        }
        return { start, end, newText: '' };
    }
    let start = span.start;
    let end = span.end;
    let after = end;
    while (after < lineEnd && (text[after] === ' ' || text[after] === '\t')) {
        after++;
    }
    if (after < lineEnd && text[after] !== '}') {
        end = after;
    } else {
        while (start > lineStart && (text[start - 1] === ' ' || text[start - 1] === '\t')) {
            start--;
        }
    }
    return { start, end, newText: '' };
}

function deletionEdits(doc: ParsedDocument, sources: OverrideSource[]): TextEdit[] {
    const deleted = new Set(sources.flatMap(s => s.decls));
    const edits: TextEdit[] = [];
    for (const media of new Set(sources.map(s => s.media))) {
        if (isEmptied(media, deleted)) {
            edits.push(deletion(doc, media, true));
            continue;
        }
        for (const child of media.children) {
            if (child.kind === 'declaration' && deleted.has(child)) {
                edits.push(deletion(doc, child, false));
            } else if (child.kind === 'rule' && child.declarations.some(d => deleted.has(d))) {
                if (isEmptied(child, deleted)) {
                    edits.push(deletion(doc, child, true));
                } else {
                    edits.push(...child.declarations.filter(d => deleted.has(d)).map(d => deletion(doc, d, false)));
                }
            }
        }
    }
    return edits;
}

/** Media blocks directly inside `parent` and the rules they contain, by normalized selector. */
type MediaRuleIndex = Map<string, { media: BlockNode; rule: BlockNode }[]>;

/**
 * Finds declarations whose single length value (px, or rem converted with
 * ctx.rootFontSize, or rem(N) call → N px) is overridden at `@media
 * (min-width: Xpx|Xem|Xrem)` breakpoints (mobile-first) or `@media
 * (max-width: …)` (desktop-first; em/rem in media queries use
 * options.mediaQueryBase), either (a) nested inside the rule (Sass/Less/CSS
 * nesting), or (b) in a `@media` block at the same nesting level as the rule
 * containing a rule with the identical selector. Only overrides after the base
 * declaration count, and only the last declaration of a property in a rule is
 * a base. Points: mobile-first → base value at options.fluid.minViewport, each
 * override at its min-width; desktop-first → base value at
 * options.fluid.maxViewport, each override at its max-width. Only when the
 * values are monotonic (and not all equal). `screen and (…)` and range syntax
 * (`width >= 768px`) are accepted; media blocks with other queries are left
 * alone, and a base whose overrides mix min- and max-width is skipped.
 */
export function findBreakpointMerges(doc: ParsedDocument, options: Options, ctx: ProjectContext): BreakpointMerge[] {
    const remFunctions = new Set([options.functionName, ...ctx.remFunctions.map(f => f.name)].map(n => n.toLowerCase()));
    const indexes = new Map<BlockNode, MediaRuleIndex>();
    const mediaRules = (parent: BlockNode): MediaRuleIndex => {
        let index = indexes.get(parent);
        if (!index) {
            index = new Map();
            for (const media of parent.children) {
                if (!isMediaBlock(media)) {
                    continue;
                }
                for (const rule of media.children) {
                    if (rule.kind === 'rule' && rule.selector !== undefined) {
                        const key = normalizeSelector(rule.selector);
                        index.set(key, [...(index.get(key) ?? []), { media, rule }]);
                    }
                }
            }
            indexes.set(parent, index);
        }
        return index;
    };
    const valuePx = (decl: DeclarationNode) => singleLengthPx(doc.text.slice(decl.valueSpan.start, decl.valueSpan.end), ctx, remFunctions);

    const merges: BreakpointMerge[] = [];
    for (const base of doc.declarations) {
        const rule = base.parent;
        if (!base.property || (base.variable && base.variable.flavor !== 'css') || (rule.kind !== 'rule' && rule.kind !== 'root') || insideMedia(rule)) {
            continue;
        }
        // Only the last declaration of a property applies; earlier ones are fallbacks.
        if (rule.declarations.some(d => d !== base && d.property === base.property && d.start > base.start)) {
            continue;
        }
        const basePx = valuePx(base);
        if (basePx === undefined) {
            continue;
        }

        const sources: OverrideSource[] = [];
        // (a) Nested media blocks.
        for (const media of rule.children) {
            if (isMediaBlock(media) && media.start >= base.end) {
                const decls = media.declarations.filter(d => d.property === base.property);
                if (decls.length) {
                    sources.push({ media, decls });
                }
            }
        }
        // (b) Media blocks next to the rule that repeat its selector.
        if (rule.kind === 'rule' && rule.selector !== undefined && rule.parent) {
            const byMedia = new Map<BlockNode, DeclarationNode[]>();
            for (const { media, rule: inner } of mediaRules(rule.parent).get(normalizeSelector(rule.selector)) ?? []) {
                const decls = inner.declarations.filter(d => d.property === base.property);
                if (media.start >= rule.end && decls.length) {
                    byMedia.set(media, [...(byMedia.get(media) ?? []), ...decls]);
                }
            }
            for (const [media, decls] of byMedia) {
                sources.push({ media, decls });
            }
        }

        const merge = mergeFor(doc, base, basePx, sources, options, ctx, valuePx);
        if (merge) {
            merges.push(merge);
        }
    }
    return merges;
}

function mergeFor(
    doc: ParsedDocument,
    base: DeclarationNode,
    basePx: number,
    candidates: OverrideSource[],
    options: Options,
    ctx: ProjectContext,
    valuePx: (decl: DeclarationNode) => number | undefined,
): BreakpointMerge | undefined {
    let direction: Direction | undefined;
    const sources: OverrideSource[] = [];
    const overrides: MergePoint[] = [];
    for (const source of candidates) {
        const prelude = source.media.prelude ? doc.text.slice(source.media.prelude.start, source.media.prelude.end) : '';
        const breakpoint = parseBreakpoint(prelude, options.mediaQueryBase);
        if (!breakpoint) {
            continue;
        }
        if (direction && breakpoint.direction !== direction) {
            return undefined;
        }
        direction = breakpoint.direction;
        const decl = source.decls[source.decls.length - 1];
        const px = valuePx(decl);
        if (px === undefined || decl.important !== base.important) {
            return undefined;
        }
        sources.push(source);
        overrides.push({ viewport: breakpoint.px, px, decl });
    }
    if (!direction || !overrides.length) {
        return undefined;
    }

    const baseViewport = direction === 'min' ? options.fluid.minViewport : options.fluid.maxViewport;
    if (overrides.some(o => (direction === 'min' ? o.viewport <= baseViewport : o.viewport >= baseViewport))) {
        return undefined;
    }
    // At equal breakpoints the later override wins.
    const byViewport = new Map<number, MergePoint>();
    for (const o of [...overrides].sort((a, b) => a.decl.start - b.decl.start)) {
        byViewport.set(o.viewport, o);
    }
    const points = [{ viewport: baseViewport, px: basePx, decl: base }, ...byViewport.values()].sort((a, b) => a.viewport - b.viewport);

    let sign = 0;
    for (let i = 1; i < points.length; i++) {
        const s = Math.sign(points[i].px - points[i - 1].px);
        if (s !== 0 && sign !== 0 && s !== sign) {
            return undefined;
        }
        sign = sign || s;
    }
    if (sign === 0) {
        return undefined;
    }

    const first = points[0];
    const last = points[points.length - 1];
    const clamp = generateClamp({
        minPx: first.px,
        maxPx: last.px,
        minViewport: first.viewport,
        maxViewport: last.viewport,
        rootFontSize: ctx.rootFontSize,
        unit: options.fluid.unit,
        precision: options.precision,
        leadingZero: options.leadingZero,
    });

    const slope = (last.px - first.px) / (last.viewport - first.viewport);
    let maxDeviation: BreakpointMerge['maxDeviation'];
    for (const point of points.slice(1, -1)) {
        const actual = first.px + (point.viewport - first.viewport) * slope;
        if (!maxDeviation || Math.abs(actual - point.px) > Math.abs(maxDeviation.actual - maxDeviation.expected)) {
            maxDeviation = { viewport: point.viewport, expected: point.px, actual };
        }
    }

    return {
        decl: base,
        property: base.property,
        points,
        clamp,
        edits: [{ start: base.valueSpan.start, end: base.valueSpan.end, newText: clamp }, ...deletionEdits(doc, sources)],
        maxDeviation,
    };
}
