import { Component } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { create_surface } from "@beautiful/design";

import type { CaptureInput, CaptureResult, InboxHost, InboxItem, ItemPatch } from "../src/contracts";

import { DEFAULT_SETTINGS } from "../src/defaults";
import { CaptureComposer } from "../src/ui/composer";
import { InboxInspector } from "../src/ui/inspector";

interface Deferred<Value> {
    promise: Promise<Value>;
    resolve: (value: Value) => void;
    reject: (error: Error) => void;
}

const OWNERS: Component[] = [];

function create_deferred<Value>(): Deferred<Value> {
    let resolve!: (value: Value) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Value>((
        accept,
        fail,
    ) => {
        resolve = accept;
        reject = fail;
    });

    return {
        promise,
        resolve,
        reject,
    };
}

function create_fixture() {
    const item: InboxItem = {
        id: "capture_1",
        path: "Inbox/First.md",
        title: "First capture",
        kind: "text",
        status: "unprocessed",
        captured_at: "2026-10-25T10:00:00Z",
        tags: [],
        preview: "Original",
        revision: "revision_1",
    };
    const result: CaptureResult = {
        status: "created",
        item,
    };
    const stored = new Map<string, unknown>();
    const repository = {
        capture: vi.fn(async (input: CaptureInput) => {
            void input;

            return result;
        }),
        attach_files: vi.fn(async (
            id: string,
            files: File[],
        ) => {
            void id;
            void files;

            return item;
        }),
        get_item: vi.fn((id: string) => id === item.id ? item : undefined),
        read_body: vi.fn(async () => "Original"),
        list_attachments: vi.fn(async () => []),
        update_item: vi.fn(async (
            id: string,
            patch: ItemPatch,
            revision?: string,
        ) => {
            void id;
            void patch;
            void revision;

            return {
                ...item,
                revision: "revision_2",
            };
        }),
    };
    const host = {
        app: {
            loadLocalStorage(key: string): unknown {
                const value = stored.get(key);

                return value === undefined ? null : structuredClone(value);
            },
            saveLocalStorage(
                key: string,
                value: unknown,
            ): void {
                if (value === null) stored.delete(key);
                else stored.set(
                    key,
                    structuredClone(value),
                );
            },
        },
        repository,
        audio: {
            get_state: () => ({
                phase: "idle",
                message: "Ready",
            }),
            subscribe: () => () => { },
        },
        get_settings: () => ({
            ...DEFAULT_SETTINGS,
            should_open_after_capture: false,
        }),
        notify: vi.fn(),
        open_inbox: vi.fn(async () => { }),
        when_ready: vi.fn(async () => { }),
    } as unknown as InboxHost;
    const owner = new Component();
    owner.load();
    OWNERS.push(owner);
    const container = document.createElement("div");
    document.body.append(container);
    const surface = create_surface(
        owner,
        container,
    );

    return {
        host,
        repository,
        item,
        result,
        stored,
        owner,
        container,
        surface,
    };
}

function edit_input(
    container: HTMLElement,
    label: string,
    value: string,
): void {
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);

    if (!input) throw new Error(`Input not found: ${label}`);

    input.value = value;
    input.dispatchEvent(new Event("input"));
}

function click_button(
    container: HTMLElement,
    label: string,
): void {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === label);

    if (!button) throw new Error(`Button not found: ${label}`);

    button.click();
}

function queue_file(
    container: HTMLElement,
    file: File,
): void {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');

    if (!input) throw new Error("File input not found.");

    Object.defineProperty(
        input,
        "files",
        {
            configurable: true,
            value: [file],
        },
    );
    input.dispatchEvent(new Event("change"));
}

afterEach(() => {
    for (const owner of OWNERS.splice(0)) owner.unload();

    document.body.replaceChildren();
});

describe(
    "Capture submission snapshots",
    () => {
        it(
            "waits for repository readiness before writing",
            async () => {
                const fixture = create_fixture();
                const ready = create_deferred<void>();
                const on_captured = vi.fn();
                fixture.host.when_ready = () => ready.promise;
                new CaptureComposer(
                    fixture.surface,
                    fixture.host,
                    {
                        draft_key: "capture_draft",
                        on_captured,
                    },
                );
                edit_input(
                    fixture.container,
                    "Capture details",
                    "Submitted thought",
                );
                click_button(
                    fixture.container,
                    "Capture",
                );
                expect(fixture.repository.capture).not.toHaveBeenCalled();
                ready.resolve();
                await vi.waitFor(() => expect(on_captured).toHaveBeenCalledOnce());
                expect(fixture.repository.capture).toHaveBeenCalledWith(expect.objectContaining({ body: "Submitted thought" }));
            },
        );

        it(
            "preserves newer text and files, and keeps the modal open after a slow capture",
            async () => {
                const fixture = create_fixture();
                const capture = create_deferred<CaptureResult>();
                const attachments = create_deferred<InboxItem>();
                fixture.repository.capture.mockImplementation(() => capture.promise);
                fixture.repository.attach_files.mockImplementation(() => attachments.promise);
                const on_captured = vi.fn();
                new CaptureComposer(
                    fixture.surface,
                    fixture.host,
                    {
                        draft_key: "capture_draft",
                        on_captured,
                    },
                );
                const first_file = new File(
                    ["First"],
                    "first.txt",
                    { type: "text/plain" },
                );
                const next_file = new File(
                    ["Next"],
                    "next.txt",
                    { type: "text/plain" },
                );
                const later_file = new File(
                    ["Later"],
                    "later.txt",
                    { type: "text/plain" },
                );
                edit_input(
                    fixture.container,
                    "Capture details",
                    "Submitted thought",
                );
                queue_file(
                    fixture.container,
                    first_file,
                );
                click_button(
                    fixture.container,
                    "Capture",
                );
                await vi.waitFor(() => expect(fixture.repository.capture).toHaveBeenCalledOnce());
                edit_input(
                    fixture.container,
                    "Capture details",
                    "Newer unsaved thought",
                );
                queue_file(
                    fixture.container,
                    next_file,
                );
                capture.resolve(fixture.result);
                await vi.waitFor(() => expect(fixture.repository.attach_files).toHaveBeenCalledOnce());
                expect(fixture.repository.attach_files.mock.calls[0]?.[1]).toEqual([first_file]);
                queue_file(
                    fixture.container,
                    later_file,
                );
                attachments.resolve(fixture.item);
                await vi.waitFor(() => expect(fixture.container.textContent).toContain("newer edits"));
                expect(fixture.stored.get("capture_draft")).toMatchObject({ body: "Newer unsaved thought" });
                expect(fixture.container.textContent).toContain("next.txt");
                expect(fixture.container.textContent).toContain("later.txt");
                expect(fixture.container.textContent).not.toContain("first.txt");
                expect(on_captured).not.toHaveBeenCalled();
                expect(fixture.repository.capture.mock.calls[0]?.[0].body).toBe("Submitted thought");
            },
        );

        it(
            "does not overwrite another capture window's newer local draft",
            async () => {
                const fixture = create_fixture();
                const capture = create_deferred<CaptureResult>();
                fixture.repository.capture.mockImplementation(() => capture.promise);
                const on_captured = vi.fn();
                new CaptureComposer(
                    fixture.surface,
                    fixture.host,
                    {
                        draft_key: "capture_draft",
                        on_captured,
                    },
                );
                edit_input(
                    fixture.container,
                    "Capture details",
                    "Submitted first-window thought",
                );
                click_button(
                    fixture.container,
                    "Capture",
                );
                await vi.waitFor(() => expect(fixture.repository.capture).toHaveBeenCalledOnce());
                fixture.stored.set(
                    "capture_draft",
                    {
                        title: "Second window",
                        body: "Another window's newer thought",
                        tags: "",
                        source_url: "",
                        kind: "text",
                    },
                );
                capture.resolve(fixture.result);
                await vi.waitFor(() => expect(fixture.container.textContent).toContain("another window"));
                expect(fixture.stored.get("capture_draft")).toMatchObject({ body: "Another window's newer thought" });
                expect(on_captured).not.toHaveBeenCalled();
            },
        );

        it(
            "does not erase a new draft entered while readiness is pending",
            async () => {
                const fixture = create_fixture();
                const ready = create_deferred<void>();
                const on_captured = vi.fn();
                fixture.host.when_ready = () => ready.promise;
                new CaptureComposer(
                    fixture.surface,
                    fixture.host,
                    {
                        draft_key: "capture_draft",
                        on_captured,
                    },
                );
                edit_input(
                    fixture.container,
                    "Capture details",
                    "First version",
                );
                click_button(
                    fixture.container,
                    "Capture",
                );
                edit_input(
                    fixture.container,
                    "Capture details",
                    "Second version",
                );
                ready.resolve();
                await vi.waitFor(() => expect(fixture.repository.capture).toHaveBeenCalledOnce());
                await vi.waitFor(() => expect(fixture.container.textContent).toContain("newer edits"));
                expect(fixture.repository.capture.mock.calls[0]?.[0].body).toBe("First version");
                expect(fixture.stored.get("capture_draft")).toMatchObject({ body: "Second version" });
                expect(on_captured).not.toHaveBeenCalled();
            },
        );
    },
);

describe(
    "Inspector save snapshots",
    () => {
        it(
            "preserves edits made during a save and advances their revision safely",
            async () => {
                const fixture = create_fixture();
                const save = create_deferred<InboxItem>();
                fixture.repository.update_item.mockImplementation(() => save.promise);
                const inspector = new InboxInspector(
                    fixture.surface,
                    fixture.host,
                    () => { },
                );
                await inspector.open_item(fixture.item);
                edit_input(
                    fixture.container,
                    "Item details",
                    "Submitted edit",
                );
                click_button(
                    fixture.container,
                    "Save changes",
                );
                expect(fixture.repository.update_item.mock.calls[0]?.[1].body).toBe("Submitted edit");
                edit_input(
                    fixture.container,
                    "Item details",
                    "Newer unsaved edit",
                );
                save.resolve({
                    ...fixture.item,
                    revision: "revision_2",
                });
                await vi.waitFor(() => expect(fixture.container.textContent).toContain("newer edits"));
                expect(fixture.stored.get("beautiful_inbox_item_draft_capture_1")).toMatchObject({
                    body: "Newer unsaved edit",
                    revision: "revision_2",
                });
                inspector.close();
                await inspector.open_item({
                    ...fixture.item,
                    revision: "revision_2",
                });
                expect(fixture.container.querySelector<HTMLTextAreaElement>('[aria-label="Item details"]')?.value).toBe("Newer unsaved edit");
            },
        );

        it(
            "preserves newer edits if the inspector closes before saving finishes",
            async () => {
                const fixture = create_fixture();
                const save = create_deferred<InboxItem>();
                fixture.repository.update_item.mockImplementation(() => save.promise);
                const inspector = new InboxInspector(
                    fixture.surface,
                    fixture.host,
                    () => { },
                );
                await inspector.open_item(fixture.item);
                edit_input(
                    fixture.container,
                    "Item details",
                    "Submitted edit",
                );
                click_button(
                    fixture.container,
                    "Save changes",
                );
                edit_input(
                    fixture.container,
                    "Item details",
                    "Later edit",
                );
                inspector.close();
                save.resolve({
                    ...fixture.item,
                    revision: "revision_2",
                });
                await vi.waitFor(() => expect(fixture.stored.get("beautiful_inbox_item_draft_capture_1")).toMatchObject({
                    body: "Later edit",
                    revision: "revision_2",
                }));
            },
        );

        it(
            "retains the local draft when an external edit causes a revision conflict",
            async () => {
                const fixture = create_fixture();
                fixture.repository.update_item.mockRejectedValue(new Error("This note changed elsewhere."));
                const inspector = new InboxInspector(
                    fixture.surface,
                    fixture.host,
                    () => { },
                );
                await inspector.open_item(fixture.item);
                edit_input(
                    fixture.container,
                    "Item details",
                    "Local edit",
                );
                click_button(
                    fixture.container,
                    "Save changes",
                );
                await vi.waitFor(() => expect(fixture.container.textContent).toContain("changed elsewhere"));
                expect(fixture.stored.get("beautiful_inbox_item_draft_capture_1")).toMatchObject({
                    body: "Local edit",
                    revision: "revision_1",
                });
            },
        );
    },
);
