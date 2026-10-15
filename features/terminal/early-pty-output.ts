type Output = { chunks: string[]; characters: number };
const MAX_PTYS = 32;
const MAX_CHUNKS = 128;
const MAX_CHARACTERS = 32_768;

/** Keep recent chunk boundaries for status parsing without retaining unbounded startup output. */
function appendBounded(output: Output, data: string) {
    const chunk = data.slice(-MAX_CHARACTERS);
    while (output.chunks.length >= MAX_CHUNKS || output.characters + chunk.length > MAX_CHARACTERS) {
        const oldest = output.chunks.shift();
        if (oldest === undefined) break;
        output.characters -= oldest.length;
    }
    output.chunks.push(chunk);
    output.characters += chunk.length;
}

/** Provisional, per-listener output; only the PTY returned by spawn can consume it. */
export class EarlyPtyOutput {
    private readonly output = new Map<number, Output>();

    /** Bound unknown PTY count as well as each PTY's retained characters and chunk objects. */
    append(id: number, data: string): void {
        let output = this.output.get(id);
        if (!output) {
            if (this.output.size >= MAX_PTYS) return;
            output = { chunks: [], characters: 0 };
            this.output.set(id, output);
        }
        appendBounded(output, data);
    }

    /** Transfer the selected PTY's ordered chunks and discard every unrelated provisional record. */
    take(id: number): readonly string[] {
        const chunks = this.output.get(id)?.chunks ?? [];
        this.clear();
        return chunks;
    }

    /** Disposal must release provisional output even when spawn fails or is cancelled. */
    clear(): void {
        this.output.clear();
    }
}
