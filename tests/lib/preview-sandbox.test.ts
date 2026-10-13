import { describe, expect, it } from "vitest";
import { previewFrameSandbox } from "@/lib/agent-preview/sandbox";
describe("sandbox", () => { it("isolates", () => expect([previewFrameSandbox(true), previewFrameSandbox(false)]).toEqual(["allow-scripts", "allow-scripts"])); });
