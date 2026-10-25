import { getFrontMatterInfo, parseYaml, stringifyYaml } from "obsidian";
import type { TFile } from "obsidian";

import type { CaptureInput, CaptureKind, InboxItem, InboxStatus } from "../contracts";

export interface NoteDocument {
    metadata: Record<string, unknown>;
    body: string;
}

export const INBOX_STATUSES: readonly InboxStatus[] = ["unprocessed", "deferred", "processed", "archived"];
export const CAPTURE_KINDS: readonly CaptureKind[] = ["text", "link", "note", "file", "image", "audio", "email"];

const CONTROL_CHARACTER_LIMIT = 32;
const MAX_BODY_CHARACTERS = 2_000_000;
const MAX_TITLE_CHARACTERS = 256;
const MAX_SOURCE_CHARACTERS = 8192;
const MAX_TAGS = 100;
const PREVIEW_CHARACTERS = 240;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESERVED_FILENAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function create_error_message(error: unknown): string {
    return error instanceof Error ? error.message : "The operation failed.";
}

function has_control_characters(value: string): boolean {
    return [...value].some((character) => character.charCodeAt(0) < CONTROL_CHARACTER_LIMIT);
}

export function normalize_vault_path(
    path: string,
    can_be_root = false,
): string {
    const normalized = path.replace(
        /\\/g,
        "/",
    ).trim().replace(
        /\/+$/,
        "",
    );

    if (!normalized && can_be_root) {
        return "";
    }

    if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) {
        throw new Error("Choose a nonempty path inside this vault.");
    }

    const segments = normalized.split("/");

    if (segments.some((segment) => !segment || segment.startsWith(".") || /[. ]$/.test(segment) || RESERVED_FILENAME_PATTERN.test(segment) || /[<>:"|?*]/.test(segment) || has_control_characters(segment))) {
        throw new Error("Vault paths cannot contain hidden, parent, or invalid path segments.");
    }

    return segments.join("/");
}

export function sanitize_filename(name: string): string {
    let normalized = [...name].map((character) => character.charCodeAt(0) < CONTROL_CHARACTER_LIMIT ? " " : character).join("").replace(
        /[<>:"/\\|?*]/g,
        " ",
    ).replace(
        /\s+/g,
        " ",
    ).trim().replace(
        /[. ]+$/,
        "",
    );

    if (!normalized || normalized.startsWith(".")) {
        normalized = "Capture";
    }

    if (RESERVED_FILENAME_PATTERN.test(normalized)) {
        normalized = `Capture ${normalized}`;
    }

    return normalized.slice(
        0,
        120,
    ).replace(
        /[. ]+$/,
        "",
    );
}

export function validate_text(
    value: unknown,
    label: string,
    maximum: number,
): string {
    if (typeof value !== "string" || value.length > maximum || value.includes("\u0000")) {
        throw new Error(`${label} must be text within the supported size limit.`);
    }

    return value;
}

export function validate_timestamp(value: unknown): string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
        throw new Error("Use a valid date and time including its timezone.");
    }

    return new Date(value).toISOString();
}

export function normalize_tags(tags: unknown): string[] {
    if (!Array.isArray(tags) || tags.length > MAX_TAGS) {
        throw new Error("Tags must be a list of at most 100 tags.");
    }

    const normalized: string[] = [];

    for (const tag of tags) {
        if (typeof tag !== "string") {
            throw new Error("Each tag must be text.");
        }

        const value = tag.replace(
            /^#/,
            "",
        ).trim();

        if (!value || value.length > 128 || /[\s#,[\]]/.test(value)) {
            throw new Error("Tags cannot be empty or contain spaces, commas, or brackets.");
        }

        if (!normalized.includes(value)) {
            normalized.push(value);
        }
    }

    return normalized;
}

export function validate_capture(input: CaptureInput): CaptureInput {
    const body = validate_text(
        input.body ?? "",
        "Capture content",
        MAX_BODY_CHARACTERS,
    );

    const title = validate_text(
        input.title ?? "",
        "Capture title",
        MAX_TITLE_CHARACTERS,
    ).trim();

    const kind = input.kind ?? "text";

    if (!CAPTURE_KINDS.includes(kind)) {
        throw new Error("The capture kind is not supported.");
    }

    if (!title && !body.trim() && !input.source_url && kind !== "audio" && kind !== "file" && kind !== "image") {
        throw new Error("Enter a title, content, or source URL before capturing.");
    }

    if (Boolean(input.source_id) !== Boolean(input.external_id)) {
        throw new Error("External captures need both a source ID and an external ID.");
    }

    for (const value of [input.source_id, input.external_id]) {
        if (value !== undefined) {
            validate_text(
                value,
                "External capture identity",
                MAX_SOURCE_CHARACTERS,
            );

            if (!value.trim()) {
                throw new Error("External capture identities cannot be empty.");
            }
        }
    }

    if (input.source_url !== undefined) {
        validate_text(
            input.source_url,
            "Source URL",
            MAX_SOURCE_CHARACTERS,
        );

        let parsed_url: URL;

        try {
            parsed_url = new URL(input.source_url);
        } catch {
            throw new Error("Enter a valid source URL.");
        }

        if (!["http:", "https:", "mailto:", "obsidian:"].includes(parsed_url.protocol)) {
            throw new Error("The source URL protocol is not supported.");
        }
    }

    if (input.source_note !== undefined) {
        normalize_vault_path(input.source_note);
    }

    return {
        ...input,
        title,
        body,
        kind,
        tags: normalize_tags(input.tags ?? []),
        ...(input.captured_at ? { captured_at: validate_timestamp(input.captured_at) } : {}),
    };
}

export function create_preview(body: string): string {
    return body.replace(
        /!\[\[[^\]]*\]\]/g,
        " ",
    ).replace(
        /[#*`>]/g,
        "",
    ).replace(
        /\s+/g,
        " ",
    ).trim().slice(
        0,
        PREVIEW_CHARACTERS,
    );
}

export function parse_document(content: string): NoteDocument {
    const info = getFrontMatterInfo(content);

    if (!info.exists) {
        throw new Error("This note no longer has Inbox properties.");
    }

    const parsed: unknown = parseYaml(info.frontmatter);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("The note properties are not a valid mapping.");
    }

    return {
        metadata: { ...parsed as Record<string, unknown> },
        body: content.slice(info.contentStart),
    };
}

export function serialize_document(document: NoteDocument): string {
    return `---\n${stringifyYaml(document.metadata).trimEnd()}\n---\n${document.body}`;
}

export function create_revision(
    file: TFile,
    metadata: Record<string, unknown>,
): string {
    return `${file.stat.mtime}:${file.stat.size}:${String(metadata.system_updated_at ?? "")}`;
}

export function parse_item(
    file: TFile,
    metadata: Record<string, unknown>,
): InboxItem | undefined {
    if (metadata.beautiful_inbox !== true) {
        return undefined;
    }

    if (metadata.schema_version !== undefined && metadata.schema_version !== 1) {
        throw new Error("This Inbox record uses an unsupported schema version.");
    }

    if (typeof metadata.inbox_id !== "string" || !UUID_PATTERN.test(metadata.inbox_id)) {
        throw new Error("The Inbox ID must be a valid UUID.");
    }

    if (!CAPTURE_KINDS.includes(metadata.inbox_kind as CaptureKind) || !INBOX_STATUSES.includes(metadata.inbox_status as InboxStatus)) {
        throw new Error("The capture kind or Inbox state is invalid.");
    }

    const captured_at = validate_timestamp(metadata.captured_at);
    const title = typeof metadata.title === "string" ? metadata.title : file.basename;

    const item: InboxItem = {
        id: metadata.inbox_id,
        path: file.path,
        title,
        kind: metadata.inbox_kind as CaptureKind,
        status: metadata.inbox_status as InboxStatus,
        captured_at,
        tags: normalize_tags(metadata.tags ?? []),
        preview: typeof metadata.inbox_preview === "string" ? metadata.inbox_preview.slice(
            0,
            PREVIEW_CHARACTERS,
        ) : "",
        revision: create_revision(
            file,
            metadata,
        ),
    };

    if (metadata.review_at !== undefined) {
        item.review_at = validate_timestamp(metadata.review_at);
    }

    for (const key of ["source_url", "source_note", "source_id", "external_id"] as const) {
        const value = metadata[key];

        if (typeof value === "string") {
            item[key] = value;
        }
    }

    return item;
}
