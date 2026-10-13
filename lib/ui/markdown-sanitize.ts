import { defaultSchema, type Options } from "rehype-sanitize";
const codeAttr = [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./] as [string, RegExp]];
export const EDITOR_SANITIZE_SCHEMA: Options = { ...defaultSchema, attributes: { ...defaultSchema.attributes, "*": [...(defaultSchema.attributes?.["*"] ?? []), "dataSourceStart", "dataSourceEnd"], code: codeAttr } };
export const GIT_SANITIZE_SCHEMA: Options = { ...defaultSchema, tagNames: [...(defaultSchema.tagNames ?? []), "button"], attributes: { ...defaultSchema.attributes, code: codeAttr } };
