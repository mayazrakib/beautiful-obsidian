import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxSettings } from "../src/contracts";

import { DEFAULT_SETTINGS } from "../src/defaults";
import { InboxStore } from "../src/storage/index";
import { parse_document, serialize_document } from "../src/storage/schema";
import { create_test_app, create_test_file, MockFile } from "./storage_mock";

vi.mock(
    "obsidian",
    async () => {
        const mocks = await import("./storage_mock");

        return {
            TFile: mocks.MockFile,
            TFolder: mocks.MockFolder,
            getFrontMatterInfo: mocks.parse_frontmatter,
            parseYaml: mocks.parse_yaml,
            stringifyYaml: mocks.stringify_yaml,

        };
    },
);

let fixture: ReturnType<typeof create_test_app>;
let settings: InboxSettings;
let store: InboxStore;

beforeEach(async () => {
    vi.stubGlobal(
        "crypto",
        webcrypto,
    );
    fixture = create_test_app();
    settings = structuredClone(DEFAULT_SETTINGS);

    store = new InboxStore(
        fixture.app,
        () => settings,
    );

    await store.start();
});

describe(
    "Inbox capture and indexing",
    () => {
        it(
            "captures Markdown with stable properties and returns its body",
            async () => {
                const result = await store.capture({
                    title: "Research",
                    body: "# Notes\n\nRead the source.",
                    tags: ["#reading"],

                });

                expect(result.status).toBe("created");
                expect(result.item.title).toBe("Research");
                expect(result.item.tags).toEqual(["reading"]);
                expect(await store.read_body(result.item.id)).toBe("# Notes\n\nRead the source.");
                expect(result.item.preview).toContain("Notes");
                expect(store.list_items()).toHaveLength(1);
            },
        );

        it(
            "serializes simultaneous captures and deduplicates source identity",
            async () => {
                const input = {
                    title: "Imported email",
                    source_id: "email:account",
                    external_id: "message-1",

                };

                const results = await Promise.all([store.capture(input), store.capture(input)]);
                expect(results.map((result) => result.status)).toEqual(["created", "duplicate"]);
                expect(results[0]?.item.id).toBe(results[1]?.item.id);
                expect(store.list_items()).toHaveLength(1);
            },
        );

        it(
            "rejects invalid captures and paths before writing notes",
            async () => {
                await expect(store.capture({
                    title: "",
                    body: "",

                })).rejects.toThrow("Enter a title");

                await expect(store.capture({
                    title: "Unsafe",
                    source_url: "javascript:alert(1)",

                })).rejects.toThrow("protocol");

                settings.capture_folder = "../outside";
                await expect(store.capture({ title: "Unsafe path" })).rejects.toThrow("path segments");
                expect(store.list_items()).toHaveLength(0);
            },
        );

        it(
            "reads cached metadata on startup without reading every note body",
            async () => {
                const captured = await store.capture({
                    title: "Already there",
                    body: "Existing body",

                });

                store.dispose();
                fixture.vault.read_count = 0;

                const reopened = new InboxStore(
                    fixture.app,
                    () => settings,
                );

                await reopened.start();
                expect(reopened.get_item(captured.item.id)?.title).toBe("Already there");
                expect(fixture.vault.read_count).toBe(0);
                reopened.dispose();
            },
        );

        it(
            "follows external renames and diagnoses duplicate UUIDs without editing either note",
            async () => {
                const result = await store.capture({ title: "Original" });
                const original = fixture.vault.getAbstractFileByPath(result.item.path) as MockFile;

                fixture.vault.rename(
                    original,
                    "Relocated.md",
                );

                expect(store.get_item(result.item.id)?.path).toBe("Relocated.md");

                await fixture.vault.create(
                    "Duplicate.md",
                    await fixture.vault.read(original),
                );

                expect(store.get_item(result.item.id)).toBeUndefined();
                expect(store.get_diagnostics().join(" ")).toContain("Duplicate Inbox ID");
            },
        );
    },
);

describe(
    "Conflict-aware writes and processing",
    () => {
        it(
            "refuses trash when the current note has been reclassified before its metadata cache updates",
            async () => {
                const result = await store.capture({
                    title: "Changed identity",
                    body: "Keep this note",

                });
                const file = fixture.vault.getAbstractFileByPath(result.item.path) as MockFile;
                const document = parse_document(await fixture.vault.read(file));
                document.metadata.beautiful_inbox = false;
                fixture.vault.contents.set(
                    file.path,
                    serialize_document(document),
                );
                const report = await store.trash_items([result.item.id]);
                expect(report.succeeded).toHaveLength(0);
                expect(report.failed[0]?.message).toContain("same Inbox item");
                expect(fixture.vault.trashed).toHaveLength(0);
                expect(fixture.vault.getAbstractFileByPath(file.path)).toBe(file);
            },
        );

        it(
            "keeps conflict detection after bounded snapshot eviction",
            async () => {
                const first = await store.capture({
                    title: "First",
                    body: "Initial content",

                });
                const revision = first.item.revision;

                for (let index = 0; index < 130; index++) {
                    await store.capture({
                        title: `Capture ${index}`,
                        body: "x".repeat(70_000),

                    });
                }

                const cache = store as unknown as {
                    snapshots: Map<
                        string,
                        string
                    >; snapshot_bytes: number;
                };
                expect(cache.snapshots.has(first.item.id)).toBe(false);
                expect(cache.snapshots.size).toBeLessThanOrEqual(128);
                expect(cache.snapshot_bytes).toBeLessThanOrEqual(8 * 1024 * 1024);

                const file = fixture.vault.getAbstractFileByPath(first.item.path) as MockFile;
                const original = fixture.vault.contents.get(file.path) as string;
                fixture.vault.contents.set(
                    file.path,
                    original.replace(
                        "Initial content",
                        "Changed content",
                    ),
                );
                await expect(store.update_item(
                    first.item.id,
                    { title: "Unsafe overwrite" },
                    revision,
                )).rejects.toThrow("changed outside");
                expect(fixture.vault.contents.get(file.path)).toContain("Changed content");
                expect(store.get_diagnostics().join(" ")).not.toContain("verification is unavailable");
            },
        );

        it(
            "preserves unrelated properties and exact body when changing state",
            async () => {
                const result = await store.capture({
                    title: "Preserve",
                    body: "\n# Heading\n\n- [ ] Leave this intact.\n",

                });

                const file = fixture.vault.getAbstractFileByPath(result.item.path) as MockFile;
                const document = parse_document(await fixture.vault.read(file));
                document.metadata.unrelated = { nested: [1, 2, 3] };

                fixture.vault.set_content(
                    file,
                    serialize_document(document),
                );

                await store.process_items(
                    [result.item.id],
                    "processed",
                );

                const updated = parse_document(await fixture.vault.read(file));
                expect(updated.metadata.unrelated).toEqual({ nested: [1, 2, 3] });
                expect(updated.body).toBe(document.body);
            },
        );

        it(
            "rejects stale revisions and concurrent changes during the atomic write",
            async () => {
                const result = await store.capture({
                    title: "Before",
                    body: "Initial",

                });

                const file = fixture.vault.getAbstractFileByPath(result.item.path) as MockFile;

                await store.update_item(
                    result.item.id,
                    { title: "Changed" },
                );

                await expect(store.update_item(
                    result.item.id,
                    { title: "Stale" },
                    result.item.revision,
                )).rejects.toThrow("changed");

                fixture.vault.before_process = () => fixture.vault.set_content(
                    file,
                    fixture.vault.contents.get(file.path) + "\nConcurrent edit",
                );

                await expect(store.update_item(
                    result.item.id,
                    { title: "Race" },
                )).rejects.toThrow("being saved");

                expect(await store.read_body(result.item.id)).toContain("Concurrent edit");
            },
        );

        it(
            "reports partial batch failures and undoes only untouched successful edits",
            async () => {
                const first = await store.capture({ title: "One" });
                const second = await store.capture({ title: "Two" });

                const report = await store.process_items(
                    [first.item.id, second.item.id, "missing"],
                    "archived",
                );

                expect(report.succeeded).toHaveLength(2);
                expect(report.failed).toHaveLength(1);
                const file = fixture.vault.getAbstractFileByPath(second.item.path) as MockFile;

                fixture.vault.set_content(
                    file,
                    fixture.vault.contents.get(file.path) + "\nExternal change",
                );

                const undo = await store.undo();
                expect(undo.succeeded).toEqual([first.item.id]);
                expect(undo.failed[0]?.id).toBe(second.item.id);
                expect(store.get_item(first.item.id)?.status).toBe("unprocessed");
                expect(store.get_item(second.item.id)?.status).toBe("archived");
            },
        );

        it(
            "restores due deferred items without changing future deferrals",
            async () => {
                const first = await store.capture({ title: "Due" });
                const second = await store.capture({ title: "Later" });

                await store.process_items(
                    [first.item.id],
                    "deferred",
                    new Date(Date.now() - 60_000).toISOString(),
                );

                await store.process_items(
                    [second.item.id],
                    "deferred",
                    new Date(Date.now() + 86_400_000).toISOString(),
                );

                await store.restore_due();
                expect(store.get_item(first.item.id)?.status).toBe("unprocessed");
                expect(store.get_item(first.item.id)?.review_at).toBeUndefined();
                expect(store.get_item(second.item.id)?.status).toBe("deferred");
            },
        );

        it(
            "uses recoverable local trash and removes subscriptions on dispose",
            async () => {
                const result = await store.capture({ title: "Trash me" });
                const listener = vi.fn();
                store.subscribe(listener);
                await store.trash_items([result.item.id]);
                expect(fixture.vault.trashed[0]?.is_system).toBe(false);
                expect(store.list_items()).toHaveLength(0);
                store.dispose();
                listener.mockClear();

                await fixture.vault.create(
                    "Unrelated.md",
                    "Note",
                );

                await Promise.resolve();
                expect(listener).not.toHaveBeenCalled();
                await expect(store.capture({ title: "Disposed" })).rejects.toThrow("disposed");
            },
        );
    },
);

describe(
    "Bases and attachments",
    () => {
        it(
            "preserves concurrent note edits while adding attachments",
            async () => {
                const result = await store.capture({
                    title: "Concurrent addition",
                    body: "Original body",

                });
                const file = fixture.vault.getAbstractFileByPath(result.item.path) as MockFile;
                const read_body = store.read_body.bind(store);
                vi.spyOn(
                    store,
                    "read_body",
                ).mockImplementationOnce(async (id) => {
                    const body = await read_body(id);
                    const original = fixture.vault.contents.get(file.path) as string;
                    fixture.vault.set_content(
                        file,
                        original + "\nConcurrent edit",
                    );

                    return body;
                });

                await expect(store.attach_files(
                    result.item.id,
                    [create_test_file("preserved.txt")],
                )).rejects.toThrow("changed");
                expect(fixture.vault.contents.get(file.path)).toContain("Concurrent edit");
                expect(fixture.vault.contents.get(file.path)).not.toContain("preserved.txt");
                expect(fixture.vault.getAbstractFileByPath("Beautiful/Inbox/Attachments/preserved.txt")).toBeInstanceOf(MockFile);
                expect(store.get_diagnostics().join(" ")).toContain("retained");
            },
        );

        it(
            "preserves concurrent note edits while removing attachments",
            async () => {
                const [result] = await store.import_files([create_test_file("retained.txt")]);
                const [attachment] = await store.list_attachments(result!.item.id);
                const file = fixture.vault.getAbstractFileByPath(result!.item.path) as MockFile;
                const read_body = store.read_body.bind(store);
                vi.spyOn(
                    store,
                    "read_body",
                ).mockImplementationOnce(async (id) => {
                    const body = await read_body(id);
                    const original = fixture.vault.contents.get(file.path) as string;
                    fixture.vault.set_content(
                        file,
                        original + "\nConcurrent edit",
                    );

                    return body;
                });

                await expect(store.remove_attachment(
                    result!.item.id,
                    attachment!.path,
                    true,
                )).rejects.toThrow("changed");
                expect(fixture.vault.contents.get(file.path)).toContain("Concurrent edit");
                expect(fixture.vault.contents.get(file.path)).toContain("retained.txt");
                expect(fixture.vault.trashed).toHaveLength(0);
            },
        );

        it(
            "creates the configurable native Base with the card canvas only",
            async () => {
                settings.base_folder = "Views";
                settings.base_name = "Universal Inbox";
                const file = await store.ensure_base();
                const configuration = JSON.parse(await fixture.vault.read(file as unknown as MockFile));
                expect(file.path).toBe("Views/Universal Inbox.base");
                expect(configuration.filters).toBe("note.beautiful_inbox == true");
                expect(configuration.views.map((view: { type: string; }) => view.type)).toEqual(["beautiful_inbox_cards"]);
                configuration.views[0].column_count = 7;
                const custom = JSON.stringify(configuration);

                fixture.vault.set_content(
                    file as unknown as MockFile,
                    custom,
                );

                await store.ensure_base();
                expect(await fixture.vault.read(file as unknown as MockFile)).toBe(custom);
                fixture.vault.set_content(
                    file as unknown as MockFile,
                    "Malformed YAML",
                );
                await expect(store.ensure_base()).rejects.toThrow("invalid YAML");
                expect(await fixture.vault.read(file as unknown as MockFile)).toBe("Malformed YAML");
            },
        );

        it(
            "migrates legacy list layouts to cards with a recoverable original and preserved custom filters",
            async () => {
                const original = JSON.stringify({
                    filters: "note.beautiful_inbox == true",
                    custom: "preserved",
                    views: [
                        {
                            type: "beautiful_inbox_list",
                            name: "List",
                            column_count: 5,
                            filters: "note.inbox_status == 'deferred'",
                            sort: [{
                                property: "note.captured_at",
                                direction: "ASC",
                            }],
                        },
                        {
                            type: "beautiful_inbox_cards",
                            name: "Cards",
                            column_count: 3,
                        },
                        {
                            type: "table",
                            name: "Table",
                            order: ["file.name", "note.inbox_status", "note.inbox_kind", "note.captured_at", "note.tags"],
                        },
                    ],

                });
                await fixture.vault.createFolder("Beautiful");
                await fixture.vault.createFolder("Beautiful/Inbox");
                const file = await fixture.vault.create(
                    "Beautiful/Inbox/Inbox.base",
                    original,
                );
                await store.ensure_base();
                const migrated = JSON.parse(await fixture.vault.read(file));
                expect(migrated.custom).toBe("preserved");
                expect(migrated.views.every((view: { type: string }) => view.type === "beautiful_inbox_cards")).toBe(true);
                expect(migrated.views[0].filters).toBe("note.inbox_status == 'deferred'");
                expect(migrated.views[0].column_count).toBe(5);
                expect(migrated.views[0].name).toBe("Cards 2");
                expect([...fixture.vault.contents.entries()].some(([path, content]) => path.includes("/Backups/") && content === original)).toBe(true);
            },
        );

        it(
            "imports attachments with safe collision handling and returns their metadata",
            async () => {
                const results = await store.import_files([create_test_file("photo.png"), create_test_file("photo.png")]);
                expect(results).toHaveLength(2);
                const first = results[0];
                const second = results[1];
                expect(first).toBeDefined();
                expect(second).toBeDefined();
                const first_attachments = await store.list_attachments(first!.item.id);
                const second_attachments = await store.list_attachments(second!.item.id);
                expect(first_attachments[0]?.path).toBe("Beautiful/Inbox/Attachments/photo.png");
                expect(second_attachments[0]?.path).toBe("Beautiful/Inbox/Attachments/photo 2.png");
                expect(first_attachments[0]?.kind).toBe("image");
            },
        );

        it(
            "removes only the link by default and refuses to trash a shared attachment",
            async () => {
                const [result] = await store.import_files([create_test_file("recording.webm")]);
                const item = result!.item;
                const [attachment] = await store.list_attachments(item.id);

                await fixture.vault.create(
                    "Other.md",
                    `![[${attachment!.path}]]`,
                );

                await expect(store.remove_attachment(
                    item.id,
                    attachment!.path,
                    true,
                )).rejects.toThrow("shared file");

                await store.remove_attachment(
                    item.id,
                    attachment!.path,
                );

                expect(await store.list_attachments(item.id)).toHaveLength(0);
                expect(fixture.vault.getAbstractFileByPath(attachment!.path)).toBeInstanceOf(MockFile);
                expect(fixture.vault.trashed).toHaveLength(0);
            },
        );

        it(
            "supports vault-root locations and explicit unshared attachment trash",
            async () => {
                settings.base_folder = "";
                settings.capture_folder = "";
                settings.attachment_folder = "";
                expect((await store.ensure_base()).path).toBe("Inbox.base");
                const [result] = await store.import_files([create_test_file("notes (copy).txt")]);
                const [attachment] = await store.list_attachments(result!.item.id);
                expect(attachment?.path).toBe("notes (copy).txt");

                await store.remove_attachment(
                    result!.item.id,
                    attachment!.path,
                    true,
                );

                expect(fixture.vault.trashed[0]?.path).toBe(attachment?.path);
                expect(fixture.vault.trashed[0]?.is_system).toBe(false);
            },
        );

        it(
            "does not import duplicate source files or orphan files for invalid captures",
            async () => {
                const input = {
                    source_id: "example",
                    external_id: "one",

                };

                await store.import_files(
                    [create_test_file("first.txt")],
                    input,
                );

                const duplicate = await store.import_files(
                    [create_test_file("second.txt")],
                    input,
                );

                expect(duplicate[0]?.status).toBe("duplicate");
                expect(fixture.vault.getAbstractFileByPath("Beautiful/Inbox/Attachments/second.txt")).toBeNull();

                await expect(store.import_files(
                    [create_test_file("bad.txt")],
                    { source_url: "javascript:unsafe" },
                )).rejects.toThrow("protocol");

                expect(fixture.vault.getAbstractFileByPath("Beautiful/Inbox/Attachments/bad.txt")).toBeNull();
            },
        );

        it(
            "enforces file limits before importing any attachments",
            async () => {
                settings.import_limit = 1;
                await expect(store.import_files([create_test_file("one.txt"), create_test_file("two.txt")])).rejects.toThrow("between 1 and 1");
                expect(fixture.vault.getAbstractFileByPath(settings.attachment_folder)).toBeNull();
            },
        );
    },
);
