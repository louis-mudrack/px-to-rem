/** Colour maths: sRGB → CIELAB and the CIEDE2000 difference. */

type RGBA = readonly [number, number, number, number];

function srgbToLinear(c: number): number {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB (0–255) → CIELAB with a D65 white point. */
export function rgbToLab([r, g, b]: RGBA): [number, number, number] {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);
    const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
    const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
    const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883;
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const fx = f(x);
    const fy = f(y);
    const fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** CIEDE2000 colour difference. Around 1 is a just-noticeable difference. */
export function deltaE2000(a: RGBA, b: RGBA): number {
    const [L1, a1, b1] = rgbToLab(a);
    const [L2, a2, b2] = rgbToLab(b);
    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const Cbar = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);
    const h1p = C1p === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360;
    const h2p = C2p === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360;
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
        dhp = h2p - h1p;
        if (dhp > 180) {
            dhp -= 360;
        } else if (dhp < -180) {
            dhp += 360;
        }
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
    const Lbarp = (L1 + L2) / 2;
    const Cbarp = (C1p + C2p) / 2;
    let hbarp = h1p + h2p;
    if (C1p * C2p !== 0) {
        if (Math.abs(h1p - h2p) > 180) {
            hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
        } else {
            hbarp = (h1p + h2p) / 2;
        }
    }
    const T =
        1 -
        0.17 * Math.cos(rad(hbarp - 30)) +
        0.24 * Math.cos(rad(2 * hbarp)) +
        0.32 * Math.cos(rad(3 * hbarp + 6)) -
        0.2 * Math.cos(rad(4 * hbarp - 63));
    const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    const Rc = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
    const Sl = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
    const Sc = 1 + 0.045 * Cbarp;
    const Sh = 1 + 0.015 * Cbarp * T;
    const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
    return Math.sqrt(
        Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh),
    );
}

/** `#rrggbb` (or `#rrggbbaa` when not opaque). */
export function toHex([r, g, b, a]: RGBA): string {
    const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ''}`;
}
