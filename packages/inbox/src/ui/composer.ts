import { MarkdownRenderer } from "obsidian";

import {
    create_button,
    create_dropdown,
    create_feedback,
    create_surface,
    create_text_area,
    create_text_input,
    create_toolbar,
} from "@beautiful/design";
import type { DesignSurface } from "@beautiful/design";

import type { CaptureInput, CaptureKind, InboxHost } from "../contracts";

interface QueuedFile {
    id: number;
    file: File;
}

interface CaptureDraft {
    title: string;
    body: string;
    tags: string;
    source_url: string;
    kind: CaptureKind;
}

function has_matching_capture_fields(
    candidate: unknown,
    draft: CaptureDraft,
): boolean {
    if (!candidate || typeof candidate !== "object") return false;

    const saved = candidate as Partial<CaptureDraft>;

    return saved.title === draft.title && saved.body === draft.body && saved.tags === draft.tags && saved.source_url === draft.source_url && saved.kind === draft.kind;
}

export interface ComposerOptions {
    draft_key: string;
    input?: CaptureInput;
    on_captured?: () => void;
}

export function parse_tags(value: string): string[] {
    return [...new Set(value.split(/[\s,]+/).map((tag) => tag.replace(
        /^#+/,
        "",
    ).trim()).filter(Boolean))];
}

export class CaptureComposer {
    private readonly host: InboxHost;
    private readonly surface: DesignSurface;
    private readonly options: ComposerOptions;
    private readonly draft: CaptureDraft;
    private readonly files: QueuedFile[] = [];
    private next_file_id = 0;
    private edit_version = 0;
    private readonly title_input;
    private readonly body_input;
    private readonly tags_input;
    private readonly source_input;
    private readonly kind_input;
    private readonly capture_button;
    private readonly audio_button;
    private readonly file_list: HTMLElement;
    private readonly feedback: DesignSurface;
    private preview: DesignSurface | undefined;
    private is_busy = false;
    private is_alive = true;
    private captured_id: string | undefined;

    constructor(
        parent: DesignSurface,
        host: InboxHost,
        options: ComposerOptions,
    ) {
        this.host = host;
        this.options = options;
        this.surface = parent.create_region("beautiful_inbox_composer");
        this.draft = this.load_draft(options.input);
        const fields = this.surface.create_region("beautiful_inbox_capture_fields");

        this.title_input = create_text_input(
            fields,
            {
                label: "Capture title",
                placeholder: "What has your attention?",
                value: this.draft.title,
                on_change: (value) => this.change_draft(
                    "title",
                    value,
                ),
            },
        );

        this.body_input = create_text_area(
            fields,
            {
                label: "Capture details",
                placeholder: "Capture a thought, paste a link, or drop files here. Markdown is supported.",
                value: this.draft.body,
                rows: 3,
                on_change: (value) => this.change_draft(
                    "body",
                    value,
                ),
            },
        );

        const options_details = this.surface.element.ownerDocument.createElement("details");
        options_details.className = "beautiful_inbox_capture_options";
        const options_summary = options_details.ownerDocument.createElement("summary");
        options_summary.textContent = "Details and actions";
        options_details.append(options_summary);
        this.surface.element.append(options_details);
        const options_surface = create_surface(this.surface, options_details);
        const metadata = options_surface.create_region("beautiful_inbox_capture_metadata");

        this.tags_input = create_text_input(
            metadata,
            {
                label: "Capture tags",
                placeholder: "Tags, separated by spaces",
                value: this.draft.tags,
                on_change: (value) => this.change_draft(
                    "tags",
                    value,
                ),
            },
        );

        this.source_input = create_text_input(
            metadata,
            {
                label: "Source URL",
                placeholder: "Source URL (optional)",
                value: this.draft.source_url,
                on_change: (value) => this.change_draft(
                    "source_url",
                    value,
                ),
            },
        );

        this.kind_input = create_dropdown(
            metadata,
            {
                label: "Capture type",
                value: this.draft.kind,
                options: {
                    text: "Text",
                    link: "Link",
                    note: "Note",
                    file: "File",
                    image: "Image",
                    audio: "Audio",
                    email: "Email",
                },
                on_change: (value) => {
                    this.draft.kind = value as CaptureKind;
                    this.edit_version += 1;
                    this.captured_id = undefined;
                    this.save_draft();
                },
            },
        );

        const toolbar = create_toolbar(
            this.surface,
            "Capture actions",
        );

        this.surface.element.insertBefore(toolbar.surface.element, options_details);
        const extra_toolbar = create_toolbar(options_surface, "Additional capture actions");
        const help = options_surface.element.ownerDocument.createElement("p");
        help.className = "beautiful_secondary_text";
        help.textContent = "Text drafts are saved locally. Capture pending files before closing this window. Ctrl/Cmd+Enter captures the draft.";
        options_surface.element.append(help);
        this.capture_button = create_button(
            toolbar.actions,
            {
                label: "Capture",
                is_primary: true,
                on_click: () => { void this.capture(); },
            },
        );

        const file_input = this.surface.element.ownerDocument.createElement("input");
        file_input.type = "file";
        file_input.multiple = true;
        file_input.hidden = true;
        this.surface.element.append(file_input);

        this.surface.registerDomEvent(
            file_input,
            "change",
            () => {
                this.add_files(Array.from(file_input.files ?? []));
                file_input.value = "";
            },
        );

        create_button(
            extra_toolbar.actions,
            {
                label: "Attach files",
                on_click: () => file_input.click(),
            },
        );

        create_button(
            extra_toolbar.filters,
            {
                label: "Preview",
                on_click: () => { void this.toggle_preview(); },
            },
        );

        create_button(
            extra_toolbar.filters,
            {
                label: "Clear draft",
                on_click: () => this.clear_draft(),
            },
        );

        this.audio_button = create_button(
            extra_toolbar.actions,
            {
                label: "Record audio",
                on_click: () => { void this.toggle_recording(); },
            },
        );

        this.file_list = this.surface.element.ownerDocument.createElement("div");
        this.file_list.className = "beautiful_inbox_attachment_queue";
        this.file_list.hidden = true;
        this.surface.element.append(this.file_list);

        this.feedback = create_feedback(
            this.surface,
            {
                state: "info",
                message: "Draft saved locally.",
            },
        );

        this.feedback.element.hidden = true;
        this.capture_button.buttonEl.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
        this.surface.register(host.audio.subscribe(() => this.update_audio()));
        this.surface.register(() => { this.is_alive = false; });

        this.surface.registerDomEvent(
            this.surface.element,
            "keydown",
            (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    void this.capture();
                }
            },
        );

        this.surface.registerDomEvent(
            this.surface.element,
            "dragover",
            (event) => {
                if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
            },
        );

        this.surface.registerDomEvent(
            this.surface.element,
            "drop",
            (event) => {
                const files = Array.from(event.dataTransfer?.files ?? []);

                if (files.length) {
                    event.preventDefault();
                    this.add_files(files);
                }
            },
        );

        this.surface.registerDomEvent(
            this.surface.element,
            "paste",
            (event) => {
                const files = Array.from(event.clipboardData?.files ?? []);

                if (files.length) {
                    event.preventDefault();
                    this.add_files(files);
                }
            },
        );

        this.update_audio();
    }

    focus(): void {
        this.title_input.inputEl.focus();
    }

    private load_draft(input?: CaptureInput): CaptureDraft {
        const saved: unknown = this.host.app.loadLocalStorage(this.options.draft_key);
        const previous = saved && typeof saved === "object" ? saved as Partial<CaptureDraft> : {};
        const kinds: CaptureKind[] = ["text", "link", "note", "file", "image", "audio", "email"];

        return {
            title: input?.title ?? (typeof previous.title === "string" ? previous.title : ""),
            body: input?.body ?? (typeof previous.body === "string" ? previous.body : ""),
            tags: input?.tags?.join(" ") ?? (typeof previous.tags === "string" ? previous.tags : this.host.get_settings().default_tags.join(" ")),
            source_url: input?.source_url ?? (typeof previous.source_url === "string" ? previous.source_url : ""),
            kind: input?.kind ?? (previous.kind && kinds.includes(previous.kind) ? previous.kind : "text"),
        };
    }

    private change_draft(
        key: "title" | "body" | "tags" | "source_url",
        value: string,
    ): void {
        this.draft[key] = value;
        this.edit_version += 1;
        this.captured_id = undefined;
        this.save_draft();
    }

    private save_draft(): void {
        try {
            this.host.app.saveLocalStorage(
                this.options.draft_key,
                this.draft,
            );
        } catch {
            this.host.notify("The draft could not be saved locally. Keep this capture window open until it is saved to the vault.");
        }
    }

    private add_files(files: File[]): void {
        this.files.push(...files.map((file) => ({
            id: ++this.next_file_id,
            file,
        })));
        this.edit_version += 1;
        this.render_files();
    }

    private render_files(): void {
        this.file_list.replaceChildren();
        this.file_list.hidden = this.files.length === 0;

        this.files.forEach((
            queued,
            index,
        ) => {
            const file = queued.file;
            const row = this.file_list.ownerDocument.createElement("div");
            const label = row.ownerDocument.createElement("span");
            label.textContent = `${file.name} (${Math.ceil(file.size / 1024)} KB)`;
            const remove = row.ownerDocument.createElement("button");
            remove.type = "button";
            remove.textContent = "Remove";

            remove.setAttribute(
                "aria-label",
                `Remove pending attachment ${file.name}`,
            );

            remove.onclick = () => {
                this.files.splice(
                    index,
                    1,
                );

                this.edit_version += 1;
                this.render_files();
            };

            row.append(
                label,
                remove,
            );

            this.file_list.append(row);
        });
    }

    private async capture(): Promise<void> {
        if (this.is_busy) return;

        if (!this.draft.title.trim() && !this.draft.body.trim() && !this.files.length) {
            this.set_message(
                "Capture a thought or attach a file first.",
                true,
            );

            return;
        }

        const submitted_draft = { ...this.draft };
        const submitted_files = [...this.files];
        const submitted_version = this.edit_version;
        const retry_id = this.captured_id;
        const input_context: CaptureInput = {};

        for (const key of ["source_note", "source_id", "external_id", "captured_at"] as const) {
            const value = this.options.input?.[key];

            if (value !== undefined) input_context[key] = value;
        }

        this.is_busy = true;
        this.capture_button.setDisabled(true);
        this.surface.element.setAttribute(
            "aria-busy",
            "true",
        );

        try {
            await this.host.when_ready?.();
            const source_url = submitted_draft.source_url.trim();
            const first_file = submitted_files[0]?.file;
            const title = submitted_draft.title.trim() || first_file?.name;
            const kind = submitted_draft.kind === "text" && !submitted_draft.body.trim() && first_file
                ? first_file.type.startsWith("image/") ? "image" : first_file.type.startsWith("audio/") ? "audio" : "file"
                : submitted_draft.kind;
            const result = retry_id ? undefined : await this.host.repository.capture({
                ...input_context,
                ...(title ? { title } : {}),
                body: submitted_draft.body,
                tags: parse_tags(submitted_draft.tags),
                kind,
                ...(source_url ? { source_url } : {}),
            });
            const id = retry_id ?? result?.item.id;

            if (!id) throw new Error("The capture did not return an item.");

            this.captured_id = this.edit_version === submitted_version ? id : undefined;

            if (submitted_files.length) {
                await this.host.repository.attach_files(
                    id,
                    submitted_files.map((queued) => queued.file),
                );
                const saved_ids = new Set(submitted_files.map((queued) => queued.id));
                const remaining = this.files.filter((queued) => !saved_ids.has(queued.id));
                this.files.splice(
                    0,
                    this.files.length,
                    ...remaining,
                );
                this.render_files();
            }

            const saved: unknown = this.host.app.loadLocalStorage(this.options.draft_key);
            const owns_saved_draft = saved === null || has_matching_capture_fields(
                saved,
                this.draft,
            );
            const has_newer_draft = this.edit_version !== submitted_version || this.files.length > 0 || !owns_saved_draft;
            this.captured_id = undefined;

            if (has_newer_draft) {
                if (owns_saved_draft) this.save_draft();
                this.set_message(owns_saved_draft
                    ? "Captured the submitted version. Your newer edits and pending attachments are still in this draft."
                    : "Captured the submitted version. A newer capture draft in another window was preserved.");
            } else {
                this.set_message(result?.status === "duplicate" ? "This item was already captured." : "Captured to Inbox.");

                if (this.host.get_settings().should_clear_after_capture) this.clear_draft();

                if (this.host.get_settings().should_open_after_capture) await this.host.open_inbox();

                this.options.on_captured?.();
            }
        } catch (error) {
            this.set_message(
                error instanceof Error ? error.message : "The capture could not be saved.",
                true,
            );
        } finally {
            this.is_busy = false;

            if (this.is_alive) {
                this.capture_button.setDisabled(false);
                this.surface.element.removeAttribute("aria-busy");
            }
        }
    }

    private clear_draft(): void {
        this.edit_version += 1;
        this.captured_id = undefined;
        this.draft.title = "";
        this.draft.body = "";
        this.draft.tags = this.host.get_settings().default_tags.join(" ");
        this.draft.source_url = "";
        this.draft.kind = "text";
        this.title_input.setValue("");
        this.body_input.setValue("");
        this.tags_input.setValue(this.draft.tags);
        this.source_input.setValue("");
        this.kind_input.setValue("text");
        this.files.length = 0;
        this.render_files();
        this.preview?.dispose();
        this.preview = undefined;
        this.save_draft();
    }

    private async toggle_preview(): Promise<void> {
        if (this.preview) {
            this.preview.dispose();
            this.preview = undefined;

            return;
        }

        this.preview = this.surface.create_region("beautiful_inbox_markdown_preview");

        try {
            await MarkdownRenderer.render(
                this.host.app,
                this.draft.body || "No details yet.",
                this.preview.element,
                "",
                this.preview,
            );
        } catch (error) {
            this.set_message(
                error instanceof Error ? error.message : "Markdown preview is unavailable.",
                true,
            );
        }
    }

    private async toggle_recording(): Promise<void> {
        try {
            if (this.host.audio.get_state().phase === "recording") await this.host.audio.stop();
            else await this.host.audio.start();
        } catch (error) {
            this.set_message(
                error instanceof Error ? error.message : "Audio recording could not start.",
                true,
            );
        }
    }

    private update_audio(): void {
        const state = this.host.audio.get_state();
        this.audio_button.setButtonText(state.phase === "recording" ? "Stop recording" : "Record audio");
        this.audio_button.setDisabled(!this.host.get_settings().is_audio_enabled || ["starting", "saving", "unavailable"].includes(state.phase));
        this.audio_button.buttonEl.title = state.message;
    }

    private set_message(
        message: string,
        is_error = false,
    ): void {
        this.feedback.element.hidden = false;
        this.feedback.element.textContent = message;
        this.feedback.element.dataset.state = is_error ? "error" : "info";

        this.feedback.element.setAttribute(
            "role",
            is_error ? "alert" : "status",
        );
    }
}
