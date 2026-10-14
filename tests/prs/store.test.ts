import { afterEach, expect, it } from "vitest";
import { getPrUi, selectPr, updateSelectedPr } from "@/features/chat/ui/prs/store";
import type { PrItem } from "@/features/chat/ui/prs/mapping";
const item: PrItem = { id: "123", number: 123, title: "Later page", status: "open", repo: "owner/repo", labels: [], updated: "" };
afterEach(() => selectPr(null));
it("retains the selected row for detail surfaces that did not load its list page", () => {
    selectPr(item.id, item);
    expect(getPrUi().selectedItem).toEqual(item);
    updateSelectedPr({ ...item, status: "closed" });
    expect(getPrUi().selectedItem?.status).toBe("closed");
});
it("does not update a different selection or repo from late detail responses", () => {
    selectPr(item.id, item);
    updateSelectedPr({ ...item, repo: "other/repo", title: "Wrong repo" });
    expect(getPrUi().selectedItem?.title).toBe("Later page");
    selectPr("new");
    updateSelectedPr({ ...item, title: "Late" });
    expect(getPrUi().selectedId).toBe("new");
    expect(getPrUi().selectedItem).toBeUndefined();
});
it("never pairs an item with the wrong selected ID", () => {
    selectPr("different", item);
    expect(getPrUi().selectedItem).toBeUndefined();
});
