/**
 * English message templates produced by the engine. The extension passes
 * them through `vscode.l10n.t` (the template is the translation key), the
 * CLI prints them as they are. Placeholders are `{0}`, `{1}`, …
 */
export const MESSAGES = {
    // Why a value was or was not converted.
    'reason.disabled': 'Disabled by a px-to-rem comment.',
    'reason.uppercase': 'Uppercase PX is the opt-out marker, so it stays.',
    'reason.excluded-pattern': 'The line matches pxToRem.excludePatterns.',
    'reason.context': 'Not a value that should change here (selector, function definition or control flow).',
    'reason.breakpoint-mixin': 'Breakpoint mixin arguments are left to the mixin.',
    'reason.interpolation': 'Inside interpolation, left as written.',
    'reason.inside-function': 'Already passed to a conversion function.',
    'reason.variables-off': 'Variable conversion is off (pxToRem.convertVariables).',
    'reason.mixins-off': 'Mixin argument conversion is off (pxToRem.convertMixinArguments).',
    'reason.out-of-range': 'Outside pxToRem.minValue / pxToRem.maxValue.',
    'reason.excluded-property': 'The property is in pxToRem.excludeProperties.',
    'reason.not-included-property': 'The property is not in pxToRem.includeProperties.',
    'reason.media-keep': 'Media queries are kept as written (pxToRem.mediaQueries).',
    'reason.media-em': 'Breakpoints use em relative to the browser default ({0}px), so they follow the user font size.',
    'reason.media-rem': 'Breakpoints use rem relative to the browser default ({0}px).',
    'reason.media-format': 'Converted with the configured format.',
    'reason.zero': 'Zero needs no unit.',
    'reason.smart-keep': 'Smart mode keeps {0} in px: it should stay crisp and not grow with the text.',
    'reason.hairline': 'Smart mode keeps values up to {0}px in px (hairlines and nudges).',
    'reason.smart-em': 'em scales with this element’s font size ({0}px).',
    'reason.smart-unitless': 'A unitless line-height scales with the font size ({0}px).',
    'reason.smart-rem': 'rem scales with the user’s font size setting.',
    'reason.smart-convert': 'rem scales with the user’s font size setting.',
    'reason.smart-fallback': 'This element’s font size is unknown here, so rem is used instead.',
    'reason.format': 'Converted with the configured format.',
    'reason.token': 'Matches the design token {0}.',
    'reason.tailwind-scale': 'Matches the Tailwind scale.',

    // Diagnostics.
    'diag.px-unit': '{0} can be {1}.',
    'diag.font-size-px': 'px font sizes ignore the user’s browser font size (WCAG 1.4.4). Use {0}.',
    'diag.line-height-px': 'A px line-height does not grow with the text. Use {0}.',
    'diag.letter-spacing-px': 'px letter-spacing does not scale with the font. Use {0}.',
    'diag.media-query-px': 'px breakpoints ignore the user font size. Use {0}.',
    'diag.fixed-height-text': 'A fixed height clips text when users enlarge it (WCAG 1.4.4, 1.4.12). Use min-height.',
    'diag.text-width-px': 'A px max-width on text does not grow with the font. Consider {0} or ch.',
    'diag.viewport-font-size': 'A font size made only of viewport units cannot be enlarged with zoom (WCAG 1.4.4). Add a rem part, e.g. with clamp().',
    'diag.fluid-zoom': 'With browser zoom this font size only reaches {0}% at a {1}px wide window; WCAG 1.4.4 needs 200%. Keep max ≤ 2.5 × min.',
    'diag.off-scale': '{0} is not on your {1} scale. Nearest: {2}.',
    'diag.off-palette': '{0} is almost the colour token {1} (difference {2}).',
    'diag.rem-function-missing': '{0}() is not defined in this project. Generate the helper or switch pxToRem.format to "rem".',

    // Quick fixes.
    'fix.convertTo': 'Convert to {0}',
    'fix.useToken': 'Use token {0}',
    'fix.snapTo': 'Snap to {0}',
    'fix.minHeight': 'Use min-height',
    'fix.ignoreLine': 'Ignore px values on this line',
    'fix.generateHelper': 'Generate {0}() helper…',
    'fix.useRemFormat': 'Use the "rem" format instead',

    // Categories (for "not on your {1} scale").
    'category.spacing': 'spacing',
    'category.size': 'size',
    'category.font-size': 'font size',
    'category.line-height': 'line height',
    'category.letter-spacing': 'letter spacing',
    'category.radius': 'radius',
    'category.border': 'border',
    'category.shadow': 'shadow',
    'category.breakpoint': 'breakpoint',
    'category.other': 'token',
} as const;

export type MessageId = keyof typeof MESSAGES;

/** Fills `{0}`-style placeholders. */
export function fill(template: string, args: readonly (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (m, i: string) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m));
}

/** English text of a message (CLI). */
export function message(id: MessageId, ...args: (string | number)[]): string {
    return fill(MESSAGES[id], args);
}
