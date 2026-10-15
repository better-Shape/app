/** Native admissions prefix opaque turn ids with a process-monotonic u64. */
function sequence(id: string): bigint | null {
    const match = /^([1-9][0-9]{0,19}):(.+)$/.exec(id);
    if (!match) return null;
    const value = BigInt(match[1]);
    return value <= BigInt("18446744073709551615") ? value : null;
}

/** Constant space per observed conversation, regardless of its turn count. */
export class TurnOrder {
    private readonly latest = new Map<string, bigint>();
    get size(): number { return this.latest.size; }

    start(conversation: string, id: string): boolean {
        const value = sequence(id);
        if (value === null || value <= (this.latest.get(conversation) ?? BigInt(0))) return false;
        this.latest.set(conversation, value);
        return true;
    }

    finish(conversation: string, id: string): void {
        const value = sequence(id);
        if (value !== null && value > (this.latest.get(conversation) ?? BigInt(0))) this.latest.set(conversation, value);
    }
}
