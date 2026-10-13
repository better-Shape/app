import { describe, expect, it } from "vitest";
import { redactText } from "@/lib/diagnostics/scrub";
import { redactSecrets } from "@/lib/telemetry/sanitize";
const S = [["gh", "p_", "1234567890abcdefghij1234567890abcd"].join(""), ["github", "_pat_", "11ABCDEFG0abcdefghijklmnopqrstuvwxyz0123456789"].join(""), ["AKIA", "IOSFODNN7EXAMPLE"].join(""), ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c"].join(".")];
describe("scrub", () => {
    it("scrubs", () => {
        for (const s of S) for (const f of [redactText, redactSecrets]) expect(f(`x ${s} y`)).not.toContain(s);
        for (const [f, i, b] of [[redactText, 'password="a b"', "b"], [redactText, "api_key: abc123", "abc"], [redactText, '{"token":"sec"}', "sec"], [redactSecrets, 'password="a b"', "b"], [redactSecrets, "refresh_token=z", "z"], [redactSecrets, "Basic dXNlcjpwYXNz", "dX"], [redactSecrets, '{"authToken":"abc"}', "abc"], [redactSecrets, "clientSecret=xyz", "xyz"]] as const) expect(f(i)).not.toContain(b);
        expect([redactText("the token"), redactSecrets("password field")]).toEqual(["the token", "password field"]);
    });
});
