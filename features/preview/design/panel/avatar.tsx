"use client";

import { useState } from "react";
import { useGitHubAuth } from "@/lib/github/store";

/** Shows the connected GitHub avatar, when there is one. */
export function UserAvatar() {
    const github = useGitHubAuth();
    const [failed, setFailed] = useState(false);
    if (!github.loggedIn || !github.avatarUrl || failed) return null;
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={github.avatarUrl}
            alt=""
            className="size-5.5 rounded-full object-cover"
            onError={() => setFailed(true)}
        />
    );
}
