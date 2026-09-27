/** sRGB channel → WCAG relative luminance (0–1). */
function channelLuminance(channel: number): number {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parseRgbTriplet(color: string): [number, number, number] | null {
    const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) {
        return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    }
    const hex = color.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return null;
}

export function relativeLuminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map(channelLuminance) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio for two sRGB colors (1–21). */
export function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
    const l1 = relativeLuminance(fg);
    const l2 = relativeLuminance(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

export function contrastRatioFromCss(fgColor: string, bgColor: string): number | null {
    const fg = parseRgbTriplet(fgColor.trim());
    const bg = parseRgbTriplet(bgColor.trim());
    if (!fg || !bg) return null;
    return contrastRatio(fg, bg);
}

export const WCAG_AA_NORMAL_TEXT = 4.5;
