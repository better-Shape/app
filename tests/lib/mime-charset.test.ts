import { expect, it } from "vitest";
import { mimeCharset } from "@/lib/http/mime-charset";

it.each([
    ['text/plain;charset="windows-1252 ', 'windows-1252'],
    ['text/plain;charset="windows-1252 "', 'windows-1252 '],
    ['text/plain;label=";charset=utf-8";charset=windows-1252', 'windows-1252'],
    ['text/plain;charset="win\\dows-1252"', 'windows-1252'],
    ['text/plain;charset="";charset=utf-8', ''],
    ['text/plain;charset=;charset=utf-8', 'utf-8'],
    ['text/plain;charset =windows-1252;charset=utf-8', 'utf-8'],
    ['text/plain;charset="utf-8"ignored;charset=windows-1252', 'utf-8'],
    ['text/plain;charset="\u0001";charset=utf-8', 'utf-8'],
    ['not-a-mime;charset=utf-8', undefined],
    ['text/plain', undefined],
    [' TEXT/PLAIN ; CHARSET=UTF-16LE ', 'UTF-16LE'],
])("extracts the standard charset parameter from %s", (source, expected) => {
    expect(mimeCharset(source)).toBe(expected);
});

it.each([
    ["\t", "utf-8\t"], ["\n", undefined], ["\r", undefined], [" ", "utf-8 "],
])("trims HTTP whitespace %j outside quotes and validates quoted values", (whitespace, quoted) => {
    expect(mimeCharset(`text/plain;charset=utf-8${whitespace}`)).toBe("utf-8");
    expect(mimeCharset(`text/plain;charset="utf-8${whitespace}"`)).toBe(quoted);
});

it.each(["\v", "\f", "\u00a0"])("does not trim non-HTTP trailing whitespace %j", whitespace => {
    expect(mimeCharset(`text/plain${whitespace};charset=utf-8`)).toBeUndefined();
});

it("handles a long internal whitespace run that is not a trailing suffix", () => {
    const value = `text/plain;label=${" ".repeat(32_000)}x;charset=utf-8`;
    expect(mimeCharset(value)).toBe("utf-8");
});

it("skips many valueless parameters without scanning the remaining header for each", () => {
    expect(mimeCharset(`text/plain${";unused".repeat(8_000)};charset=utf-8`)).toBe("utf-8");
});
