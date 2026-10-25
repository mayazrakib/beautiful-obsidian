import { TFile } from "obsidian";
import type { App, CachedMetadata, EventRef } from "obsidian";

import type {
    CaptureInput,
    CaptureResult,
    InboxAttachment,
    InboxItem,
    InboxRepository,
    InboxSettings,
    InboxStatus,
    ItemPatch,
    OperationReport,
} from "../contracts";

import { ensure_folder, ensure_inbox_base } from "./base";
import {
    create_error_message,
    create_preview,
    INBOX_STATUSES,
    normalize_tags,
    normalize_vault_path,
    parse_document,
    parse_item,
    sanitize_filename,
    serialize_document,
    validate_capture,
    validate_text,
    validate_timestamp,
} from "./schema";

interface UndoEntry {
    id: string;
    before: string;
    after: string;
}

interface AttachmentReference {
    path: string;
    start: number;
    end: number;
}

const MAX_UNDO_BATCHES = 30;
const MAX_UNDO_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_ENTRIES = 128;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav", "ogg", "webm", "flac", "aac", "3gp"]);

export class InboxStore implements InboxRepository {
    private readonly app: App;
    private readonly get_settings: () => InboxSettings;
    private readonly entries = new Map<string, InboxItem>();
    private readonly id_paths = new Map<string, Set<string>>();
    private readonly items = new Map<string, InboxItem>();
    private readonly external_items = new Map<string, string>();
    private readonly snapshots = new Map<string, string>();
    private readonly content_fingerprints = new Map<string, { revision: string; hash: Promise<string | undefined>; }>();
    private readonly diagnostics = new Map<string, string>();
    private readonly listeners = new Set<() => void>();
    private readonly event_refs: { source: "vault" | "metadata"; event: EventRef; }[] = [];
    private readonly undo_batches: UndoEntry[][] = [];
    private mutation_queue: Promise<unknown> = Promise.resolve();
    private revision_sequence = 0;
    private snapshot_bytes = 0;
    private undo_bytes = 0;
    private is_started = false;
    private is_disposed = false;
    private is_notification_pending = false;

    constructor(
        app: App,
        get_settings: () => InboxSettings,
    ) {
        this.app = app;
        this.get_settings = get_settings;
    }

    async start(): Promise<void> {
        if (this.is_started) {
            return;
        }

        this.is_started = true;
        this.is_disposed = false;

        for (const file of this.app.vault.getMarkdownFiles()) {
            this.index_file(
                file,
                this.app.metadataCache.getFileCache(file),
            );
        }

        this.event_refs.push({
            source: "metadata",
            event: this.app.metadataCache.on(
                "changed",
                (
                    file,
                    data,
                    cache,
                ) => {
                    this.index_file(
                        file,
                        cache,
                        data,
                    );

                    this.notify();
                },
            ),
        });

        this.event_refs.push({
            source: "vault",
            event: this.app.vault.on(
                "delete",
                (file) => {
                    this.remove_path(file.path);
                    this.notify();
                },
            ),
        });

        this.event_refs.push({
            source: "vault",
            event: this.app.vault.on(
                "rename",
                (
                    file,
                    old_path,
                ) => {
                    this.remove_path(old_path);

                    if (file instanceof TFile && file.extension === "md") {
                        this.index_file(
                            file,
                            this.app.metadataCache.getFileCache(file),
                        );
                    }

                    this.notify();
                },
            ),
        });

        this.event_refs.push({
            source: "vault",
            event: this.app.vault.on(
                "create",
                (file) => {
                    if (file instanceof TFile && file.extension === "md") {
                        this.index_file(
                            file,
                            this.app.metadataCache.getFileCache(file),
                        );

                        this.notify();
                    }
                },
            ),
        });

        this.notify();
    }

    dispose(): void {
        this.is_disposed = true;

        for (const reference of this.event_refs.splice(0)) {
            if (reference.source === "metadata") {
                this.app.metadataCache.offref(reference.event);
            } else {
                this.app.vault.offref(reference.event);
            }
        }

        this.listeners.clear();
        this.entries.clear();
        this.id_paths.clear();
        this.items.clear();
        this.external_items.clear();
        this.snapshots.clear();
        this.content_fingerprints.clear();
        this.snapshot_bytes = 0;
        this.undo_bytes = 0;
        this.undo_batches.length = 0;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);

        return () => this.listeners.delete(listener);
    }

    list_items(): InboxItem[] {
        return [...this.items.values()].sort((
            first,
            second,
        ) => second.captured_at.localeCompare(first.captured_at) || first.id.localeCompare(second.id));
    }

    get_item(id: string): InboxItem | undefined {
        return this.items.get(id);
    }

    async read_body(id: string): Promise<string> {
        const file = this.require_file(id);
        const content = await this.app.vault.read(file);

        if (!this.snapshots.has(id)) {
            this.cache_snapshot(
                id,
                content,
            );
        }

        const item = this.items.get(id);

        if (item && !this.content_fingerprints.has(id)) {
            this.cache_fingerprint(
                item,
                content,
            );
        }

        return parse_document(content).body;
    }

    capture(input: CaptureInput): Promise<CaptureResult> {
        return this.enqueue(() => this.capture_direct(input));
    }

    update_item(
        id: string,
        patch: ItemPatch,
        expected_revision?: string,
    ): Promise<InboxItem> {
        return this.enqueue(async () => {
            const result = await this.write_item(
                id,
                patch,
                expected_revision,
            );

            this.remember_undo([result.undo]);

            return result.item;
        });
    }

    process_items(
        ids: string[],
        status: InboxStatus,
        review_at?: string,
    ): Promise<OperationReport> {
        return this.enqueue(async () => {
            if (!INBOX_STATUSES.includes(status)) {
                throw new Error("Choose a valid Inbox state.");
            }

            if (status === "deferred" && !review_at) {
                throw new Error("Choose when the deferred item should return to the Inbox.");
            }

            const patch: ItemPatch = {
                status,
                review_at: status === "deferred" ? validate_timestamp(review_at) : null,
            };

            const report: OperationReport = {
                succeeded: [],
                failed: [],
            };

            const undo_entries: UndoEntry[] = [];
            let undo_bytes = 0;
            let can_undo = true;

            for (const id of new Set(ids)) {
                try {
                    const result = await this.write_item(
                        id,
                        patch,
                    );

                    if (can_undo) {
                        undo_bytes += this.get_undo_bytes([result.undo]);

                        if (undo_bytes > MAX_UNDO_BYTES) {
                            can_undo = false;
                            undo_entries.length = 0;
                            this.clear_undo_history();
                        } else {
                            undo_entries.push(result.undo);
                        }
                    }

                    report.succeeded.push(id);
                } catch (error) {
                    report.failed.push({
                        id,
                        message: create_error_message(error),
                    });
                }
            }

            this.remember_undo(undo_entries);

            return report;
        });
    }

    undo(): Promise<OperationReport> {
        return this.enqueue(async () => {
            const entries = this.undo_batches.pop() ?? [];
            this.undo_bytes -= this.get_undo_bytes(entries);

            const report: OperationReport = {
                succeeded: [],
                failed: [],
            };

            for (const entry of [...entries].reverse()) {
                try {
                    const file = this.require_file(entry.id);

                    await this.app.vault.process(
                        file,
                        (current) => {
                            if (current !== entry.after) {
                                throw new Error("This note changed after the operation. Undo would overwrite another edit.");
                            }

                            return entry.before;
                        },
                    );

                    this.index_content(
                        file,
                        entry.before,
                    );

                    report.succeeded.push(entry.id);
                } catch (error) {
                    report.failed.push({
                        id: entry.id,
                        message: create_error_message(error),
                    });
                }
            }

            this.notify();

            return report;
        });
    }

    trash_items(ids: string[]): Promise<OperationReport> {
        return this.enqueue(async () => {
            const report: OperationReport = {
                succeeded: [],
                failed: [],
            };

            for (const id of new Set(ids)) {
                try {
                    const file = this.require_file(id);
                    const old_path = file.path;
                    const current_document = parse_document(await this.app.vault.read(file));

                    if (current_document.metadata.beautiful_inbox !== true || current_document.metadata.inbox_id !== id) {
                        throw new Error("This note no longer represents the same Inbox item. Reload before moving it to trash.");
                    }

                    await this.app.vault.trash(
                        file,
                        false,
                    );

                    this.remove_path(old_path);
                    report.succeeded.push(id);
                } catch (error) {
                    report.failed.push({
                        id,
                        message: create_error_message(error),
                    });
                }
            }

            this.notify();

            return report;
        });
    }

    async restore_due(): Promise<void> {
        if (!this.get_settings().should_restore_due) {
            return;
        }

        await this.enqueue(async () => {
            const now_ms = Date.now();
            const due_items = this.list_items().filter((item) => item.status === "deferred" && item.review_at && Date.parse(item.review_at) <= now_ms);

            for (const item of due_items) {
                try {
                    await this.write_item(
                        item.id,
                        {
                            status: "unprocessed",
                            review_at: null,
                        },
                    );
                } catch (error) {
                    this.diagnostics.set(
                        item.path,
                        `${item.path}: ${create_error_message(error)}`,
                    );
                }
            }
        });
    }

    ensure_base(): Promise<TFile> {
        return this.enqueue(() => ensure_inbox_base(
            this.app,
            this.get_settings(),
        ));
    }

    import_files(
        files: File[],
        input: CaptureInput = {},
    ): Promise<CaptureResult[]> {
        return this.enqueue(async () => {
            this.validate_files(files);
            const results: CaptureResult[] = [];

            for (const file of files) {
                validate_capture({
                    ...input,
                    title: input.title ?? file.name,
                    kind: "file",
                });

                const duplicate_key = this.get_external_key(input);
                const duplicate_id = duplicate_key ? this.external_items.get(duplicate_key) : undefined;
                const duplicate = duplicate_id ? this.items.get(duplicate_id) : undefined;

                if (duplicate) {
                    results.push({
                        status: "duplicate",
                        item: duplicate,
                    });

                    continue;
                }

                const attachment_path = await this.save_attachment(file);
                const kind = this.get_attachment_kind(attachment_path);

                try {
                    const result = await this.capture_direct({
                        ...input,
                        title: input.title ?? file.name,
                        kind,
                        body: `${input.body ?? ""}${input.body ? "\n\n" : ""}${this.create_attachment_link(attachment_path)}`,
                    });

                    results.push(result);
                } catch (error) {
                    this.diagnostics.set(
                        attachment_path,
                        `An imported file was retained at ${attachment_path}: ${create_error_message(error)}`,
                    );

                    this.notify();
                    throw error;
                }
            }

            return results;
        });
    }

    attach_files(
        id: string,
        files: File[],
    ): Promise<InboxItem> {
        return this.enqueue(async () => {
            this.require_file(id);
            this.validate_files(files);
            const attachment_paths: string[] = [];

            for (const file of files) {
                attachment_paths.push(await this.save_attachment(file));
            }

            try {
                const expected_revision = this.items.get(id)?.revision;

                if (!expected_revision) {
                    throw new Error("The Inbox item changed while its files were imported. Reload before attaching them.");
                }

                const current_body = await this.read_body(id);
                const additions = attachment_paths.map((path) => this.create_attachment_link(path)).join("\n");

                const result = await this.write_item(
                    id,
                    { body: `${current_body}${current_body.endsWith("\n") ? "" : "\n"}${additions}\n` },
                    expected_revision,
                );

                this.remember_undo([result.undo]);

                return result.item;
            } catch (error) {
                for (const path of attachment_paths) {
                    this.diagnostics.set(
                        path,
                        `An imported attachment was retained at ${path}: ${create_error_message(error)}`,
                    );
                }

                this.notify();
                throw error;
            }
        });
    }

    async list_attachments(id: string): Promise<InboxAttachment[]> {
        const file = this.require_file(id);
        const body = await this.read_body(id);

        const references = this.find_attachments(
            body,
            file.path,
        );

        const paths = [...new Set(references.map((reference) => reference.path))];
        const attachments: InboxAttachment[] = [];

        for (const path of paths) {
            const attachment = this.app.vault.getAbstractFileByPath(path);

            if (attachment instanceof TFile && attachment.extension !== "md") {
                attachments.push({
                    path,
                    name: attachment.name,
                    kind: this.get_attachment_kind(path),
                    resource_url: this.app.vault.getResourcePath(attachment),
                    size_bytes: attachment.stat.size,
                });
            }
        }

        return attachments;
    }

    remove_attachment(
        id: string,
        path: string,
        should_trash_file = false,
    ): Promise<InboxItem> {
        return this.enqueue(async () => {
            const note = this.require_file(id);
            const expected_revision = this.items.get(id)?.revision;

            if (!expected_revision) {
                throw new Error("The Inbox item changed. Reload before removing its attachment.");
            }

            const normalized_path = normalize_vault_path(path);
            const body = await this.read_body(id);

            const references = this.find_attachments(
                body,
                note.path,
            ).filter((reference) => reference.path === normalized_path);

            if (!references.length) {
                throw new Error("This attachment is no longer linked from the Inbox item.");
            }

            if (should_trash_file) {
                await this.assert_attachment_unshared(
                    normalized_path,
                    note.path,
                );
            }

            let updated_body = body;

            for (const reference of [...references].sort((
                first,
                second,
            ) => second.start - first.start)) {
                updated_body = updated_body.slice(
                    0,
                    reference.start,
                ) + updated_body.slice(reference.end);
            }

            const result = await this.write_item(
                id,
                { body: updated_body },
                expected_revision,
            );

            if (!should_trash_file) {
                this.remember_undo([result.undo]);
            }

            if (should_trash_file) {
                const attachment = this.app.vault.getAbstractFileByPath(normalized_path);

                if (attachment instanceof TFile) {
                    try {
                        await this.assert_attachment_unshared(
                            normalized_path,
                            note.path,
                        );

                        await this.app.vault.trash(
                            attachment,
                            false,
                        );
                    } catch (error) {
                        this.diagnostics.set(
                            normalized_path,
                            `The link was removed, but the file was retained: ${create_error_message(error)}`,
                        );

                        throw Object.assign(
                            new Error("The attachment link was removed, but the file could not be safely moved to trash."),
                            { cause: error },
                        );
                    }
                }
            }

            return result.item;
        });
    }

    get_diagnostics(): string[] {
        const results = [...this.diagnostics.values()];

        for (const [id, paths] of this.id_paths) {
            if (paths.size > 1) {
                results.push(`Duplicate Inbox ID ${id}: ${[...paths].join(", ")}. Resolve the duplicate before editing.`);
            }
        }

        return results;
    }

    private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
        if (this.is_disposed) {
            return Promise.reject(new Error("The Inbox repository has been disposed."));
        }

        const result = this.mutation_queue.then(() => {
            if (this.is_disposed) {
                throw new Error("The Inbox repository has been disposed.");
            }

            return operation();
        });

        this.mutation_queue = result.catch(() => { });

        return result;
    }

    private async capture_direct(input: CaptureInput): Promise<CaptureResult> {
        const validated = validate_capture(input);
        const source_key = this.get_external_key(validated);
        const duplicate_id = source_key ? this.external_items.get(source_key) : undefined;
        const duplicate = duplicate_id ? this.items.get(duplicate_id) : undefined;

        if (duplicate) {
            return {
                status: "duplicate",
                item: duplicate,
            };
        }

        if (duplicate_id) {
            throw new Error("The external item has conflicting Inbox identities. Resolve them before importing it again.");
        }

        const settings = this.get_settings();

        const folder = normalize_vault_path(
            settings.capture_folder,
            true,
        );

        await ensure_folder(
            this.app,
            folder,
        );

        const id = globalThis.crypto.randomUUID();
        const now = new Date().toISOString();
        const captured_at = validated.captured_at ?? now;
        const body = validated.body ?? "";

        const title = validated.title || create_preview(body).slice(
            0,
            80,
        ) || "Capture";

        const metadata: Record<string, unknown> = {
            beautiful_inbox: true,
            schema_version: 1,
            inbox_id: id,
            title,
            inbox_kind: validated.kind ?? "text",
            inbox_status: "unprocessed",
            captured_at,
            tags: normalize_tags([...settings.default_tags, ...(validated.tags ?? [])]),
            inbox_preview: create_preview(body),
            system_created_at: now,
            system_updated_at: now,
        };

        for (const key of ["source_url", "source_note", "source_id", "external_id"] as const) {
            if (validated[key] !== undefined) {
                metadata[key] = validated[key];
            }
        }

        const template = settings.filename_template || "{date} {title} {id}";

        const filename = sanitize_filename(template.replaceAll(
            "{date}",
            captured_at.slice(
                0,
                10,
            ),
        ).replaceAll(
            "{title}",
            title,
        ).replaceAll(
            "{id}",
            id,
        ));

        const path = this.find_available_path(
            folder ? `${folder}/${filename}` : filename,
            "md",
        );

        const content = serialize_document({
            metadata,
            body,
        });

        const file = await this.app.vault.create(
            path,
            content,
        );

        this.index_content(
            file,
            content,
        );

        const item = this.items.get(id);

        if (!item) {
            throw new Error("The capture was saved, but its properties could not be indexed.");
        }

        this.notify();

        return {
            status: "created",
            item,
        };
    }

    private async write_item(
        id: string,
        patch: ItemPatch,
        expected_revision?: string,
    ): Promise<{ item: InboxItem; undo: UndoEntry; }> {
        const item = this.items.get(id);
        const file = this.require_file(id);

        if (expected_revision !== undefined && item?.revision !== expected_revision) {
            throw new Error("This Inbox item changed. Reload it before saving your edit.");
        }

        if (patch.status !== undefined && !INBOX_STATUSES.includes(patch.status)) {
            throw new Error("Choose a valid Inbox state.");
        }

        const known_content = this.snapshots.get(id);
        const known_fingerprint = this.content_fingerprints.get(id);
        const before = await this.app.vault.read(file);

        if (expected_revision !== undefined && known_content === undefined) {
            if (!known_fingerprint || known_fingerprint.revision !== expected_revision) {
                throw new Error("Reload this note before saving so its content revision can be verified.");
            }

            const expected_hash = await known_fingerprint.hash;
            const current_hash = await this.hash_content(before);

            if (!expected_hash || expected_hash !== current_hash) {
                throw new Error("This note changed outside the editor. Reload it before saving.");
            }
        }

        if (expected_revision !== undefined && known_content !== undefined && known_content !== before) {
            throw new Error("This note changed outside the editor. Reload it before saving.");
        }

        let after = "";

        await this.app.vault.process(
            file,
            (current) => {
                if (current !== before) {
                    throw new Error("This note changed while it was being saved. Your edit was not applied.");
                }

                const document = parse_document(current);

                if (document.metadata.inbox_id !== id || document.metadata.beautiful_inbox !== true) {
                    throw new Error("This note no longer represents the same Inbox item.");
                }

                if (patch.title !== undefined) {
                    const title = validate_text(
                        patch.title,
                        "Capture title",
                        256,
                    ).trim();

                    if (!title) {
                        throw new Error("The capture title cannot be empty.");
                    }

                    document.metadata.title = title;
                }

                if (patch.body !== undefined) {
                    document.body = validate_text(
                        patch.body,
                        "Capture content",
                        2_000_000,
                    );

                    document.metadata.inbox_preview = create_preview(document.body);
                }

                if (patch.status !== undefined) {
                    document.metadata.inbox_status = patch.status;
                }

                if (patch.review_at === null || (patch.status !== undefined && patch.status !== "deferred")) {
                    delete document.metadata.review_at;
                } else if (patch.review_at !== undefined) {
                    document.metadata.review_at = validate_timestamp(patch.review_at);
                }

                if (document.metadata.inbox_status === "deferred" && !document.metadata.review_at) {
                    throw new Error("Deferred captures need a return date.");
                }

                if (patch.tags !== undefined) {
                    document.metadata.tags = normalize_tags(patch.tags);
                }

                document.metadata.system_updated_at = new Date().toISOString();
                after = serialize_document(document);

                return after;
            },
        );

        this.index_content(
            file,
            after,
        );

        this.notify();

        const updated = this.items.get(id);

        if (!updated) {
            throw new Error("The saved note could not be indexed as an Inbox item.");
        }

        return {
            item: updated,
            undo: {
                id,
                before,
                after,
            },
        };
    }

    private index_file(
        file: TFile,
        cache: CachedMetadata | null,
        content?: string,
    ): void {
        const was_inbox_item = this.entries.has(file.path);
        this.remove_path(file.path);
        const metadata: unknown = cache?.frontmatter;

        if (!metadata || typeof metadata !== "object") {
            if (was_inbox_item && content?.includes("beautiful_inbox")) {
                this.diagnostics.set(
                    file.path,
                    `${file.path}: Inbox properties could not be read. Repair the note properties; its content was retained.`,
                );
            }

            return;
        }

        try {
            const item = parse_item(
                file,
                metadata as Record<string, unknown>,
            );

            if (!item) {
                return;
            }

            item.revision = `${item.revision}:${++this.revision_sequence}`;

            this.entries.set(
                file.path,
                item,
            );

            const paths = this.id_paths.get(item.id) ?? new Set<string>();
            paths.add(item.path);

            this.id_paths.set(
                item.id,
                paths,
            );

            this.refresh_identity(item.id);

            if (content !== undefined) {
                this.cache_snapshot(
                    item.id,
                    content,
                );

                this.cache_fingerprint(
                    item,
                    content,
                );
            }

            const external_key = this.get_external_key(item);

            if (external_key) {
                this.external_items.set(
                    external_key,
                    item.id,
                );
            }
        } catch (error) {
            this.diagnostics.set(
                file.path,
                `${file.path}: ${create_error_message(error)}`,
            );
        }
    }

    private index_content(
        file: TFile,
        content: string,
    ): void {
        try {
            const document = parse_document(content);

            this.index_file(
                file,
                { frontmatter: document.metadata } as CachedMetadata,
                content,
            );
        } catch (error) {
            this.remove_path(file.path);

            this.diagnostics.set(
                file.path,
                `${file.path}: ${create_error_message(error)}`,
            );
        }
    }

    private remove_path(path: string): void {
        const previous = this.entries.get(path);
        this.entries.delete(path);
        this.diagnostics.delete(path);

        if (!previous) {
            return;
        }

        this.id_paths.get(previous.id)?.delete(path);
        this.refresh_identity(previous.id);
        const external_key = this.get_external_key(previous);

        if (external_key && this.external_items.get(external_key) === previous.id) {
            this.external_items.delete(external_key);
        }
    }

    private refresh_identity(id: string): void {
        const paths = this.id_paths.get(id);

        if (!paths?.size) {
            this.id_paths.delete(id);
            this.items.delete(id);
            this.remove_snapshot(id);
            this.content_fingerprints.delete(id);
        } else if (paths.size === 1) {
            const path = [...paths][0];
            const item = path ? this.entries.get(path) : undefined;

            if (item) {
                this.items.set(
                    id,
                    item,
                );
            }
        } else {
            this.items.delete(id);
        }
    }

    private require_file(id: string): TFile {
        const item = this.items.get(id);
        const file = item ? this.app.vault.getAbstractFileByPath(item.path) : undefined;

        if (!(file instanceof TFile)) {
            throw new Error("This Inbox item no longer exists or has conflicting properties.");
        }

        return file;
    }

    private get_external_key(input: CaptureInput): string | undefined {
        if (!input.source_id || !input.external_id) {
            return undefined;
        }

        return JSON.stringify([input.source_id, input.external_id]);
    }

    private remember_undo(entries: UndoEntry[]): void {
        if (!entries.length) {
            return;
        }

        const bytes = this.get_undo_bytes(entries);

        if (bytes > MAX_UNDO_BYTES) {
            this.clear_undo_history();

            return;
        }

        this.undo_batches.push(entries);
        this.undo_bytes += bytes;

        while (this.undo_batches.length > MAX_UNDO_BATCHES || this.undo_bytes > MAX_UNDO_BYTES) {
            this.undo_bytes -= this.get_undo_bytes(this.undo_batches.shift() ?? []);
        }
    }

    private clear_undo_history(): void {
        this.undo_batches.length = 0;
        this.undo_bytes = 0;
        this.diagnostics.set(
            "undo",
            "The last operation was saved, but exceeds the 8 MB undo budget. Recover earlier contents through Obsidian file recovery if needed.",
        );
    }

    private get_undo_bytes(entries: UndoEntry[]): number {
        return entries.reduce(
            (
                total,
                entry,
            ) => total + (entry.before.length + entry.after.length) * 2,
            0,
        );
    }

    private remove_snapshot(id: string): void {
        const existing = this.snapshots.get(id);

        if (existing !== undefined) {
            this.snapshot_bytes -= existing.length * 2;
            this.snapshots.delete(id);
        }
    }

    private cache_snapshot(
        id: string,
        content: string,
    ): void {
        this.remove_snapshot(id);
        const bytes = content.length * 2;

        if (bytes > MAX_SNAPSHOT_BYTES) {
            return;
        }

        this.snapshots.set(
            id,
            content,
        );
        this.snapshot_bytes += bytes;

        while (this.snapshots.size > MAX_SNAPSHOT_ENTRIES || this.snapshot_bytes > MAX_SNAPSHOT_BYTES) {
            const oldest_id = this.snapshots.keys().next().value;

            if (oldest_id === undefined) {
                break;
            }

            this.remove_snapshot(oldest_id);
        }
    }

    private cache_fingerprint(
        item: InboxItem,
        content: string,
    ): void {
        const hash = this.hash_content(content).catch((error: unknown) => {
            this.diagnostics.set(
                item.path,
                `${item.path}: Content verification is unavailable: ${create_error_message(error)}`,
            );

            return undefined;
        });
        this.content_fingerprints.set(
            item.id,
            {
                revision: item.revision,
                hash,
            },
        );
    }

    private async hash_content(content: string): Promise<string> {
        const digest = await globalThis.crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(content),
        );

        return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(
            2,
            "0",
        )).join("");
    }

    private find_available_path(
        stem: string,
        extension: string,
    ): string {
        let candidate = `${stem}.${extension}`;
        let suffix = 2;

        while (this.app.vault.getAbstractFileByPath(candidate)) {
            candidate = `${stem} ${suffix++}.${extension}`;
        }

        return candidate;
    }

    private validate_files(files: File[]): void {
        const settings = this.get_settings();

        if (!files.length || files.length > settings.import_limit) {
            throw new Error(`Choose between 1 and ${settings.import_limit} files.`);
        }

        for (const file of files) {
            if (file.size > settings.attachment_limit_mb * 1024 * 1024) {
                throw new Error(`${file.name} exceeds the ${settings.attachment_limit_mb} MB attachment limit.`);
            }
        }
    }

    private async save_attachment(file: File): Promise<string> {
        const folder = normalize_vault_path(
            this.get_settings().attachment_folder,
            true,
        );

        await ensure_folder(
            this.app,
            folder,
        );

        const safe_name = sanitize_filename(file.name);
        const dot_index = safe_name.lastIndexOf(".");
        const extension = dot_index > 0 ? safe_name.slice(dot_index + 1) : "bin";

        const stem = dot_index > 0 ? safe_name.slice(
            0,
            dot_index,
        ) : safe_name;

        const path = this.find_available_path(
            folder ? `${folder}/${stem}` : stem,
            extension,
        );

        const binary = await file.arrayBuffer();

        await this.app.vault.createBinary(
            path,
            binary,
        );

        return path;
    }

    private get_attachment_kind(path: string): "image" | "audio" | "file" {
        const extension = path.split(".").pop()?.toLowerCase() ?? "";

        if (IMAGE_EXTENSIONS.has(extension)) {
            return "image";
        }

        if (AUDIO_EXTENSIONS.has(extension)) {
            return "audio";
        }

        return "file";
    }

    private create_attachment_link(path: string): string {
        const encoded_path = path.split("/").map((segment) => encodeURIComponent(segment).replace(
            /\(/g,
            "%28",
        ).replace(
            /\)/g,
            "%29",
        )).join("/");

        return `![](<${encoded_path}>)`;
    }

    private find_attachments(
        body: string,
        source_path: string,
    ): AttachmentReference[] {
        const references: AttachmentReference[] = [];
        const expressions = [/!?\[\[([^\]]+)\]\]/g, /!?\[[^\]]*\]\(([^)]+)\)/g];

        for (const expression of expressions) {
            for (const match of body.matchAll(expression)) {
                const original = match[1] ?? "";
                const raw_path = original.split("|")[0]?.split("#")[0] ?? "";

                if (!raw_path || /^[a-z][a-z\d+.-]*:/i.test(raw_path)) {
                    continue;
                }

                let decoded: string;

                try {
                    decoded = decodeURIComponent(raw_path.replace(
                        /^<|>$/g,
                        "",
                    ));
                } catch {
                    continue;
                }

                const destination = this.app.metadataCache.getFirstLinkpathDest(
                    decoded,
                    source_path,
                ) ?? this.app.vault.getAbstractFileByPath(decoded);

                if (destination instanceof TFile && destination.extension !== "md") {
                    references.push({
                        path: destination.path,
                        start: match.index ?? 0,
                        end: (match.index ?? 0) + match[0].length,
                    });
                }
            }
        }

        return references;
    }

    private async assert_attachment_unshared(
        attachment_path: string,
        owner_path: string,
    ): Promise<void> {
        const unresolved = this.app.metadataCache.unresolvedLinks;

        for (const note of this.app.vault.getMarkdownFiles()) {
            if (note.path === owner_path) {
                continue;
            }

            if ((this.app.metadataCache.resolvedLinks[note.path]?.[attachment_path] ?? 0) > 0) {
                throw new Error("Another note references this attachment. Remove the link without trashing the shared file.");
            }

            const pending_links = unresolved[note.path];

            if (pending_links && Object.keys(pending_links).some((path) => path === attachment_path)) {
                throw new Error("Another note has a pending reference to this attachment.");
            }

            const content = await this.app.vault.read(note);

            if (this.find_attachments(
                content,
                note.path,
            ).some((reference) => reference.path === attachment_path)) {
                throw new Error("Another note references this attachment. The shared file was retained.");
            }
        }
    }

    private notify(): void {
        if (this.is_notification_pending || this.is_disposed) {
            return;
        }

        this.is_notification_pending = true;

        queueMicrotask(() => {
            this.is_notification_pending = false;

            if (!this.is_disposed) {
                for (const listener of this.listeners) {
                    listener();
                }
            }
        });
    }
}
