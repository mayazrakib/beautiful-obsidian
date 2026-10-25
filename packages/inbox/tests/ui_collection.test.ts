import { describe, expect, it } from "vitest";

import type { InboxItem } from "../src/contracts";

import {
    can_start_card_drag,
    filter_groups,
    MAX_INTERACTIVE_CARDS,
    resolve_active_item_id,
    select_interactive_nodes,
    should_render_overview,
} from "../src/ui/collection_model";

function create_item(index: number): InboxItem {
    return {
        id: `capture_${index}`,
        path: `Inbox/${index}.md`,
        title: `Capture ${index}`,
        kind: index % 2 ? "link" : "text",
        status: "unprocessed",
        captured_at: "2026-10-25T10:00:00Z",
        tags: index % 2 ? ["research"] : [],
        preview: `Preview ${index}`,
        revision: "1",
    };
}

describe(
    "Inbox metadata filtering",
    () => {
        it(
            "combines state, kind, tag, source, and preview search without reordering native groups",
            () => {
                const groups = [{
                    label: "Research",
                    items: Array.from(
                        { length: 6 },
                        (
                            _value,
                            index,
                        ) => create_item(index),
                    ),
                }];

                const cache = new Map<string, { revision: string; text: string; }>();

                const filtered = filter_groups(
                    groups,
                    "research preview",
                    "unprocessed",
                    "link",
                    cache,
                );

                expect(filtered[0]?.label).toBe("Research");
                expect(filtered[0]?.items.map((item) => item.id)).toEqual(["capture_1", "capture_3", "capture_5"]);
                expect(cache.size).toBe(3);
            },
        );

        it(
            "updates cached search projections when a capture changes",
            () => {
                const item = create_item(0);

                const group = {
                    label: "",
                    items: [item],
                };

                const cache = new Map<string, { revision: string; text: string; }>();

                expect(filter_groups(
                    [group],
                    "updated",
                    "all",
                    "all",
                    cache,
                )).toEqual([]);

                item.title = "Updated title";
                item.revision = "2";

                expect(filter_groups(
                    [group],
                    "updated",
                    "all",
                    "all",
                    cache,
                )[0]?.items).toHaveLength(1);
            },
        );
    },
);

describe(
    "Canvas density and focus preservation",
    () => {
        it(
            "switches to a real overview rather than silently dropping dense visible captures",
            () => {
                expect(should_render_overview(
                    1,
                    201,
                )).toBe(true);

                expect(should_render_overview(
                    0.2,
                    20,
                )).toBe(true);

                expect(should_render_overview(
                    0.35,
                    200,
                )).toBe(false);
            },
        );

        it(
            "bounds interactive nodes and always includes the focused or dragged capture",
            () => {
                const nodes = Array.from(
                    { length: 10000 },
                    (
                        _value,
                        index,
                    ) => ({ item: { id: `capture_${index}` } }),
                );

                const pinned = nodes[9999];

                if (!pinned) throw new Error("Missing fixture.");

                const selected = select_interactive_nodes(
                    nodes,
                    [pinned],
                );

                expect(selected.length).toBe(MAX_INTERACTIVE_CARDS);
                expect(selected.some((node) => node.item.id === "capture_9999")).toBe(true);
                expect(new Set(selected.map((node) => node.item.id)).size).toBe(selected.length);
            },
        );

        it(
            "pins the actual focused checkbox row rather than a previously focused title",
            () => {
                const collection = document.createElement("div");
                const card = document.createElement("div");
                card.className = "beautiful_inbox_item";
                card.dataset.itemId = "current_checkbox_capture";
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                card.append(checkbox);
                collection.append(card);

                expect(resolve_active_item_id(
                    collection,
                    checkbox,
                    "previous_title_capture",
                )).toBe("current_checkbox_capture");
            },
        );

        it(
            "does not pin a stale card while focus is in a composer or inspector",
            () => {
                const collection = document.createElement("div");
                const outside = document.createElement("textarea");

                expect(resolve_active_item_id(
                    collection,
                    outside,
                    "old_capture",
                )).toBeUndefined();
            },
        );
    },
);

describe("Native card action gesture guards", () => {
    it("does not start a drag from native role buttons or clickable icon descendants", () => {
        const action = document.createElement("div");
        action.className = "clickable-icon extra-setting-button";
        action.setAttribute("role", "button");
        const icon = document.createElement("span");
        action.append(icon);
        expect(can_start_card_drag(icon)).toBe(false);
        action.removeAttribute("role");
        expect(can_start_card_drag(icon)).toBe(false);
    });

    it("allows the explicit move handle while leaving title buttons interactive", () => {
        const handle = document.createElement("div");
        handle.className = "clickable-icon";
        handle.setAttribute("role", "button");
        handle.dataset.canvasHandle = "move";
        const icon = document.createElement("span");
        handle.append(icon);
        expect(can_start_card_drag(icon)).toBe(true);
        expect(can_start_card_drag(document.createElement("button"))).toBe(false);
        expect(can_start_card_drag(document.createElement("div"))).toBe(true);
    });
});
