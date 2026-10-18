/** Announces the graph's initial loading state without marking its own live region busy. */
export function GraphLoadingStatus() {
    return (
        <div className="flex flex-col gap-2 px-3 py-3" role="status">
            <span className="sr-only">Loading commits</span>
            <div aria-hidden="true">
                {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className="flex items-center gap-2">
                        <span className="size-5 shrink-0 rounded-full bg-panel-hover" />
                        <span
                            className="h-3 flex-1 rounded-md bg-panel-hover"
                            style={{ maxWidth: `${70 - (index % 3) * 12}%` }}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
