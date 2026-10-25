import { describe, expect, it, vi } from "vitest";

import type { InboxItem, InboxRepository } from "../src/contracts";

import { create_inbox_api } from "../src/api";
import { DEFAULT_SETTINGS } from "../src/defaults";

function create_fixture() {
    const item: InboxItem = {
        id: "capture",
        path: "Capture.md",
        title: "Original",
        kind: "text",
        status: "unprocessed",
        tags: ["work"],
        captured_at: "2026-10-25T00:00:00Z",
        preview: "Details",
        revision: "r1",

    };
    const process_items = vi.fn(async () => ({
        succeeded: [],
        failed: [],

    }));
    const repository = {
        list_items: () => [item],
        get_item: () => item,
        read_body: async () => "Details",
        capture: async () => ({
            status: "created",
            item,

        }),
        update_item: async () => item,
        process_items,

    } as unknown as InboxRepository;

    return {
        item,
        process_items,
        repository,
        api: create_inbox_api(
            repository,
            () => DEFAULT_SETTINGS,
        ),

    };
}

describe(
    "Public Inbox API",
    () => {
        it(
            "returns detached records and tags across every public read and write result",
            async () => {
                const { api, item } = create_fixture();
                const records = [api.list().items[0], api.get_item("capture"), (await api.read("capture")).item, (await api.capture({ title: "Capture" })).item, await api.update(
                    "capture",
                    { title: "Updated" },
                ), (await api.import([{ title: "Import" }]))[0]?.item];

                for (const record of records) {
                    if (!record) throw new Error("Missing fixture result.");
                    record.path = "Changed.md";
                    record.tags.push("changed");
                }

                expect(item.path).toBe("Capture.md");
                expect(item.tags).toEqual(["work"]);
            },
        );

        it(
            "waits for the initial index before accepting a capture",
            async () => {
                const { repository } = create_fixture();
                const capture = vi.spyOn(
                    repository,
                    "capture",
                );
                let finish_indexing: () => void = () => { };
                const ready = new Promise<void>((resolve) => {
                    finish_indexing = resolve;
                });
                const api = create_inbox_api(
                    repository,
                    () => DEFAULT_SETTINGS,
                    () => ready,
                );
                const pending = api.capture({ title: "Early capture" });

                await Promise.resolve();
                expect(capture).not.toHaveBeenCalled();
                finish_indexing();
                await pending;
                expect(capture).toHaveBeenCalledExactlyOnceWith({ title: "Early capture" });
            },
        );

        it(
            "rejects writes after initialization fails without creating a record",
            async () => {
                const { repository } = create_fixture();
                const capture = vi.spyOn(
                    repository,
                    "capture",
                );
                const api = create_inbox_api(
                    repository,
                    () => DEFAULT_SETTINGS,
                    async () => { throw new Error("Index unavailable"); },
                );

                await expect(api.capture({ title: "Early capture" })).rejects.toThrow("Index unavailable");
                expect(capture).not.toHaveBeenCalled();
            },
        );

        it(
            "rejects invalid pagination and oversized processing batches",
            async () => {
                const { api, process_items } = create_fixture();
                expect(() => api.list({ limit: NaN })).toThrow();
                expect(() => api.list({ offset: -1 })).toThrow();
                expect(() => api.list({ limit: 201 })).toThrow();
                await expect(api.process(
                    Array.from(
                        { length: 501 },
                        () => "capture",
                    ),
                    "processed",
                )).rejects.toThrow();
                expect(process_items).not.toHaveBeenCalled();
            },
        );
    },
);
