import { MarkdownRenderer } from "obsidian";

import {
    create_button,
    create_dropdown,
    create_feedback,
    create_text_area,
    create_text_input,
    create_toolbar,
} from "@beautiful/design";
import type { DesignSurface } from "@beautiful/design";

import type { InboxAttachment, InboxHost, InboxItem, InboxStatus } from "../contracts";

import { parse_tags } from "./composer";

interface ItemDraft {
    title: string;
    body: string;
    tags: string;
    status: InboxStatus;
    revision: string;
}

function has_matching_fields(
    left: Partial<ItemDraft>,
    right: ItemDraft,
): boolean {
    return left.title === right.title && left.body === right.body && left.tags === right.tags && left.status === right.status;
}

export class InboxInspector {
    private readonly parent: DesignSurface;
    private readonly host: InboxHost;
    private readonly on_step: (direction: number) => void;
    private surface: DesignSurface | undefined;
    private current_id: string | undefined;
    private revision = "";
    private draft: ItemDraft | undefined;
    private generation = 0;
    private is_dirty = false;
    private feedback: DesignSurface | undefined;

    constructor(
        parent: DesignSurface,
        host: InboxHost,
        on_step: (direction: number) => void,
    ) {
        this.parent = parent;
        this.host = host;
        this.on_step = on_step;
    }

    get_item_id(): string | undefined {
        return this.current_id;
    }

    refresh(): void {
        if (!this.current_id) return;

        const item = this.host.repository.get_item(this.current_id);

        if (!item) {
            this.close();
        } else if (item.revision !== this.revision) {
            if (this.is_dirty) this.set_message(
                "This note changed elsewhere. Your draft is preserved. Saving will check for a conflict.",
                true,
            );
            else void this.open_item(item);
        }
    }

    close(): void {
        this.generation += 1;
        this.surface?.dispose();
        this.surface = undefined;
        this.current_id = undefined;
        this.parent.element.classList.remove("is_open");
    }

    async open_item(item: InboxItem): Promise<void> {
        if (this.current_id === item.id && this.revision === item.revision) return;

        this.generation += 1;
        const generation = this.generation;
        this.current_id = item.id;
        this.revision = item.revision;
        this.surface?.dispose();
        this.surface = this.parent.create_region("beautiful_inbox_inspector_content");
        this.parent.element.classList.add("is_open");
        const surface = this.surface;

        const toolbar = create_toolbar(
            surface,
            "Item processing",
        );

        create_button(
            toolbar.filters,
            {
                label: "Previous",
                on_click: () => this.on_step(-1),
            },
        );

        create_button(
            toolbar.filters,
            {
                label: "Next",
                on_click: () => this.on_step(1),
            },
        );

        create_button(
            toolbar.actions,
            {
                label: "Open note",
                on_click: () => { void this.host.open_note(item.id); },
            },
        );

        create_button(
            toolbar.actions,
            {
                label: "Close details",
                on_click: () => this.close(),
            },
        );

        const loading = create_feedback(
            surface,
            {
                state: "loading",
                message: "Loading details…",
            },
        );

        try {
            const body = await this.host.repository.read_body(item.id);

            if (generation !== this.generation) return;

            loading.dispose();
            const saved: unknown = this.host.app.loadLocalStorage(this.get_draft_key(item.id));
            const candidate = saved && typeof saved === "object" ? saved as Partial<ItemDraft> : undefined;
            const saved_status = candidate?.status;
            const has_saved = typeof candidate?.body === "string" && typeof candidate.title === "string" && typeof candidate.tags === "string" && ["unprocessed", "deferred", "processed", "archived"].includes(saved_status ?? "");

            this.draft = has_saved ? candidate as ItemDraft : {
                title: item.title,
                body,
                tags: item.tags.join(" "),
                status: item.status,
                revision: item.revision,
            };

            this.is_dirty = has_saved;

            this.render_fields(
                surface,
                item,
            );

            this.feedback = create_feedback(
                surface,
                {
                    state: "info",
                    message: has_saved ? "Recovered your unsaved local draft." : "Edits are saved only when you choose Save changes.",
                },
            );

            const attachments = await this.host.repository.list_attachments(item.id);

            if (generation !== this.generation) return;

            this.render_attachments(
                surface,
                item,
                attachments,
            );
        } catch (error) {
            if (generation !== this.generation) return;

            loading.dispose();

            create_feedback(
                surface,
                {
                    state: "error",
                    message: error instanceof Error ? error.message : "The item could not be loaded.",
                },
            );
        }
    }

    private render_fields(
        surface: DesignSurface,
        item: InboxItem,
    ): void {
        const draft = this.draft;

        if (!draft) return;

        const fields = surface.create_region("beautiful_inbox_item_fields");

        create_text_input(
            fields,
            {
                label: "Item title",
                value: draft.title,
                on_change: (value) => {
                    draft.title = value;
                    this.save_draft();
                },
            },
        );

        create_text_input(
            fields,
            {
                label: "Item tags",
                value: draft.tags,
                on_change: (value) => {
                    draft.tags = value;
                    this.save_draft();
                },
            },
        );

        create_dropdown(
            fields,
            {
                label: "Item status",
                value: draft.status,
                options: {
                    unprocessed: "Unprocessed",
                    deferred: "Deferred",
                    processed: "Processed",
                    archived: "Archived",
                },
                on_change: (value) => {
                    draft.status = value as InboxStatus;
                    this.save_draft();
                },
            },
        );

        const details = create_text_area(
            fields,
            {
                label: "Item details",
                value: draft.body,
                rows: 9,
                on_change: (value) => {
                    draft.body = value;
                    this.save_draft();
                },
            },
        );

        const actions = create_toolbar(
            surface,
            "Detail actions",
        );

        const save_button = create_button(
            actions.actions,
            {
                label: "Save changes",
                is_primary: true,
                on_click: () => {
                    save_button.setDisabled(true);
                    void this.save_item(item).finally(() => save_button.setDisabled(false));
                },
            },
        );

        create_button(
            actions.filters,
            {
                label: "Preview Markdown",
                on_click: () => {
                    const preview = surface.create_region("beautiful_inbox_markdown_preview");
                    details.inputEl.hidden = true;

                    create_button(
                        preview,
                        {
                            label: "Back to editing",
                            on_click: () => {
                                preview.dispose();
                                details.inputEl.hidden = false;
                                details.inputEl.focus();
                            },
                        },
                    );

                    const content = preview.create_region("beautiful_inbox_preview_content");

                    void MarkdownRenderer.render(
                        this.host.app,
                        draft.body,
                        content.element,
                        item.path,
                        content,
                    ).catch((error: unknown) => this.set_message(
                        error instanceof Error ? error.message : "Preview unavailable.",
                        true,
                    ));
                },
            },
        );

        create_button(
            actions.filters,
            {
                label: "Reload saved note",
                on_click: () => {
                    if (this.is_dirty && this.draft) this.host.app.saveLocalStorage(
                        `${this.get_draft_key(item.id)}_previous`,
                        this.draft,
                    );

                    this.host.app.saveLocalStorage(
                        this.get_draft_key(item.id),
                        null,
                    );

                    this.is_dirty = false;
                    this.revision = "";
                    void this.open_item(this.host.repository.get_item(item.id) ?? item);
                },
            },
        );

        const previous_draft: unknown = this.host.app.loadLocalStorage(`${this.get_draft_key(item.id)}_previous`);

        if (previous_draft && typeof previous_draft === "object") {
            create_button(
                actions.filters,
                {
                    label: "Recover previous draft",
                    on_click: () => {
                        this.host.app.saveLocalStorage(
                            this.get_draft_key(item.id),
                            previous_draft,
                        );

                        this.revision = "";
                        void this.open_item(this.host.repository.get_item(item.id) ?? item);
                    },
                },
            );
        }

        const metadata = surface.element.ownerDocument.createElement("p");
        metadata.className = "beautiful_secondary_text";
        metadata.textContent = `${item.kind} · Captured ${new Date(item.captured_at).toLocaleString()}${item.review_at ? ` · Review ${new Date(item.review_at).toLocaleString()}` : ""}`;
        surface.element.append(metadata);

        if (item.source_url) {
            try {
                const url = new URL(item.source_url);

                if (["http:", "https:", "mailto:"].includes(url.protocol)) {
                    const link = surface.element.ownerDocument.createElement("a");
                    link.href = url.href;
                    link.textContent = "Open source";
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    surface.element.append(link);
                }
            } catch {
                this.host.notify("The saved source URL is invalid.");
            }
        }

        if (item.source_note) create_button(
            surface,
            {
                label: "Open source note",
                on_click: () => {
                    void this.host.app.workspace.openLinkText(
                        item.source_note ?? "",
                        item.path,
                        true,
                    );
                },
            },
        );

        if (item.kind === "email") create_button(
            surface,
            {
                label: "Import email attachments",
                on_click: () => {
                    void this.host.email.import_attachments(item.id).then(() => {
                        this.revision = "";

                        return this.open_item(this.host.repository.get_item(item.id) ?? item);
                    }).catch((error: unknown) => this.set_message(
                        error instanceof Error ? error.message : "Email attachments could not be imported.",
                        true,
                    ));
                },
            },
        );
    }

    private render_attachments(
        surface: DesignSurface,
        item: InboxItem,
        attachments: InboxAttachment[],
    ): void {
        const region = surface.create_region("beautiful_inbox_attachments");
        const heading = region.element.ownerDocument.createElement("h3");
        heading.textContent = `Attachments (${attachments.length})`;
        region.element.append(heading);
        const input = region.element.ownerDocument.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.hidden = true;
        region.element.append(input);

        create_button(
            region,
            {
                label: "Attach files",
                on_click: () => input.click(),
            },
        );

        region.registerDomEvent(
            input,
            "change",
            () => {
                const files = Array.from(input.files ?? []);
                input.value = "";

                if (!files.length) return;

                void this.host.repository.attach_files(
                    item.id,
                    files,
                ).then(() => {
                    this.revision = "";

                    return this.open_item(this.host.repository.get_item(item.id) ?? item);
                }).catch((error: unknown) => this.set_message(
                    error instanceof Error ? error.message : "Files could not be attached.",
                    true,
                ));
            },
        );

        for (const attachment of attachments) {
            const row = region.create_region("beautiful_inbox_attachment");

            create_button(
                row,
                {
                    label: attachment.name,
                    on_click: () => {
                        void this.host.app.workspace.openLinkText(
                            attachment.path,
                            item.path,
                            true,
                        );
                    },
                },
            );

            if (attachment.kind === "image") {
                const image = row.element.ownerDocument.createElement("img");
                image.src = attachment.resource_url;
                image.alt = attachment.name;
                image.loading = "lazy";
                row.element.append(image);
            } else if (attachment.kind === "audio") {
                const audio = row.element.ownerDocument.createElement("audio");
                audio.controls = true;
                audio.preload = "metadata";
                audio.src = attachment.resource_url;

                audio.setAttribute(
                    "aria-label",
                    attachment.name,
                );

                row.element.append(audio);

                row.register(() => {
                    audio.pause();
                    audio.removeAttribute("src");
                    audio.load();
                });
            }

            create_button(
                row,
                {
                    label: "Remove embed",
                    on_click: () => {
                        void this.host.repository.remove_attachment(
                            item.id,
                            attachment.path,
                            false,
                        ).then(() => {
                            this.revision = "";

                            return this.open_item(this.host.repository.get_item(item.id) ?? item);
                        }).catch((error: unknown) => this.set_message(
                            error instanceof Error ? error.message : "Attachment reference could not be removed.",
                            true,
                        ));
                    },
                },
            );
        }
    }

    private get_draft_key(id: string): string {
        return `beautiful_inbox_item_draft_${id}`;
    }

    private save_draft(): void {
        if (!this.current_id || !this.draft) return;

        this.is_dirty = true;

        try {
            this.host.app.saveLocalStorage(
                this.get_draft_key(this.current_id),
                this.draft,
            );
        } catch {
            this.set_message(
                "The local draft could not be saved. Save changes to preserve your edits in the vault.",
                true,
            );
        }
    }

    private async save_item(item: InboxItem): Promise<void> {
        const draft = this.draft;

        if (!draft) return;

        const submitted = { ...draft };
        const generation = this.generation;

        try {
            const result = await this.host.repository.update_item(
                item.id,
                {
                    title: submitted.title,
                    body: submitted.body,
                    tags: parse_tags(submitted.tags),
                    status: submitted.status,
                },
                submitted.revision,
            );
            const has_newer_edits = !has_matching_fields(
                draft,
                submitted,
            );
            const saved: unknown = this.host.app.loadLocalStorage(this.get_draft_key(item.id));
            const stored = saved && typeof saved === "object" ? saved as Partial<ItemDraft> : undefined;
            const owns_stored_draft = !stored || (stored.revision === submitted.revision && has_matching_fields(
                stored,
                draft,
            ));
            draft.revision = result.revision;

            if (has_newer_edits) {
                if (owns_stored_draft) this.host.app.saveLocalStorage(
                    this.get_draft_key(item.id),
                    draft,
                );
            } else if (owns_stored_draft) {
                this.host.app.saveLocalStorage(
                    this.get_draft_key(item.id),
                    null,
                );
            }

            if (generation !== this.generation || this.draft !== draft) return;

            this.is_dirty = has_newer_edits;
            this.revision = result.revision;
            this.set_message(has_newer_edits ? "Submitted changes saved. Your newer edits remain in the local draft." : "Changes saved.");
        } catch (error) {
            if (generation !== this.generation) return;

            this.set_message(
                error instanceof Error ? error.message : "The item could not be saved. Your draft is preserved.",
                true,
            );
        }
    }

    private set_message(
        message: string,
        is_error = false,
    ): void {
        if (!this.feedback) return;

        this.feedback.element.textContent = message;
        this.feedback.element.dataset.state = is_error ? "error" : "info";

        this.feedback.element.setAttribute(
            "role",
            is_error ? "alert" : "status",
        );
    }
}
