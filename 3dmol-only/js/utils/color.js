const hexToRgbCache = {};

// Converts an hex color string to {r, g, b}. Cached for repeated lookups.
export function hexToRgb(hex) {
    if (hexToRgbCache[hex]) return hexToRgbCache[hex];

    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    const rgb = match
        ? {
            r: parseInt(match[1], 16),
            g: parseInt(match[2], 16),
            b: parseInt(match[3], 16)
        }
        : null;

    if (rgb) hexToRgbCache[hex] = rgb;
    return rgb;
}
