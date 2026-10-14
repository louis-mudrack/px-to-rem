import { significant, tokenize, type Token, type TokenizeOptions } from './tokenizer';
import type { Syntax } from './syntax';
import type { Span } from './text';

export type BlockKind = 'root' | 'rule' | 'atrule' | 'nested-property';

export interface BlockNode extends Span {
    kind: BlockKind;
    parent?: BlockNode;
    /** At-rule name without `@`, lowercased (`media`, `include`, `function`, …). */
    name?: string;
    /** Selector or at-rule parameters. */
    prelude?: Span;
    /** Normalized selector text for rules. */
    selector?: string;
    /** Content between the braces (exclusive). */
    body: Span;
    children: (BlockNode | DeclarationNode | StatementNode)[];
    declarations: DeclarationNode[];
    /** Index range of the prelude in `ParsedStylesheet.tokens`. */
    preludeTokens: [number, number];
    syntax: Syntax;
}

export type VariableFlavor = 'scss' | 'less' | 'stylus' | 'css';

export interface DeclarationNode extends Span {
    kind: 'declaration';
    parent: BlockNode;
    /** Lowercased property (custom properties keep their case). Empty when interpolated. */
    property: string;
    propertySpan: Span;
    valueSpan: Span;
    /** Token index range of the value. */
    valueTokens: [number, number];
    important: boolean;
    /** Set for `$x:`, `@x:`, `x =` and `--x:` declarations. */
    variable?: { name: string; flavor: VariableFlavor };
}

export type StatementKind = 'at-statement' | 'mixin-call' | 'other';

export interface StatementNode extends Span {
    kind: StatementKind;
    parent: BlockNode;
    /** At-rule or mixin name. */
    name?: string;
    /** Token index range of the arguments/parameters. */
    argTokens: [number, number];
}

export interface ParsedStylesheet {
    root: BlockNode;
    /** Significant tokens (including zero-width synthetic ones). */
    tokens: Token[];
    /** Comment tokens, for directives. */
    comments: Token[];
    blocks: BlockNode[];
    declarations: DeclarationNode[];
    statements: StatementNode[];
}

export interface ParseOptions extends TokenizeOptions {
    /** Parse the region as a bare declaration list (style="" attributes). */
    declarationList?: boolean;
}

/** Parses `text[start, end)` into a rule tree. */
export function parseStylesheet(text: string, start: number, end: number, options: ParseOptions): ParsedStylesheet {
    const all = tokenize(text, start, end, options);
    const comments = all.filter(t => t.type === 'comment');
    let tokens = significant(text, all);

    const { syntax } = options;
    let newlineTerminates = false;
    if ((syntax === 'sass' || syntax === 'stylus') && !options.declarationList) {
        const usesBraces = syntax === 'stylus' && tokens.some(t => t.type === '{');
        if (usesBraces) {
            newlineTerminates = true;
        } else {
            tokens = insertIndentationBraces(text, tokens);
        }
    }

    const root: BlockNode = {
        kind: 'root',
        start,
        end,
        body: { start, end },
        children: [],
        declarations: [],
        preludeTokens: [0, 0],
        syntax,
    };
    const result: ParsedStylesheet = { root, tokens, comments, blocks: [], declarations: [], statements: [] };
    const parser = new Parser(text, tokens, syntax, newlineTerminates, result);
    parser.parseBlock(root, 0, false);
    return result;
}

class Parser {
    constructor(
        private readonly text: string,
        private readonly tokens: Token[],
        private readonly syntax: Syntax,
        private readonly newlineTerminates: boolean,
        private readonly out: ParsedStylesheet,
    ) {}

    /** Parses statements starting at token index `i`. Returns the index after the closing `}` (or the end). */
    parseBlock(block: BlockNode, i: number, closed: boolean): number {
        const { tokens } = this;
        let stmtStart = i;
        let depth = 0;
        let interp = 0;

        while (i < tokens.length) {
            const tok = tokens[i];

            if (
                this.newlineTerminates &&
                tok.newlineBefore &&
                depth === 0 &&
                interp === 0 &&
                i > stmtStart &&
                tok.type !== '{' &&
                tokens[i - 1].type !== ','
            ) {
                this.finishStatement(block, stmtStart, i);
                stmtStart = i;
            }

            switch (tok.type) {
                case '(':
                case '[':
                    depth++;
                    break;
                case ')':
                case ']':
                    depth = Math.max(0, depth - 1);
                    break;
                case 'interp-open':
                    interp++;
                    break;
                case 'interp-close':
                    interp = Math.max(0, interp - 1);
                    break;
                case '{':
                    if (depth === 0 && interp === 0) {
                        const child = this.openBlock(block, stmtStart, i);
                        i = this.parseBlock(child, i + 1, true);
                        // `i` is just past the closing brace, or the end of input if unclosed.
                        const closing = tokens[i - 1];
                        child.end = closing.end;
                        child.body.end = closing.type === '}' ? closing.start : closing.end;
                        stmtStart = i;
                        continue;
                    }
                    break;
                case ';':
                    if (depth === 0 && interp === 0) {
                        this.finishStatement(block, stmtStart, i, tok);
                        stmtStart = i + 1;
                    }
                    break;
                case '}':
                    if (interp === 0) {
                        this.finishStatement(block, stmtStart, i);
                        if (closed) {
                            return i + 1;
                        }
                        // Stray closing brace at the top level: ignore it.
                        stmtStart = i + 1;
                        depth = 0;
                    }
                    break;
            }
            i++;
        }
        this.finishStatement(block, stmtStart, i);
        return i;
    }

    private openBlock(parent: BlockNode, from: number, braceIndex: number): BlockNode {
        const { tokens, text } = this;
        const brace = tokens[braceIndex];
        const first = tokens[from];
        const hasPrelude = from < braceIndex;
        const preludeSpan: Span = hasPrelude
            ? { start: first.start, end: tokens[braceIndex - 1].end }
            : { start: brace.start, end: brace.start };
        const node: BlockNode = {
            kind: 'rule',
            parent,
            start: hasPrelude ? first.start : brace.start,
            end: brace.end,
            prelude: preludeSpan,
            body: { start: brace.end, end: brace.end },
            children: [],
            declarations: [],
            preludeTokens: [from, braceIndex],
            syntax: this.syntax,
        };

        if (hasPrelude && first.type === 'at') {
            const name = text.slice(first.start + 1, first.end).toLowerCase();
            if (this.syntax === 'less' && tokens[from + 1]?.type === ':') {
                // Less detached ruleset: `@detached: { … }`
                node.selector = text.slice(first.start, first.end);
            } else {
                node.kind = 'atrule';
                node.name = name;
                node.prelude = from + 1 < braceIndex ? { start: tokens[from + 1].start, end: preludeSpan.end } : { start: first.end, end: first.end };
                node.preludeTokens = [from + 1, braceIndex];
            }
        } else if (hasPrelude && this.syntax === 'sass' && first.type === 'delim' && (text[first.start] === '=' || text[first.start] === '+')) {
            // Indented Sass shorthands: `=mixin(...)` defines, `+mixin(...)` includes with a content block.
            node.kind = 'atrule';
            node.name = text[first.start] === '=' ? 'mixin' : 'include';
            node.prelude = { start: tokens[from + 1]?.start ?? first.end, end: preludeSpan.end };
            node.preludeTokens = [from + 1, braceIndex];
        } else if (
            hasPrelude &&
            braceIndex - from === 2 &&
            first.type === 'ident' &&
            tokens[from + 1].type === ':' &&
            this.syntax !== 'css'
        ) {
            node.kind = 'nested-property';
            node.name = text.slice(first.start, first.end).toLowerCase();
        } else if (hasPrelude) {
            node.selector = text.slice(preludeSpan.start, preludeSpan.end).replace(/\s+/g, ' ').trim();
        }

        parent.children.push(node);
        this.out.blocks.push(node);
        return node;
    }

    private finishStatement(block: BlockNode, from: number, to: number, terminator?: Token): void {
        const { tokens, text } = this;
        // Drop zero-width synthetic separators.
        while (from < to && tokens[from].synthetic) {
            from++;
        }
        let last = to;
        while (last > from && tokens[last - 1].synthetic) {
            last--;
        }
        if (from >= last) {
            return;
        }
        const first = tokens[from];
        const end = terminator && !terminator.synthetic ? terminator.end : tokens[last - 1].end;

        // `@name …;`
        if (first.type === 'at') {
            const name = text.slice(first.start + 1, first.end);
            if (tokens[from + 1]?.type === ':' && this.syntax === 'less') {
                this.declaration(block, from, from + 1, last, end, { name: '@' + name, flavor: 'less' });
                return;
            }
            const stmt: StatementNode = {
                kind: 'at-statement',
                parent: block,
                name: name.toLowerCase(),
                start: first.start,
                end,
                argTokens: [from + 1, last],
            };
            block.children.push(stmt);
            this.out.statements.push(stmt);
            return;
        }

        // `$name: value`
        if (first.type === 'var' && tokens[from + 1]?.type === ':') {
            this.declaration(block, from, from + 1, last, end, { name: text.slice(first.start, first.end), flavor: 'scss' });
            return;
        }

        // Stylus `name = value`
        if (
            this.syntax === 'stylus' &&
            (first.type === 'ident' || first.type === 'var') &&
            tokens[from + 1]?.type === 'delim' &&
            text[tokens[from + 1].start] === '=' &&
            text[tokens[from + 1].start + 1] !== '='
        ) {
            this.declaration(block, from, from + 1, last, end, { name: text.slice(first.start, first.end), flavor: 'stylus' });
            return;
        }

        // Indented Sass `+mixin(args)` include.
        if (this.syntax === 'sass' && first.type === 'delim' && text[first.start] === '+') {
            this.statement(block, 'at-statement', 'include', from, from + 1, last, end);
            return;
        }

        // Less mixin call: `.mixin(16px);` / `#ns > .mixin();`
        if (
            this.syntax === 'less' &&
            ((first.type === 'delim' && text[first.start] === '.') || first.type === 'hash')
        ) {
            const fn = tokens.slice(from, last).find(t => t.type === 'function');
            this.statement(block, 'mixin-call', fn ? text.slice(fn.start, fn.end) : undefined, from, from, last, end);
            return;
        }

        // Declaration: `prop: value`
        const colon = this.findColon(from, last);
        if (colon > from) {
            const nameTokens = tokens.slice(from, colon);
            const propertyLike = nameTokens.every(
                t =>
                    t.type === 'ident' ||
                    t.type === 'interp-open' ||
                    t.type === 'interp-close' ||
                    t.type === 'var' ||
                    t.type === 'placeholder' ||
                    (t.type === 'delim' && (text[t.start] === '*' || text[t.start] === '-' || text[t.start] === '_')),
            );
            if (propertyLike) {
                const isCustom = first.type === 'ident' && text.startsWith('--', first.start) && colon === from + 1;
                this.declaration(
                    block,
                    from,
                    colon,
                    last,
                    end,
                    isCustom ? { name: text.slice(first.start, first.end), flavor: 'css' } : undefined,
                );
                return;
            }
        }

        // Stylus declarations may omit the colon: `padding 16px`.
        if (this.syntax === 'stylus' && first.type === 'ident' && last - from >= 2 && tokens[from + 1].type !== '(') {
            this.declaration(block, from, from, last, end, undefined, true);
            return;
        }

        this.statement(block, 'other', undefined, from, from, last, end);
    }

    private findColon(from: number, to: number): number {
        let depth = 0;
        for (let i = from; i < to; i++) {
            const t = this.tokens[i];
            if (t.type === '(' || t.type === '[' || t.type === 'interp-open') {
                depth++;
            } else if (t.type === ')' || t.type === ']' || t.type === 'interp-close') {
                depth--;
            } else if (t.type === ':' && depth === 0) {
                return i;
            }
        }
        return -1;
    }

    private statement(
        block: BlockNode,
        kind: StatementKind,
        name: string | undefined,
        from: number,
        argsFrom: number,
        last: number,
        end: number,
    ): void {
        const stmt: StatementNode = {
            kind,
            parent: block,
            name,
            start: this.tokens[from].start,
            end,
            argTokens: [argsFrom, last],
        };
        block.children.push(stmt);
        this.out.statements.push(stmt);
    }

    private declaration(
        block: BlockNode,
        from: number,
        colon: number,
        last: number,
        end: number,
        variable?: { name: string; flavor: VariableFlavor },
        noColon = false,
    ): void {
        const { tokens, text } = this;
        const propEndToken = noColon ? tokens[from] : tokens[colon - 1];
        const propertySpan = { start: tokens[from].start, end: propEndToken.end };
        const rawProperty = text.slice(propertySpan.start, propertySpan.end);
        const valueFrom = noColon ? from + 1 : colon + 1;
        let valueTo = last;
        let important = false;
        // Strip a trailing `!important` / `!default` / `!global` from the value span.
        while (valueTo - 2 >= valueFrom && tokens[valueTo - 1].type === 'ident' && tokens[valueTo - 2].type === 'delim' && text[tokens[valueTo - 2].start] === '!') {
            if (text.slice(tokens[valueTo - 1].start, tokens[valueTo - 1].end).toLowerCase() === 'important') {
                important = true;
            }
            valueTo -= 2;
        }
        const valueSpan =
            valueFrom < valueTo
                ? { start: tokens[valueFrom].start, end: tokens[valueTo - 1].end }
                : { start: propertySpan.end, end: propertySpan.end };

        let property = '';
        if (variable) {
            property = variable.name;
        } else if (/^[-\w]+$/.test(rawProperty) || /^\*[-\w]+$/.test(rawProperty)) {
            property = rawProperty.replace(/^\*/, '').toLowerCase();
        }
        if (block.kind === 'nested-property' && property && !variable) {
            property = `${block.name}-${property}`;
        }

        const decl: DeclarationNode = {
            kind: 'declaration',
            parent: block,
            start: propertySpan.start,
            end,
            property,
            propertySpan,
            valueSpan,
            valueTokens: [valueFrom, valueTo],
            important,
            variable,
        };
        block.children.push(decl);
        block.declarations.push(decl);
        this.out.declarations.push(decl);
    }
}

/**
 * Converts an indentation-based token stream (indented Sass, Stylus) into a
 * brace-delimited one by inserting zero-width `{`, `}` and `;` tokens.
 */
function insertIndentationBraces(text: string, tokens: Token[]): Token[] {
    interface Line {
        tokens: Token[];
        indent: number;
    }
    const lines: Line[] = [];
    let depth = 0;
    let current: Line | undefined;
    for (const tok of tokens) {
        const startsLine = tok.newlineBefore && depth === 0 && !(current && endsWithContinuation(current.tokens));
        if (!current || startsLine) {
            current = { tokens: [], indent: indentationOf(text, tok.start) };
            lines.push(current);
        }
        current.tokens.push(tok);
        if (tok.type === '(' || tok.type === '[' || tok.type === 'interp-open' || tok.type === '{') {
            depth++;
        } else if (tok.type === ')' || tok.type === ']' || tok.type === 'interp-close' || tok.type === '}') {
            depth = Math.max(0, depth - 1);
        }
    }

    const out: Token[] = [];
    const stack: number[] = [];
    const synthetic = (type: Token['type'], at: number): Token => ({ type, start: at, end: at, synthetic: true });

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const next = lines[li + 1];
        const lastTok = line.tokens[line.tokens.length - 1];
        out.push(...line.tokens);
        const at = lastTok.end;
        if (next && next.indent > line.indent) {
            out.push(synthetic('{', at));
            stack.push(line.indent);
        } else {
            if (lastTok.type !== ';') {
                out.push(synthetic(';', at));
            }
            const nextIndent = next ? next.indent : -1;
            while (stack.length && stack[stack.length - 1] >= nextIndent) {
                stack.pop();
                out.push(synthetic('}', at));
            }
        }
    }
    return out;
}

function endsWithContinuation(tokens: Token[]): boolean {
    const last = tokens[tokens.length - 1];
    // A trailing comma continues a selector list or a value onto the next line.
    return !!last && last.type === ',';
}

function indentationOf(text: string, offset: number): number {
    let i = offset;
    while (i > 0 && text[i - 1] !== '\n') {
        i--;
    }
    let width = 0;
    for (let j = i; j < offset; j++) {
        width += text[j] === '\t' ? 4 : 1;
    }
    return width;
}
