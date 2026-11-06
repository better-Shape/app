import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/** A `#rrggbb` token from the `:root` block of app/globals.css. */
export const cssToken = (name: string): string => {
    const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
    if (!match) throw new Error(`${name} is not a #rrggbb token`);
    return match[1];
};

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
const luminance = (hex: string): number => {
    /** One sRGB channel of `hex`, linearised. */
    const channel = (offset: number) => {
        const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

/** The WCAG 2.x contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export const contrastRatio = (a: string, b: string): number => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
};
