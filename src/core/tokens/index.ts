import { tokenCategoriesFor, type Category } from '../properties';
import type { Syntax } from '../syntax';
import { deltaE2000 } from './color';

/** Where something was found, for hovers and status messages. */
export interface SourceRef {
    /** Workspace-relative path. */
    file?: string;
    /** Zero-based line. */
    line?: number;
    /** Human-readable origin, e.g. `html { font-size: 62.5% }`. */
    description?: string;
}

export type TokenKind = 'custom-property' | 'scss' | 'scss-map' | 'less' | 'stylus' | 'json' | 'tailwind';

/** A design token: a named length or colour. */
export interface TokenDef {
    /** Name as written (`--space-4`, `$space-md`, `@gutter`, `space.4`). */
    name: string;
    /** What to write in CSS to use the token (`var(--space-4)`, `$space-md`, `map.get($spacing, md)`). */
    reference: string;
    kind: TokenKind;
    category: Category | 'color';
    /** Resolved length in px. */
    px?: number;
    /** Resolved colour (0–255 channels, alpha 0–1). */
    color?: [number, number, number, number];
    rawValue: string;
    source?: SourceRef;
}

/** Whether a token reference can be written in a file of the given syntax. */
export function tokenUsableIn(token: TokenDef, syntax: Syntax, jsTemplate = false): boolean {
    switch (token.kind) {
        case 'custom-property':
        case 'tailwind':
            return true;
        case 'json':
            if (token.reference.startsWith('$')) {
                return (syntax === 'scss' || syntax === 'sass') && !jsTemplate;
            }
            if (token.reference.startsWith('@')) {
                return syntax === 'less';
            }
            return true;
        case 'scss':
        case 'scss-map':
            return (syntax === 'scss' || syntax === 'sass') && !jsTemplate;
        case 'less':
            return syntax === 'less';
        case 'stylus':
            return syntax === 'stylus';
    }
}

export interface ScaleStep {
    px: number;
    tokens: TokenDef[];
}

const EPSILON = 1e-6;

/** Lookup structure over all tokens of a project. */
export class TokenIndex {
    readonly lengths: TokenDef[];
    readonly colors: TokenDef[];
    private readonly byName = new Map<string, TokenDef>();

    constructor(readonly all: TokenDef[] = []) {
        this.lengths = all.filter(t => t.px !== undefined);
        this.colors = all.filter(t => t.color !== undefined);
        for (const t of all) {
            if (!this.byName.has(t.name)) {
                this.byName.set(t.name, t);
            }
        }
    }

    get size(): number {
        return this.all.length;
    }

    get(name: string): TokenDef | undefined {
        return this.byName.get(name);
    }

    private candidates(category: Category, syntax: Syntax, jsTemplate: boolean): TokenDef[] {
        const allowed = tokenCategoriesFor(category);
        const usable = this.lengths.filter(t => tokenUsableIn(t, syntax, jsTemplate));
        // Prefer tokens of the exact category; fall back to related ones only when none exist.
        for (const cat of allowed) {
            const found = usable.filter(t => t.category === cat);
            if (found.length) {
                return found;
            }
        }
        return [];
    }

    /** Tokens whose value equals `px` for a property category. */
    exactLength(px: number, category: Category, syntax: Syntax, jsTemplate = false): TokenDef[] {
        return this.candidates(category, syntax, jsTemplate).filter(t => Math.abs((t.px ?? NaN) - px) < EPSILON);
    }

    /** The sorted scale for a category: unique values with their tokens. */
    scale(category: Category, syntax: Syntax, jsTemplate = false): ScaleStep[] {
        const steps = new Map<number, TokenDef[]>();
        for (const t of this.candidates(category, syntax, jsTemplate)) {
            const key = Math.round((t.px ?? 0) * 1000) / 1000;
            const list = steps.get(key) ?? [];
            list.push(t);
            steps.set(key, list);
        }
        return [...steps.entries()].map(([px, tokens]) => ({ px, tokens })).sort((a, b) => a.px - b.px);
    }

    /** Nearest scale step below and above `px` (for snapping and nudging). */
    neighbours(px: number, category: Category, syntax: Syntax, jsTemplate = false): { below?: ScaleStep; above?: ScaleStep; nearest?: ScaleStep } {
        const scale = this.scale(category, syntax, jsTemplate);
        let below: ScaleStep | undefined;
        let above: ScaleStep | undefined;
        for (const step of scale) {
            if (step.px < px - EPSILON) {
                below = step;
            } else if (step.px > px + EPSILON && !above) {
                above = step;
            }
        }
        let nearest: ScaleStep | undefined;
        if (below && above) {
            nearest = px - below.px <= above.px - px ? below : above;
        } else {
            nearest = below ?? above;
        }
        return { below, above, nearest };
    }

    /** Colour tokens sorted by distance (CIEDE2000) from `rgba`. */
    nearestColors(rgba: [number, number, number, number], syntax: Syntax, jsTemplate = false, limit = 3): { token: TokenDef; distance: number }[] {
        return this.colors
            .filter(t => tokenUsableIn(t, syntax, jsTemplate) && Math.abs((t.color![3] ?? 1) - rgba[3]) < 0.01)
            .map(token => ({ token, distance: deltaE2000(rgba, token.color!) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit);
    }
}

export const EMPTY_TOKENS = new TokenIndex([]);
