let owner: string | undefined;
let sequence = BigInt(0);

/** An opaque, per-WebView namespace lets us reject retired local sends without a tombstone list. */
export function createChatRequestId(conversationId: string | null = null): string {
    owner ??= crypto.randomUUID();
    sequence += BigInt(1);
    return `${owner}:${encodeURIComponent(JSON.stringify(conversationId))}:${sequence}`;
}

export function isLocalChatRequest(id: string | null): boolean {
    return Boolean(owner && id?.startsWith(`${owner}:`));
}
