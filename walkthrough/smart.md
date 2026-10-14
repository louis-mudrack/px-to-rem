# Smart units

Smart mode converts each property to the unit that behaves best when users change their font size or zoom:

| Property | Becomes | Why |
|---|---|---|
| `font-size`, spacing, sizes | `rem` | follows the user's font size setting |
| `line-height` | unitless (`1.5`) | scales with the element's own font size |
| `letter-spacing` | `em` | stays proportional to the text |
| `border`, `box-shadow`, 1px nudges | stays `px` | hairlines should stay crisp |
| `@media` breakpoints | `em` | browsers resolve them against their default size |

Hover any value to see the conversion, the reason, alternative units and matching design tokens. Hover `clamp()` to see its size at each breakpoint and whether it passes WCAG 1.4.4 with browser zoom.
