"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

/** Preparation belongs to a project lifetime and a chat, including its unnamed draft. */
export function useSendPreparations(projectPath: string | null, conversationId: string | null) {
    const scope = useMemo(() => ({ projectPath }), [projectPath]);
    const activeScope = useRef<typeof scope | null>(null);
    const controllers = useRef(new Map<AbortController, string | null>());
    const [snapshot, setSnapshot] = useState(() => ({ scope, owners: new Set<string | null>() }));

    useLayoutEffect(() => {
        activeScope.current = scope;
        const pending = controllers.current;
        return () => {
            activeScope.current = null;
            const cancelled = [...pending.keys()];
            pending.clear();
            for (const controller of cancelled) controller.abort();
            // StrictMode can clean up effects without discarding their state.
            if (cancelled.length) {
                setSnapshot(previous => previous.scope === scope ? { scope, owners: new Set() } : previous);
            }
        };
    }, [scope]);

    const publish = useCallback(() => {
        setSnapshot({ scope, owners: new Set(controllers.current.values()) });
    }, [scope]);

    const begin = useCallback((owner: string | null) => {
        const controller = new AbortController();
        // Retained callbacks must not admit work after unmount or a project switch.
        if (activeScope.current !== scope) controller.abort();
        else {
            controllers.current.set(controller, owner);
            publish();
        }
        return controller;
    }, [scope, publish]);

    const finish = useCallback((controller: AbortController) => {
        if (activeScope.current === scope && controllers.current.delete(controller)) publish();
    }, [scope, publish]);

    const cancel = useCallback((owner: string | null) => {
        if (activeScope.current !== scope) return;
        let changed = false;
        for (const [controller, target] of [...controllers.current]) {
            if (target !== owner) continue;
            // Remove before abort: an uncooperative await need not settle to clear Stop.
            controllers.current.delete(controller);
            changed = true;
            controller.abort();
        }
        if (changed) publish();
    }, [scope, publish]);

    return {
        isPreparing: snapshot.scope === scope && snapshot.owners.has(conversationId),
        begin,
        finish,
        cancel,
    };
}
