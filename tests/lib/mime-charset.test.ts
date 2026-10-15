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
