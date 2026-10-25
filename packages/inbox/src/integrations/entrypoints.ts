import type { CliData, Plugin } from "obsidian";

import type { CaptureInput, CaptureKind, InboxHost, InboxStatus, ItemPatch } from "../contracts";

const CAPTURE_KINDS: CaptureKind[] = ["text", "link", "note", "file", "image", "audio", "email"];
const ITEM_STATUSES: InboxStatus[] = ["unprocessed", "deferred", "processed", "archived"];
const MAX_BODY_CHARACTERS = 2_000_000;
const MAX_TITLE_CHARACTERS = 1000;
const MAX_PAGE_SIZE = 500;
const MAX_BULK_ITEMS = 500;

export function parse_capture_input(params: Record<
    string,
    string
>): CaptureInput {
    const input: CaptureInput = {};
    const title = params.title;
    const body = params.body ?? params.text;
    const source_url = params.source_url ?? params.url;
    const kind = params.kind ?? (source_url ? "link" : "text");

    if (!CAPTURE_KINDS.includes(kind as CaptureKind)) {
        throw new Error("Choose a supported capture kind.");
    }

    input.kind = kind as CaptureKind;

    if (title !== undefined) {
        if (title.length > MAX_TITLE_CHARACTERS) {
            throw new Error("The capture title is too long.");
        }

        input.title = title;
    }

    if (body !== undefined) {
        if (body.length > MAX_BODY_CHARACTERS) {
            throw new Error("The capture body is too large.");
        }

        input.body = body;
    }

    if (source_url) {
        const parsed_url = new URL(source_url);

        if (!["http:", "https:", "obsidian:"].includes(parsed_url.protocol)) {
            throw new Error("Use an HTTP, HTTPS, or Obsidian source URL.");
        }

        input.source_url = parsed_url.toString();
    }

    if (params.source_note) {
        if (params.source_note.startsWith("/") || params.source_note.split(/[\\/]/).includes("..")) {
            throw new Error("The source note must be a path inside this vault.");
        }

        input.source_note = params.source_note;
    }

    if (params.tags !== undefined) {
        input.tags = params.tags.split(",").map((tag) => tag.trim().replace(
            /^#/,
            "",
        )).filter(Boolean);
    }

    if (Boolean(params.source_id) !== Boolean(params.external_id)) {
        throw new Error("Supply source_id and external_id together for duplicate protection.");
    }

    if (params.source_id && params.external_id) {
        if (params.source_id.length > 1024 || params.external_id.length > 4096) {
            throw new Error("The source identifiers are too long.");
        }

        input.source_id = params.source_id;
        input.external_id = params.external_id;
    }

    return input;
}

function parse_status(value: string | undefined): InboxStatus {
    if (!value || !ITEM_STATUSES.includes(value as InboxStatus)) {
        throw new Error("Choose unprocessed, deferred, processed, or archived.");
    }

    return value as InboxStatus;
}

function parse_review_date(value: string): string {
    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
        throw new Error("Use a valid ISO review date.");
    }

    return date.toISOString();
}

function parse_integer(
    value: string | undefined,
    fallback: number,
    maximum: number,
): number {
    const result = value === undefined ? fallback : Number(value);

    if (!Number.isSafeInteger(result) || result < 0 || result > maximum) {
        throw new Error("The pagination value is outside the supported range.");
    }

    return result;
}

async function return_json(operation: () => unknown | Promise<unknown>): Promise<string> {
    try {
        return JSON.stringify({
            api_version: 1,
            ok: true,
            result: await operation(),

        });
    } catch (error) {
        return JSON.stringify({
            api_version: 1,
            ok: false,
            error: {
                code: "operation_failed",
                message: error instanceof Error ? error.message : "The Inbox operation failed.",

            },

        });
    }
}

export function register_capture_entrypoints(
    plugin: Plugin,
    host: InboxHost,
): void {
    const run_when_ready = (operation: () => unknown | Promise<unknown>) => return_json(async () => {
        await host.when_ready?.();
        return operation();
    });
    plugin.registerObsidianProtocolHandler(
        "beautiful-inbox",
        (params) => {
            try {
                if (params.mode === "open") {
                    void host.open_inbox().catch((error: unknown) => host.notify(error instanceof Error ? error.message : "Inbox could not be opened."));

                    return;
                }

                const input = parse_capture_input(params);

                if (host.get_settings().should_save_uri_automatically) {
                    void Promise.resolve(host.when_ready?.()).then(() => host.repository.capture(input)).then((result) => {
                        host.notify(result.status === "duplicate" ? "This capture is already in Inbox." : "Captured in Inbox.");

                        if (host.get_settings().should_open_after_capture) {
                            return host.open_inbox();
                        }

                        return undefined;
                    }).catch((error: unknown) => host.notify(error instanceof Error ? error.message : "The Inbox capture could not be saved."));
                } else {
                    host.open_capture(input);
                }
            } catch (error) {
                host.notify(error instanceof Error ? error.message : "The Inbox capture could not be opened.");
            }
        },
    );

    plugin.registerCliHandler(
        "beautiful-inbox:capture",
        "Capture text or a link into Beautiful Inbox.",
        {
            title: {
                description: "Capture title.",
                value: "<text>",

            },
            body: {
                description: "Capture Markdown body.",
                value: "<markdown>",

            },
            url: {
                description: "Source URL.",
                value: "<url>",

            },
            kind: {
                description: "Capture kind.",
                value: "<kind>",

            },
            tags: {
                description: "Comma-separated tags.",
                value: "<tags>",

            },
            source_note: {
                description: "Source note path inside the vault.",
                value: "<path>",

            },
            source_id: {
                description: "Source namespace for duplicate protection.",
                value: "<id>",

            },
            external_id: {
                description: "Unique identifier within the source.",
                value: "<id>",

            },

        },
        (params) => run_when_ready(() => host.repository.capture(parse_capture_input(params))),
    );

    plugin.registerCliHandler(
        "beautiful-inbox:list",
        "List Inbox captures as paginated JSON.",
        {
            cursor: {
                description: "Pagination cursor from a previous result.",
                value: "<cursor>",

            },
            limit: {
                description: "Page size, from 1 to 500.",
                value: "<number>",

            },
            status: {
                description: "Filter by processing status.",
                value: "<status>",

            },
            query: {
                description: "Filter titles, previews, and tags.",
                value: "<text>",

            },

        },
        (params) => run_when_ready(() => {
            const cursor = parse_integer(
                params.cursor,
                0,
                1_000_000,
            );

            const limit = Math.max(
                1,
                parse_integer(
                    params.limit,
                    100,
                    MAX_PAGE_SIZE,
                ),
            );

            const status = params.status ? parse_status(params.status) : undefined;
            const query = (params.query ?? "").toLocaleLowerCase();
            const items = host.repository.list_items().filter((item) => (!status || item.status === status) && (!query || `${item.title}\n${item.preview}\n${item.tags.join(" ")}`.toLocaleLowerCase().includes(query)));

            return {
                items: items.slice(
                    cursor,
                    cursor + limit,
                ),
                total: items.length,
                next_cursor: cursor + limit < items.length ? String(cursor + limit) : null,

            };
        }),
    );

    plugin.registerCliHandler(
        "beautiful-inbox:read",
        "Read a capture and establish a body baseline for conflict-checked edits.",
        {
            id: {
                description: "Capture ID.",
                value: "<id>",
                required: true,
            }
        },
        (params) => run_when_ready(async () => {
            if (!params.id) throw new Error("A capture ID is required.");
            const body = await host.repository.read_body(params.id);
            return {
                item: structuredClone(host.repository.get_item(params.id)),
                body,
            };
        }),
    );

    plugin.registerCliHandler(
        "beautiful-inbox:update",
        "Update one capture with optional revision checking.",
        {
            id: {
                description: "Capture ID.",
                value: "<id>",
                required: true,

            },
            title: {
                description: "Replacement title.",
                value: "<text>",

            },
            body: {
                description: "Replacement Markdown body.",
                value: "<markdown>",

            },
            status: {
                description: "Processing status.",
                value: "<status>",

            },
            tags: {
                description: "Replacement comma-separated tags.",
                value: "<tags>",

            },
            review_at: {
                description: "ISO review date, or an empty value to clear it.",
                value: "<date>",

            },
            expected_revision: {
                description: "Revision returned by list or capture.",
                value: "<revision>",

            },

        },
        (params: CliData) => run_when_ready(() => {
            if (!params.id) {
                throw new Error("A capture ID is required.");
            }

            const patch: ItemPatch = {};
            const input = parse_capture_input(params);

            if (input.title !== undefined) {
                patch.title = input.title;
            }

            if (input.body !== undefined) {
                patch.body = input.body;
            }

            if (input.tags !== undefined) {
                patch.tags = input.tags;
            }

            if (params.status !== undefined) {
                patch.status = parse_status(params.status);
            }

            if (params.review_at !== undefined) {
                patch.review_at = params.review_at ? parse_review_date(params.review_at) : null;
            }

            return host.repository.update_item(
                params.id,
                patch,
                params.expected_revision,
            );
        }),
    );

    plugin.registerCliHandler(
        "beautiful-inbox:process",
        "Process a bounded group of captures.",
        {
            ids: {
                description: "Comma-separated capture IDs or a JSON array of IDs.",
                value: "<ids>",
                required: true,

            },
            status: {
                description: "Destination processing status.",
                value: "<status>",
                required: true,

            },
            review_at: {
                description: "ISO review date for deferred captures.",
                value: "<date>",

            },

        },
        (params) => run_when_ready(() => {
            const raw_ids: unknown = params.ids?.startsWith("[") ? JSON.parse(params.ids) : (params.ids ?? "").split(",");

            if (!Array.isArray(raw_ids) || raw_ids.length === 0 || raw_ids.length > MAX_BULK_ITEMS || !raw_ids.every((id) => typeof id === "string" && Boolean(id.trim()))) {
                throw new Error("Supply between 1 and 500 valid capture IDs.");
            }

            const ids = [...new Set(raw_ids as string[])];
            const status = parse_status(params.status);
            const review_at = params.review_at ? parse_review_date(params.review_at) : undefined;

            return host.repository.process_items(
                ids,
                status,
                review_at,
            );
        }),
    );
}
