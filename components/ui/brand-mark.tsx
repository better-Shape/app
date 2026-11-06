import { siteMark } from "@/lib/brand/site-marks";
import { thesvgDataUrl } from "@/lib/brand/thesvg-image";
import { cn } from "@/lib/utils";

/**
 * A framework, editor or site mark from the bundle, so it renders offline and asks no CDN. A
 * one-colour variant takes `color`, as the marks' call sites choose their own; a mark with no such
 * variant draws in its own colours. Renders nothing for a slug the bundle does not carry.
 */
export function BrandMark({
    slug,
    color,
    size = 16,
    className,
}: {
    slug: string;
    /** An `rrggbb` colour without the `#`. */
    color?: string;
    size?: number;
    className?: string;
}) {
    const icon = siteMark(slug);
    if (!icon) return null;
    const mono = icon.variants.mono;
    const src = mono ? thesvgDataUrl(mono, color ?? icon.hex) : thesvgDataUrl(icon.variants.default ?? icon.svg);
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={src}
            alt=""
            width={size}
            height={size}
            className={cn("shrink-0 object-contain", className)}
            style={{ width: size, height: size }}
            draggable={false}
        />
    );
}
