import { expect, it } from "vitest";
import { TurnOrder } from "@/lib/chat/turn-order";

it("retains one watermark per conversation after many turns without reviving old starts", () => {
    const order = new TurnOrder();
    for (let i = 1; i <= 10000; i++) {
        expect(order.start("a", `${i}:opaque`)).toBe(true);
        order.finish("a", `${i}:opaque`);
    }
    expect(order.size).toBe(1);
    expect(order.start("a", "1:opaque")).toBe(false);
    expect(order.start("a", "9999:opaque")).toBe(false);
    expect(order.start("a", "10000:opaque")).toBe(false);
    expect(order.start("a", "10001:opaque")).toBe(true);
});
it("orders each conversation separately and rejects starts delivered after completion", () => {
    const order = new TurnOrder();
    order.finish("a", "42:opaque");
    expect(order.start("a", "42:opaque")).toBe(false);
    expect(order.start("b", "1:opaque")).toBe(true);
    order.finish("a", "3:opaque");
    expect(order.start("a", "41:opaque")).toBe(false);
});
it("uses exact u64 ordinals and grants no authority to malformed or legacy ids", () => {
    const order = new TurnOrder();
    for (const id of ["uuid-only", "0:x", "01:x", "1:", "18446744073709551616:x"]) expect(order.start("a", id)).toBe(false);
    expect(order.start("a", "9007199254740992:a")).toBe(true);
    expect(order.start("a", "9007199254740993:b")).toBe(true);
    expect(order.start("a", "18446744073709551615:c")).toBe(true);
});
