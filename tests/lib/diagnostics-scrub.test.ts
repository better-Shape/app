import { describe, expect, it } from "vitest";
import { redactChatForReport, redactText } from "@/lib/diagnostics/scrub";

// Secret literals are assembled at runtime so the repository's own secret
// scanner does not flag this file for containing credentials.
const join = (...parts: string[]) => parts.join("");

const TOKENS = [
  join("gh", "p_", "1234567890abcdefghij1234567890abcd"),
  join("github", "_pat_", "11ABCDEFG0abcdefghijklmnopqrstuvwxyz0123456789"),
  join("AKIA", "IOSFODNN7EXAMPLE"),
  join("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c"),
  // The shapes lib/secret-scrub.ts never matched.
  join("pk", "_live_", "51H1234567890abcdefghijklmnop"),
  join("rk", "_live_", "51H1234567890abcdefghijklmnop"),
  join("whsec", "_", "abcdefghijklmnopqrstuvwx"),
  join("sk", "-live-", "abcdefghijklmnopqrstuvwx"),
];

const PEM = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

describe("redactText", () => {
    it("removes provider tokens wherever they appear in a line", () => {
        for (const token of TOKENS) {
            expect(redactText(`before ${token} after`)).not.toContain(token);
        }
    });

    it("removes a PEM private key block", () => {
        expect(redactText(`key follows\n${PEM}\ntrailing`)).not.toContain("BEGIN RSA PRIVATE KEY");
    });

    it("removes credentials supplied as key/value pairs", () => {
        const cases: Array<[string, string]> = [
            ['password="a b"', "a b"],
            ["api_key: abc123", "abc123"],
            ['{"token":"sec"}', "sec"],
            ["refresh_token=z", "z"],
            ["Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"],
            ['{"authToken":"abc"}', "abc"],
            ["clientSecret=xyz", "xyz"],
        ];
        for (const [input, secret] of cases) {
            expect(redactText(input)).not.toContain(secret);
        }
    });

    it("leaves ordinary prose alone", () => {
        expect(redactText("the token")).toBe("the token");
        expect(redactText("password field")).toBe("password field");
    });

    it("redacts email addresses and home directories", () => {
        expect(redactText("mail me at someone@example.com")).not.toContain("someone@example.com");
        expect(redactText("saved in /home/alice/secrets")).not.toContain("/home/alice");
        expect(redactText(String.raw`saved in C:\Users\alice\secrets`)).not.toContain("alice");
    });

    it("shortens deep paths to their last two segments", () => {
        expect(redactText("see /var/lib/secret/data.txt")).not.toContain("/var/lib/secret");
    });

    it("truncates to the requested length", () => {
        expect(redactText("x".repeat(5000), 100)).toHaveLength(100);
    });
});

describe("redactChatForReport", () => {
    it("keeps roles and redacts content", () => {
        const out = redactChatForReport([
            { role: "user", content: `my key is ${TOKENS[0]}` },
            { role: "assistant", content: "ok" },
        ]);
        expect(out).toHaveLength(2);
        expect(out[0].role).toBe("user");
        expect(out[0].content).not.toContain(TOKENS[0]);
        expect(out[1].content).toBe("ok");
    });

    it("labels anything that is not explicitly the assistant as user", () => {
        const out = redactChatForReport([{ role: "system", content: "sys" }]);
        expect(out[0].role).toBe("user");
    });

    it("drops empty messages", () => {
        expect(redactChatForReport([{ role: "user", content: "" }])).toEqual([]);
    });
});