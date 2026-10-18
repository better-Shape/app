import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
    it("keeps native tooltip text out of the rendered title attribute", () => {
        const markup = renderToString(<Button title="Save changes">Save</Button>);

        expect(markup).toContain('data-native-title="Save changes"');
        expect(markup).not.toMatch(/\s+title=/);
    });
});
