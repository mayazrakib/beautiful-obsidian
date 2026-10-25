import { BasesView, setIcon } from "obsidian";
import type { Events, Plugin, QueryController } from "obsidian";

import {
    BeautifulModal,
    create_button,
    create_dropdown,
    create_feedback,
    create_icon_button,
    create_menu,
    create_surface,
    create_text_input,
    create_toolbar,
} from "@beautiful/design";
import type { DesignSurface } from "@beautiful/design";

import type { InboxHost, InboxItem, InboxStatus, OperationReport } from "../contracts";
import type { InboxGroup, KindFilter, StatusFilter } from "./collection_model";

import { InboxCanvas } from "./canvas_controller";
import { filter_groups } from "./collection_model";
import { CaptureComposer } from "./composer";
import { InboxInspector } from "./inspector";
import { confirm_action, open_defer_modal, open_import_modal, open_tags_modal } from "./modals";

export class InboxBasesView extends BasesView {
    readonly type = "beautiful_inbox_cards";
    private readonly host: InboxHost;
    private readonly surface: DesignSurface;
    private readonly viewport: HTMLElement;
    private readonly canvas: InboxCanvas;
    private readonly inspector: InboxInspector;
    private readonly count_label: HTMLElement;
    private readonly selection_label: HTMLElement;
    private readonly selection_toolbar: HTMLElement;
    private readonly selection_action_button;
    private readonly feedback: DesignSurface;
    private readonly selected_ids = new Set<string>();
    private readonly search_cache = new Map<
        string,
        { revision: string; text: string; }
    >();
    private readonly index_by_id = new Map<
        string,
        { index: number; }
    >();
    private groups: InboxGroup[] = [];
    private filtered: InboxGroup[] = [];
    private query = "";
    private status: StatusFilter = "unprocessed";
    private kind: KindFilter = "all";
    private frame_id: number | undefined;
    private is_alive = true;
    private is_busy = false;
    private needs_filter = true;
    private should_reveal_search = false;
    private capture_details: HTMLDetailsElement | undefined;

    constructor(
        controller: QueryController,
        container: HTMLElement,
        host: InboxHost,
    ) {
        super(controller);
        this.host = host;

        this.surface = create_surface(
            this,
            container,
        );

        this.surface.element.classList.add("beautiful_inbox");
        const heading = this.surface.create_region("beautiful_inbox_heading");
        const title = heading.element.ownerDocument.createElement("h3");
        const icon = heading.element.ownerDocument.createElement("span");

        icon.setAttribute(
            "aria-hidden",
            "true",
        );

        setIcon(
            icon,
            "inbox",
        );

        title.append(
            icon,
            heading.element.ownerDocument.createTextNode("Inbox"),
        );

        this.count_label = heading.element.ownerDocument.createElement("span");
        this.count_label.className = "beautiful_secondary_text";

        heading.element.append(
            title,
            this.count_label,
        );

        const toolbar = create_toolbar(
            heading,
            "Inbox actions",
        );

        toolbar.surface.element.classList.add("beautiful_inbox_header_controls");

        const search = create_text_input(
            toolbar.filters,
            {
                label: "Search Inbox",
                placeholder: "Search Inbox",
                on_change: (value) => {
                    this.query = value;
                    this.needs_filter = true;
                    this.should_reveal_search = true;
                    this.schedule_render();
                },
            },
        );

        search.inputEl.classList.add("beautiful_inbox_search");

        create_button(
            toolbar.actions,
            {
                label: "Capture",
                is_primary: true,
                on_click: () => host.open_capture(),
            },
        );

        const more_button = create_icon_button(
            toolbar.actions,
            {
                label: "More Inbox actions",
                icon: "ellipsis",
                on_click: () => {
                    const bounds = more_button.extraSettingsEl.getBoundingClientRect();

                    more_menu.showAtPosition(
                        {
                            x: bounds.left,
                            y: bounds.bottom,
                        },
                        more_button.extraSettingsEl.ownerDocument,
                    );
                },
            },
        );

        const more_menu = create_menu(
            this.surface,
            [
                {
                    label: "Inbox filters…",
                    icon: "filter",
                    on_click: () => this.open_filters(),
                },
                {
                    label: "Import…",
                    icon: "download",
                    on_click: () => { open_import_modal(host); },
                },
                {
                    label: "Start / stop audio recording",
                    icon: "mic",
                    on_click: () => {
                        if (!host.get_settings().is_audio_enabled) {
                            host.notify("Enable audio capture in Beautiful Inbox settings first.");

                            return;
                        }

                        const action = host.audio.get_state().phase === "recording" ? host.audio.stop() : host.audio.start();
                        void action.catch((error: unknown) => host.notify(error instanceof Error ? error.message : "Audio recording is unavailable."));
                    },
                },
                {
                    label: "Process queue",
                    icon: "list-checks",
                    on_click: () => this.start_processing(),
                },
                {
                    label: "Select all results",
                    icon: "check-check",
                    on_click: () => {
                        for (const group of this.filtered) for (const item of group.items) this.selected_ids.add(item.id);

                        this.update_selection();
                    },
                },
                {
                    label: "Undo last Inbox operation",
                    icon: "undo-2",
                    on_click: () => { void this.run_operation(() => host.repository.undo()); },
                },
                {
                    label: "Zoom in",
                    icon: "zoom-in",
                    on_click: () => this.canvas.zoom_by(1.25),
                },
                {
                    label: "Zoom out",
                    icon: "zoom-out",
                    on_click: () => this.canvas.zoom_by(0.8),
                },
                {
                    label: "Actual size",
                    icon: "scan",
                    on_click: () => this.canvas.actual_size(),
                },
                {
                    label: "Reset camera",
                    icon: "locate",
                    on_click: () => this.canvas.reset_camera(),
                },
                {
                    label: "Fit all captures",
                    icon: "maximize",
                    on_click: () => this.canvas.fit_all(),
                },
                {
                    label: "Fit selected captures",
                    icon: "focus",
                    on_click: () => this.canvas.fit_selected(),
                },
                {
                    label: "Auto arrange",
                    icon: "layout-grid",
                    on_click: () => this.canvas.arrange(),
                },
                {
                    label: "Reset canvas layout",
                    icon: "rotate-ccw",
                    on_click: () => this.canvas.reset_layout(),
                },
                {
                    label: "Undo canvas layout change",
                    icon: "undo",
                    on_click: () => this.canvas.undo_layout(),
                },
                {
                    label: "Toggle alignment grid",
                    icon: "grid-2x2",
                    on_click: () => this.canvas.toggle_grid(),
                },
                {
                    label: "Toggle Shift snapping",
                    icon: "magnet",
                    on_click: () => this.canvas.toggle_snapping(),
                },
                {
                    label: "Keyboard shortcuts",
                    icon: "keyboard",
                    on_click: () => this.open_keyboard_help(),
                },
            ],
        );

        const update_audio_button = (): void => {
            const state = host.audio.get_state();
            more_button.setTooltip(state.phase === "recording" ? "More Inbox actions · Audio recording in progress" : "More Inbox actions");
        };

        this.surface.register(host.audio.subscribe(update_audio_button));
        update_audio_button();

        const selection = create_toolbar(
            this.surface,
            "Selected captures",
        );

        this.selection_toolbar = selection.surface.element;
        this.selection_toolbar.classList.add("beautiful_inbox_selection_toolbar");
        this.selection_label = selection.filters.element.ownerDocument.createElement("span");

        this.selection_label.setAttribute(
            "role",
            "status",
        );

        selection.filters.element.append(this.selection_label);

        create_button(
            selection.actions,
            {
                label: "Clear selection",
                on_click: () => {
                    this.selected_ids.clear();
                    this.update_selection();
                },
            },
        );

        this.selection_action_button = create_icon_button(
            selection.actions,
            {
                label: "Actions for selected captures",
                icon: "ellipsis",
                on_click: () => {
                    const bounds = this.selection_action_button.extraSettingsEl.getBoundingClientRect();

                    selection_menu.showAtPosition(
                        {
                            x: bounds.left,
                            y: bounds.bottom,
                        },
                        this.selection_action_button.extraSettingsEl.ownerDocument,
                    );
                },
            },
        );

        const selection_menu = create_menu(
            this.surface,
            [
                {
                    label: "Mark processed",
                    icon: "check",
                    on_click: () => this.process_targets("processed"),
                },
                {
                    label: "Return to Inbox",
                    icon: "inbox",
                    on_click: () => this.process_targets("unprocessed"),
                },
                {
                    label: "Defer…",
                    icon: "clock",
                    on_click: () => {
                        const ids = this.get_targets();

                        open_defer_modal(
                            host,
                            (date) => this.run_operation(() => host.repository.process_items(
                                ids,
                                "deferred",
                                date,
                            )),
                        );
                    },
                },
                {
                    label: "Add tags…",
                    icon: "tags",
                    on_click: () => {
                        const ids = this.get_targets();

                        open_tags_modal(
                            host,
                            (tags) => this.run_operation(async () => {
                                const report: OperationReport = {
                                    succeeded: [],
                                    failed: [],
                                };

                                for (const id of ids) {
                                    const item = host.repository.get_item(id);

                                    if (!item) continue;

                                    try {
                                        await host.repository.update_item(
                                            id,
                                            { tags: [...new Set([...item.tags, ...tags])] },
                                            item.revision,
                                        );

                                        report.succeeded.push(id);
                                    } catch (error) {
                                        report.failed.push({
                                            id,
                                            message: error instanceof Error ? error.message : "Tags could not be changed.",
                                        });
                                    }
                                }

                                return report;
                            }),
                        );
                    },
                },
                {
                    label: "Archive",
                    icon: "archive",
                    on_click: () => this.process_targets("archived"),
                },
                {
                    label: "Move to trash…",
                    icon: "trash-2",
                    on_click: () => {
                        const ids = this.get_targets();

                        confirm_action(
                            host,
                            "Move captures to trash?",
                            `Move ${ids.length} capture notes to Obsidian's trash. Attachments are preserved.`,
                            "Move to trash",
                            () => this.run_operation(() => host.repository.trash_items(ids)),
                        );
                    },
                },
            ],
        );

        const body = this.surface.create_region("beautiful_inbox_body");

        this.canvas = new InboxCanvas(
            body,
            host,
            {
                read: (key) => this.config?.get(key),
                write: (
                    key,
                    value,
                ) => this.config.set(
                    key,
                    value,
                ),
                selected: this.selected_ids,
                on_selection: () => this.update_selection(),
                on_open: (item) => { void this.inspector.open_item(item); },
            },
        );

        this.viewport = this.canvas.element;
        const inspector_region = body.create_region("beautiful_inbox_inspector");

        this.inspector = new InboxInspector(
            inspector_region,
            host,
            (direction) => this.step_processing(direction),
        );

        this.feedback = create_feedback(
            this.surface,
            {
                state: "info",
                message: "Ready to capture.",
            },
        );

        this.feedback.element.hidden = true;
        const integration_status = this.surface.create_region("beautiful_inbox_integration_status");
        integration_status.element.classList.add("beautiful_secondary_text");

        integration_status.element.setAttribute(
            "role",
            "status",
        );

        const update_integration_status = (): void => {
            const audio = host.audio.get_state();
            const email = host.email.get_state();
            const messages: string[] = [];

            if (!["idle", "unavailable"].includes(audio.phase)) messages.push(`Audio: ${audio.message}`);

            if (email.is_syncing) messages.push(`Email: ${email.message}`);

            integration_status.element.textContent = messages.join(" · ");
            integration_status.element.hidden = messages.length === 0;
        };

        this.surface.register(host.audio.subscribe(update_integration_status));
        this.surface.register(host.email.subscribe(update_integration_status));
        update_integration_status();

        this.registerEvent((host.app.workspace as Events).on(
            "beautiful_inbox_settings_changed",
            () => {
                update_audio_button();

                if (host.get_settings().should_show_capture) this.ensure_inline_capture();

                if (this.capture_details) this.capture_details.hidden = !host.get_settings().should_show_capture;

                this.schedule_render();
            },
        ));

        if (host.get_settings().should_show_capture) this.ensure_inline_capture();

        this.surface.register(host.repository.subscribe(() => {
            this.onDataUpdated();
            this.inspector.refresh();
        }));

        this.surface.register(() => {
            this.is_alive = false;

            if (this.frame_id !== undefined) this.get_window().cancelAnimationFrame(this.frame_id);
        });

        this.update_selection();
    }

    onDataUpdated(): void {
        if (!this.data || !this.is_alive) return;

        const all_items = this.host.repository.list_items();
        const by_path = new Map(all_items.map((item) => [item.path, item]));
        const all_ids = new Set(all_items.map((item) => item.id));

        for (const id of this.selected_ids) if (!all_ids.has(id)) this.selected_ids.delete(id);

        for (const id of this.search_cache.keys()) if (!all_ids.has(id)) this.search_cache.delete(id);

        this.groups = this.data.groupedData.map((group) => ({
            label: group.hasKey() ? group.key?.toString() ?? "" : "",
            items: group.entries.map((entry) => by_path.get(entry.file.path)).filter((item): item is InboxItem => Boolean(item)),
        }));

        this.needs_filter = true;
        this.schedule_render();
    }

    private ensure_inline_capture(): void {
        if (this.capture_details) return;

        const capture = this.surface.element.ownerDocument.createElement("details");
        capture.className = "beautiful_inbox_quick_capture";
        this.capture_details = capture;
        const summary = capture.ownerDocument.createElement("summary");
        summary.textContent = "Quick capture";
        capture.append(summary);

        this.surface.element.insertBefore(
            capture,
            this.viewport.parentElement,
        );

        const capture_surface = create_surface(
            this,
            capture,
        );

        new CaptureComposer(
            capture_surface,
            this.host,
            { draft_key: "beautiful_inbox_inline_capture" },
        );
    }

    private open_filters(): void {
        let status = this.status;
        let kind = this.kind;

        const modal = new BeautifulModal(
            this.host.app,
            "Inbox filters",
            (surface) => {
                const fields = surface.create_region("beautiful_inbox_item_fields");

                create_dropdown(
                    fields,
                    {
                        label: "Capture state",
                        value: status,
                        options: {
                            unprocessed: "Unprocessed",
                            all: "All states",
                            deferred: "Deferred",
                            processed: "Processed",
                            archived: "Archived",
                        },
                        on_change: (value) => { status = value as StatusFilter; },
                    },
                );

                create_dropdown(
                    fields,
                    {
                        label: "Capture kind",
                        value: kind,
                        options: {
                            all: "All types",
                            text: "Text",
                            link: "Links",
                            note: "Notes",
                            file: "Files",
                            image: "Images",
                            audio: "Audio",
                            email: "Email",
                        },
                        on_change: (value) => { kind = value as KindFilter; },
                    },
                );

                create_feedback(
                    surface,
                    {
                        state: "info",
                        message: "Sort, grouping, and additional property filters remain available in Obsidian's Bases toolbar.",
                    },
                );

                create_button(
                    surface,
                    {
                        label: "Apply filters",
                        is_primary: true,
                        on_click: () => {
                            this.status = status;
                            this.kind = kind;
                            this.needs_filter = true;
                            this.should_reveal_search = true;
                            this.schedule_render();
                            modal.close();
                        },
                    },
                );
            },
        );

        this.host.own_modal?.(modal);
        modal.open();
    }

    private open_keyboard_help(): void {
        const modal = new BeautifulModal(
            this.host.app,
            "Inbox keyboard shortcuts",
            (surface) => {
                create_feedback(
                    surface,
                    {
                        state: "info",
                        message: "Drag a card header grip to move; drag its corner to resize. Drag blank canvas to pan. Ctrl/Cmd+wheel zooms; + and - also zoom. Movement and resizing are fluid; hold Shift to snap. Arrow keys navigate cards; Ctrl/Cmd+arrows move, and Ctrl/Cmd+Shift+arrows resize. Focused move/resize handles also accept arrows. Space selects; Shift+Space selects a range; Ctrl/Cmd+A selects results. Home resets the camera to the origin at actual size. Ctrl/Cmd+Z in the canvas undoes layout changes. Note undo is separate in More. Card More offers exact position and size.",
                    },
                );
            },
        );

        this.host.own_modal?.(modal);
        modal.open();
    }

    private get_window(): Window {
        return this.surface.element.ownerDocument.defaultView ?? window;
    }

    private schedule_render(): void {
        if (this.frame_id !== undefined || !this.is_alive) return;

        this.frame_id = this.get_window().requestAnimationFrame(() => {
            this.frame_id = undefined;
            this.render_collection();
        });
    }

    private render_collection(): void {
        if (!this.is_alive) return;

        if (this.needs_filter) {
            this.filtered = filter_groups(
                this.groups,
                this.query,
                this.status,
                this.kind,
                this.search_cache,
            );

            this.needs_filter = false;
            this.index_by_id.clear();
            let index = 0;

            for (const group of this.filtered) for (const item of group.items) this.index_by_id.set(
                item.id,
                { index: index++ },
            );
        }

        const count = this.filtered.reduce(
            (
                total,
                group,
            ) => total + group.items.length,
            0,
        );

        this.count_label.textContent = this.status === "all" ? `${count} captures` : `${count} ${this.status}`;

        this.canvas.set_groups(
            this.filtered.map((
                group,
                index,
            ) => ({
                key: `${index}:${group.label}`,
                label: group.label,
                items: group.items,
            })),
            this.should_reveal_search,
        );

        this.should_reveal_search = false;
        this.update_selection();
    }

    private update_selection(): void {
        this.selection_toolbar.hidden = this.selected_ids.size === 0;
        const total = this.selected_ids.size;
        const hidden = [...this.selected_ids].filter((id) => !this.index_by_id.has(id)).length;
        this.selection_label.textContent = `${total} selected${hidden ? ` (${hidden} outside these results)` : ""}`;
        this.canvas?.update_selection();
        this.selection_action_button.setDisabled(this.is_busy || total === 0);
    }

    private get_targets(): string[] {
        return [...this.selected_ids];
    }

    private process_targets(status: InboxStatus): void {
        const ids = this.get_targets();

        void this.run_operation(() => this.host.repository.process_items(
            ids,
            status,
        ));
    }

    private async run_operation(operation: () => Promise<OperationReport>): Promise<void> {
        if (this.is_busy) return;

        const current_id = this.inspector.get_item_id();
        const current_index = current_id ? this.index_by_id.get(current_id)?.index ?? 0 : 0;
        this.is_busy = true;
        this.update_selection();

        try {
            const report = await operation();
            this.feedback.element.hidden = report.failed.length === 0;

            if (!report.failed.length) this.host.notify(`${report.succeeded.length} Inbox captures updated.`);

            this.feedback.element.textContent = `${report.succeeded.length} updated${report.failed.length ? `; ${report.failed.length} failed: ${report.failed.map((failure) => failure.message).join("; ")}` : "."}`;
            this.feedback.element.dataset.state = report.failed.length ? "error" : "success";

            this.feedback.element.setAttribute(
                "role",
                report.failed.length ? "alert" : "status",
            );

            for (const id of report.succeeded) this.selected_ids.delete(id);

            this.inspector.refresh();
            this.onDataUpdated();

            if (current_id && report.succeeded.includes(current_id)) {
                const item = this.host.repository.get_item(current_id);

                if (!item || (this.status !== "all" && item.status !== this.status)) {
                    this.render_collection();
                    const next = this.filtered.flatMap((group) => group.items)[current_index];

                    if (next) void this.inspector.open_item(next);
                    else this.inspector.close();
                }
            }
        } catch (error) {
            this.feedback.element.hidden = false;
            this.feedback.element.textContent = error instanceof Error ? error.message : "The operation could not be completed.";
            this.feedback.element.dataset.state = "error";

            this.feedback.element.setAttribute(
                "role",
                "alert",
            );
        } finally {
            this.is_busy = false;
            this.update_selection();
        }
    }

    private start_processing(): void {
        const first = this.filtered.flatMap((group) => group.items)[0];

        if (first) {
            void this.inspector.open_item(first);
            this.update_selection();
        }
        else this.host.notify("There are no captures to process in these results.");
    }

    private step_processing(direction: number): void {
        const items = this.filtered.flatMap((group) => group.items);
        const current_id = this.inspector.get_item_id();
        const index = items.findIndex((item) => item.id === current_id);

        const next = items[Math.max(
            0,
            Math.min(
                items.length - 1,
                index + direction,
            ),
        )];

        if (next) {
            void this.inspector.open_item(next);
            this.update_selection();
        }
        else this.inspector.close();
    }
}

export function register_inbox_views(
    plugin: Plugin,
    host: InboxHost,
): boolean {
    const active_views = new Set<InboxBasesView>();

    plugin.register(() => {
        for (const view of [...active_views]) view.unload();

        active_views.clear();
    });

    return plugin.registerBasesView(
        "beautiful_inbox_cards",
        {
            name: "Cards",
            icon: "layout-grid",
            factory: (
                controller,
                container,
            ) => {
                const view = new InboxBasesView(
                    controller,
                    container,
                    host,
                );

                active_views.add(view);
                view.register(() => active_views.delete(view));

                return view;
            },
            options: () => [
                {
                    type: "slider",
                    key: "column_count",
                    displayName: "Auto-arrange columns",
                    default: host.get_settings().card_columns,
                    min: 1,
                    max: 8,
                    step: 1,
                },
                {
                    type: "toggle",
                    key: "should_snap_cards",
                    displayName: "Enable Shift snapping",
                    default: host.get_settings().should_snap_cards,
                },
                {
                    type: "toggle",
                    key: "should_show_grid",
                    displayName: "Show alignment grid",
                    default: host.get_settings().should_show_grid,
                },
                {
                    type: "slider",
                    key: "snap_grid_size",
                    displayName: "Snap grid size",
                    default: host.get_settings().snap_grid_size,
                    min: 4,
                    max: 128,
                    step: 4,
                },
            ],
        },
    );
}
