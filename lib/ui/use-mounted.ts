import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};

/**
 * `false` on the server and while hydrating, `true` after hydration. During hydration React
 * reads the server snapshot, then re-renders once with `true`. Uses `useSyncExternalStore`
 * rather than `useEffect(() => setMounted(true))`, so no extra effect-driven render is needed.
 */
export function useIsMounted(): boolean {
    return useSyncExternalStore(
        subscribeNoop,
        () => true,
        () => false,
    );
}
