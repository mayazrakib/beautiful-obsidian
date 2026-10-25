import {
    BeautifulModal,
    create_button,
    create_dropdown,
    create_feedback,
    create_text_area,
    create_text_input,
    create_toolbar,
} from "@beautiful/design";

import type { CaptureInput, CaptureKind, InboxHost } from "../contracts";

import { CaptureComposer, parse_tags } from "./composer";
import { InboxInspector } from "./inspector";

export function open_capture_modal(
    host: InboxHost,
    input?: CaptureInput,
): BeautifulModal {
    const modal = new BeautifulModal(
        host.app,
        "Capture to Inbox",
        (surface) => {
            const composer = new CaptureComposer(
                surface,
                host,
                {
                    draft_key: "beautiful_inbox_modal_capture",
                    ...(input ? { input } : {}),
                    on_captured: () => modal.close(),
                },
            );

            const timer = window.setTimeout(
                () => composer.focus(),
                0,
            );

            surface.register(() => window.clearTimeout(timer));
        },
    );

    host.own_modal?.(modal);
    modal.open();

    return modal;
}

export function open_tags_modal(
    host: InboxHost,
    on_submit: (tags: string[]) => Promise<void>,
): void {
    const modal = new BeautifulModal(
        host.app,
        "Add tags to selected items",
        (surface) => {
            const input = create_text_input(
                surface,
                {
                    label: "Tags to add",
                    placeholder: "research personal",
                    on_change: () => { },
                },
            );

            const feedback = create_feedback(
                surface,
                {
                    state: "info",
                    message: "Existing tags will be preserved.",
                },
            );

            const button = create_button(
                surface,
                {
                    label: "Add tags",
                    is_primary: true,
                    on_click: () => {
                        const tags = parse_tags(input.getValue());

                        if (!tags.length) {
                            feedback.element.textContent = "Enter at least one tag.";

                            return;
                        }

                        button.setDisabled(true);

                        void on_submit(tags).then(() => modal.close()).catch((error: unknown) => {
                            button.setDisabled(false);
                            feedback.element.textContent = error instanceof Error ? error.message : "Tags could not be added.";
                        });
                    },
                },
            );
        },
    );

    host.own_modal?.(modal);
    modal.open();
}

export function open_defer_modal(
    host: InboxHost,
    on_submit: (date: string) => Promise<void>,
): void {
    const modal = new BeautifulModal(
        host.app,
        "Defer selected items",
        (surface) => {
            const input = create_text_input(
                surface,
                {
                    label: "Review date and time",
                    on_change: () => { },
                },
            );

            input.inputEl.type = "datetime-local";
            const next_day = new Date(Date.now() + 24 * 60 * 60 * 1000);

            next_day.setHours(
                9,
                0,
                0,
                0,
            );

            const local = new Date(next_day.getTime() - next_day.getTimezoneOffset() * 60 * 1000);

            input.setValue(local.toISOString().slice(
                0,
                16,
            ));

            const feedback = create_feedback(
                surface,
                {
                    state: "info",
                    message: "Time is shown in your local timezone. Deferred items can return when their review time is due.",
                },
            );

            const button = create_button(
                surface,
                {
                    label: "Defer",
                    is_primary: true,
                    on_click: () => {
                        const date = new Date(input.getValue());

                        if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
                            feedback.element.textContent = "Choose a future review time.";

                            return;
                        }

                        button.setDisabled(true);

                        void on_submit(date.toISOString()).then(() => modal.close()).catch((error: unknown) => {
                            button.setDisabled(false);
                            feedback.element.textContent = error instanceof Error ? error.message : "Items could not be deferred.";
                        });
                    },
                },
            );
        },
    );

    host.own_modal?.(modal);
    modal.open();
}

export function confirm_action(
    host: InboxHost,
    title: string,
    message: string,
    action_label: string,
    on_confirm: () => Promise<void>,
): void {
    const modal = new BeautifulModal(
        host.app,
        title,
        (surface) => {
            create_feedback(
                surface,
                {
                    state: "info",
                    message,
                },
            );

            const toolbar = create_toolbar(
                surface,
                "Confirmation actions",
            );

            create_button(
                toolbar.actions,
                {
                    label: "Cancel",
                    on_click: () => modal.close(),
                },
            );

            const confirm = create_button(
                toolbar.actions,
                {
                    label: action_label,
                    is_warning: true,
                    on_click: () => {
                        confirm.setDisabled(true);

                        void on_confirm().then(() => modal.close()).catch((error: unknown) => {
                            confirm.setDisabled(false);

                            create_feedback(
                                surface,
                                {
                                    state: "error",
                                    message: error instanceof Error ? error.message : "The action could not be completed.",
                                },
                            );
                        });
                    },
                },
            );
        },
    );

    host.own_modal?.(modal);
    modal.open();
}

export function parse_json_captures(
    value: string,
    limit: number,
): CaptureInput[] {
    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed) || parsed.length > limit) throw new Error(`Provide a JSON array containing no more than ${limit} captures.`);

    const kinds: CaptureKind[] = ["text", "link", "note", "file", "image", "audio", "email"];

    return parsed.map((
        value: unknown,
        index: number,
    ) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Capture ${index + 1} must be an object.`);

        const candidate = value as Record<
            string,
            unknown
        >;

        const result: CaptureInput = {};

        for (const key of ["title", "body", "source_url", "source_note", "source_id", "external_id", "captured_at"] as const) {
            const field = candidate[key];

            if (field !== undefined && typeof field !== "string") throw new Error(`Capture ${index + 1}: ${key} must be text.`);

            if (typeof field === "string") result[key] = field;
        }

        if (!result.title?.trim() && !result.body?.trim()) throw new Error(`Capture ${index + 1} needs a title or body.`);

        if (candidate.kind !== undefined) {
            if (typeof candidate.kind !== "string" || !kinds.includes(candidate.kind as CaptureKind)) throw new Error(`Capture ${index + 1}: unsupported kind.`);

            result.kind = candidate.kind as CaptureKind;
        }

        if (candidate.tags !== undefined) {
            if (!Array.isArray(candidate.tags) || !candidate.tags.every((tag: unknown) => typeof tag === "string")) throw new Error(`Capture ${index + 1}: tags must be a text array.`);

            result.tags = candidate.tags as string[];
        }

        return result;
    });
}

export function open_import_modal(host: InboxHost): BeautifulModal {
    const modal = new BeautifulModal(
        host.app,
        "Import into Inbox",
        (surface) => {
            const feedback = create_feedback(
                surface,
                {
                    state: "info",
                    message: "Import files, structured JSON captures, or messages from a configured email account.",
                },
            );

            const files_region = surface.create_region("beautiful_inbox_import_section");
            const files_heading = files_region.element.ownerDocument.createElement("h3");
            files_heading.textContent = "Files";
            files_region.element.append(files_heading);
            const file_input = files_region.element.ownerDocument.createElement("input");
            file_input.type = "file";
            file_input.multiple = true;

            file_input.setAttribute(
                "aria-label",
                "Files to import",
            );

            files_region.element.append(file_input);

            const file_button = create_button(
                files_region,
                {
                    label: "Import selected files",
                    on_click: () => {
                        const files = Array.from(file_input.files ?? []);

                        if (!files.length) {
                            feedback.element.textContent = "Choose files first.";

                            return;
                        }

                        file_button.setDisabled(true);

                        void host.repository.import_files(files).then((results) => {
                            feedback.element.textContent = `Imported ${results.length} files.`;
                            file_input.value = "";
                        }).catch((error: unknown) => { feedback.element.textContent = error instanceof Error ? error.message : "File import failed."; }).finally(() => file_button.setDisabled(false));
                    },
                },
            );

            const json_region = surface.create_region("beautiful_inbox_import_section");
            const json_heading = json_region.element.ownerDocument.createElement("h3");
            json_heading.textContent = "JSON captures";
            json_region.element.append(json_heading);

            const json_input = create_text_area(
                json_region,
                {
                    label: "JSON array of captures",
                    placeholder: '[{"title":"Example","body":"Details","tags":["research"]}]',
                    rows: 4,
                    on_change: () => { },
                },
            );

            let approved: CaptureInput[] = [];
            let approved_source = "";
            const summary = json_region.element.ownerDocument.createElement("div");
            json_region.element.append(summary);

            const json_actions = create_toolbar(
                json_region,
                "JSON import actions",
            );

            create_button(
                json_actions.actions,
                {
                    label: "Preview JSON",
                    on_click: () => {
                        try {
                            approved_source = json_input.getValue();

                            approved = parse_json_captures(
                                approved_source,
                                host.get_settings().import_limit,
                            );

                            summary.textContent = `${approved.length} captures: ${approved.slice(
                                0,
                                10,
                            ).map((capture) => capture.title ?? capture.body?.slice(
                                0,
                                60,
                            )).join(" · ")}`;

                            import_json.setDisabled(approved.length === 0);
                        } catch (error) {
                            approved = [];
                            import_json.setDisabled(true);
                            summary.textContent = error instanceof Error ? error.message : "Invalid JSON.";
                        }
                    },
                },
            );

            const import_json = create_button(
                json_actions.actions,
                {
                    label: "Import previewed captures",
                    is_disabled: true,
                    on_click: () => {
                        if (json_input.getValue() !== approved_source) {
                            summary.textContent = "The JSON changed. Preview it again before importing.";
                            import_json.setDisabled(true);

                            return;
                        }

                        import_json.setDisabled(true);

                        void (async () => {
                            let created = 0;
                            let duplicates = 0;

                            for (const capture of approved) {
                                const result = await host.repository.capture(capture);

                                if (result.status === "duplicate") duplicates += 1;
                                else created += 1;
                            }

                            feedback.element.textContent = `Imported ${created} captures; skipped ${duplicates} duplicates.`;
                            approved = [];
                        })().catch((error: unknown) => { feedback.element.textContent = error instanceof Error ? error.message : "JSON import failed. Saved captures remain in your vault."; });
                    },
                },
            );

            const email_region = surface.create_region("beautiful_inbox_import_section");
            const email_heading = email_region.element.ownerDocument.createElement("h3");
            email_heading.textContent = "Email";
            email_region.element.append(email_heading);
            const accounts = host.get_settings().email_accounts;

            if (accounts.length) {
                const first_account = accounts[0];
                let account_id = first_account?.id ?? "";

                create_dropdown(
                    email_region,
                    {
                        label: "Email account",
                        value: account_id,
                        options: Object.fromEntries(accounts.map((account) => [account.id, account.label || account.provider])),
                        on_change: (value) => { account_id = value; },
                    },
                );

                const preview_region = email_region.create_region("beautiful_inbox_email_preview");

                create_button(
                    email_region,
                    {
                        label: "Preview matching mail",
                        on_click: () => {
                            void host.email.preview(account_id).then((preview) => {
                                preview_region.element.replaceChildren();
                                const summary = preview_region.element.ownerDocument.createElement("p");
                                summary.textContent = `${preview.captures.length} messages in this preview${preview.has_more ? "; additional matches may be imported in later pages" : ""}.`;
                                preview_region.element.append(summary);

                                for (const capture of preview.captures.slice(
                                    0,
                                    20,
                                )) {
                                    const entry = preview_region.element.ownerDocument.createElement("p");
                                    entry.textContent = capture.title ?? "Untitled message";
                                    preview_region.element.append(entry);
                                }
                            }).catch((error: unknown) => { feedback.element.textContent = error instanceof Error ? error.message : "Email preview failed."; });
                        },
                    },
                );

                const sync = create_button(
                    email_region,
                    {
                        label: "Import matching mail",
                        on_click: () => {
                            sync.setDisabled(true);
                            void host.email.sync(account_id).catch((error: unknown) => { feedback.element.textContent = error instanceof Error ? error.message : "Email import failed."; }).finally(() => sync.setDisabled(false));
                        },
                    },
                );

                create_button(
                    email_region,
                    {
                        label: "Cancel email import",
                        on_click: () => host.email.cancel(),
                    },
                );

                surface.register(host.email.subscribe(() => { feedback.element.textContent = host.email.get_state().message; }));
            } else {
                create_feedback(
                    email_region,
                    {
                        state: "info",
                        message: "Configure a Gmail or Outlook account in Beautiful Inbox settings to preview and import mail.",
                    },
                );
            }
        },
    );

    host.own_modal?.(modal);
    modal.open();

    return modal;
}

export function open_process_next(host: InboxHost): BeautifulModal {
    const modal = new BeautifulModal(
        host.app,
        "Process Inbox",
        (surface) => {
            const queue = () => host.repository.list_items().filter((item) => item.status === "unprocessed").sort((
                left,
                right,
            ) => left.captured_at.localeCompare(right.captured_at));

            let current_id: string | undefined;

            const feedback = create_feedback(
                surface,
                {
                    state: "info",
                    message: "Clarify one capture at a time. Processing keeps the original note in your vault.",
                },
            );

            const detail_region = surface.create_region("beautiful_inbox_processing_detail");

            const inspector = new InboxInspector(
                detail_region,
                host,
                (direction) => {
                    const items = queue();
                    const index = items.findIndex((item) => item.id === current_id);

                    const next = items[Math.max(
                        0,
                        Math.min(
                            items.length - 1,
                            index + direction,
                        ),
                    )];

                    if (next) {
                        current_id = next.id;
                        void inspector.open_item(next);
                    }
                },
            );

            const open_next = (): void => {
                const items = queue();
                const item = items[0];

                if (item) {
                    current_id = item.id;
                    void inspector.open_item(item);
                    feedback.element.textContent = `${items.length} unprocessed captures remain.`;
                }
                else {
                    current_id = undefined;
                    inspector.close();
                    feedback.element.textContent = "Your inbox is clear. All captures have been processed.";
                }
            };

            const actions = create_toolbar(
                surface,
                "Process current capture",
            );

            const process = async (
                status: "processed" | "archived" | "deferred",
                review_at?: string,
            ): Promise<void> => {
                if (!current_id) return;

                const result = await host.repository.process_items(
                    [current_id],
                    status,
                    review_at,
                );

                if (result.failed.length) throw new Error(result.failed.map((failure) => failure.message).join("; "));

                open_next();
            };

            create_button(
                actions.actions,
                {
                    label: "Mark processed",
                    is_primary: true,
                    on_click: () => { void process("processed").catch((error: unknown) => { feedback.element.textContent = error instanceof Error ? error.message : "The capture could not be processed."; }); },
                },
            );

            create_button(
                actions.actions,
                {
                    label: "Defer",
                    on_click: () => open_defer_modal(
                        host,
                        (date) => process(
                            "deferred",
                            date,
                        ),
                    ),
                },
            );

            create_button(
                actions.actions,
                {
                    label: "Archive",
                    on_click: () => { void process("archived").catch((error: unknown) => { feedback.element.textContent = error instanceof Error ? error.message : "The capture could not be archived."; }); },
                },
            );

            surface.register(host.repository.subscribe(() => {
                const item = current_id ? host.repository.get_item(current_id) : undefined;

                if (current_id && (!item || item.status !== "unprocessed")) open_next();
                else inspector.refresh();
            }));

            open_next();
        },
    );

    host.own_modal?.(modal);
    modal.open();

    return modal;
}
