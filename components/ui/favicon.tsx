"use client";

import { Globe20Regular } from "@fluentui/react-icons/headless/svg/globe";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * A site's icon. Only an icon the page itself published is drawn: the in-app browser passes it as
 * `src` for a page the user opened. Every other site draws a globe, because asking an icon lookup
 * service would tell it each link and host the user sees.
 */
export function Favicon({
    src,
    size = 14,
    className,
}: {
    /** Icon address from the page itself, when the site published one. */
    src?: string | null;
    size?: number;
    className?: string;
}) {
    const [failed, setFailed] = useState<string | null>(null);
    const usable = src && /^(https?:|data:)/i.test(src) && src !== failed ? src : null;
    if (!usable) {
        return <Icon icon={Globe20Regular} className={cn("shrink-0 text-text-muted", className)} />;
    }
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={usable}
            alt=""
            width={size}
            height={size}
            className={cn("shrink-0 rounded-sm object-contain", className)}
            onError={() => setFailed(usable)}
        />
    );
}
