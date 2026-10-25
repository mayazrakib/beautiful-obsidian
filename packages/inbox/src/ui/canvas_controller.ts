import { setIcon } from "obsidian";

import {
    BeautifulModal,
    create_button,
    create_card,
    create_checkbox,
    create_empty_state,
    create_feedback,
    create_icon_button,
    create_menu,
    create_text_input,
} from "@beautiful/design";
import type { DesignSurface } from "@beautiful/design";

import type { InboxAttachment, InboxHost, InboxItem } from "../contracts";

import {
    create_canvas_geometry,
    fit_camera,
    parse_canvas_layout,
    serialize_canvas_layout,
    snap_frame,
} from "./canvas_model";
import type { CanvasCamera, CanvasFrame, CanvasGeometry, CanvasGroup, CanvasNode } from "./canvas_model";
import { calculate_gesture_frame, should_snap_pointer } from "./canvas_gesture";
import type { CanvasPointerSample } from "./canvas_gesture";
import { can_start_card_drag, resolve_active_item_id, select_interactive_nodes, should_render_overview } from "./collection_model";

export interface CanvasBindings {
    read(key: string): unknown;
    write(
        key: string,
        value: unknown,
    ): void;
    selected: Set<string>;
    on_selection(): void;
    on_open(item: InboxItem): void;
}

interface MountedCard {
    surface: DesignSurface;
    title: HTMLButtonElement;
    checkbox: HTMLInputElement;
    signature: string;
}

interface CanvasGesture {
    pointer_id: number;
    mode: "pan" | "move" | "resize";
    item_id?: string;
    start_x: number;
    start_y: number;
    camera: CanvasCamera;
    originals: Map<
        string,
        CanvasFrame
    >;
    original_overrides: Map<
        string,
        CanvasFrame | undefined
    >;
    has_moved: boolean;
}

interface LayoutUndo {
    before: Map<
        string,
        CanvasFrame | undefined
    >;
    after: Map<
        string,
        CanvasFrame | undefined
    >;
}

const KIND_ICONS = {
    text: "file-text",
    link: "link",
    note: "sticky-note",
    file: "paperclip",
    image: "image",
    audio: "audio-lines",
    email: "mail",
};

function are_frames_equal(
    left?: CanvasFrame,
    right?: CanvasFrame,
): boolean {
    return left === right || Boolean(left && right && left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height);
}

function read_camera(value: unknown): CanvasCamera {
    const candidate = value && typeof value === "object" ? value as Partial<CanvasCamera> : {};

    return {
        x: typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : 16,
        y: typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : 16,
        zoom: typeof candidate.zoom === "number" && Number.isFinite(candidate.zoom) ? Math.max(
            0.0001,
            Math.min(
                3,
                candidate.zoom,
            ),
        ) : 1,
    };
}

export class InboxCanvas {
    readonly element: HTMLElement;
    private readonly host: InboxHost;
    private readonly bindings: CanvasBindings;
    private readonly surface: DesignSurface;
    private readonly world: DesignSurface;
    private readonly overview: HTMLCanvasElement;
    private readonly overview_label: HTMLElement;
    private readonly announcer: HTMLElement;
    private readonly guides: DesignSurface;
    private readonly empty_state: DesignSurface;
    private readonly mounted = new Map<
        string,
        MountedCard
    >();
    private readonly thumbnail_cache = new Map<
        string,
        { revision: string; promise: Promise<InboxAttachment[]>; }
    >();
    private readonly preview_frames = new Map<
        string,
        CanvasFrame
    >();
    private pending_pointer: CanvasPointerSample | undefined;
    private gesture_frame_id: number | undefined;
    private move_delta = {
        x: 0,
        y: 0,
    };
    private viewport_width = 800;
    private viewport_height = 500;
    private deferred_groups: { groups: CanvasGroup[]; should_reveal: boolean } | undefined;
    private readonly history: LayoutUndo[] = [];
    private overrides = new Map<
        string,
        CanvasFrame
    >();
    private groups: CanvasGroup[] = [];
    private geometry: CanvasGeometry;
    private camera: CanvasCamera = {
        x: 16,
        y: 16,
        zoom: 1,
    };
    private layout_signature = "";
    private camera_signature = "";
    private focused_id: string | undefined;
    private selection_anchor: string | undefined;
    private gesture: CanvasGesture | undefined;
    private readonly guide_pool: HTMLElement[] = [];
    private guide_values: { axis: "x" | "y"; value: number; }[] = [];
    private frame_id: number | undefined;
    private camera_timer: number | undefined;
    private is_alive = true;
    private is_overview = false;
    private ignore_click_until = 0;

    constructor(
        parent: DesignSurface,
        host: InboxHost,
        bindings: CanvasBindings,
    ) {
        this.host = host;
        this.bindings = bindings;
        this.surface = parent.create_region("beautiful_inbox_canvas");
        this.element = this.surface.element;
        this.element.tabIndex = 0;

        this.element.setAttribute(
            "role",
            "group",
        );

        this.element.setAttribute(
            "aria-label",
            "Inbox card canvas. Drag the background to pan. Control or Command plus wheel zooms.",
        );

        this.world = this.surface.create_region("beautiful_inbox_canvas_world");

        this.world.element.setAttribute(
            "role",
            "list",
        );

        this.world.element.setAttribute(
            "aria-label",
            "Inbox captures",
        );

        this.guides = this.surface.create_region("beautiful_inbox_canvas_guides");

        this.guides.element.setAttribute(
            "aria-hidden",
            "true",
        );

        this.empty_state = create_empty_state(
            this.surface,
            {
                title: "Your inbox is clear",
                description: "Capture a thought or adjust the filters in More.",
            },
        );

        this.empty_state.element.classList.add("beautiful_inbox_canvas_empty");
        this.overview = this.element.ownerDocument.createElement("canvas");
        this.overview.className = "beautiful_inbox_overview";
        this.overview.hidden = true;

        this.overview.setAttribute(
            "aria-hidden",
            "true",
        );

        this.overview_label = this.element.ownerDocument.createElement("div");
        this.overview_label.className = "beautiful_inbox_overview_label beautiful_secondary_text";
        this.overview_label.hidden = true;
        this.announcer = this.element.ownerDocument.createElement("span");
        this.announcer.className = "beautiful_inbox_screen_reader";

        this.announcer.setAttribute(
            "role",
            "status",
        );

        this.element.append(
            this.overview,
            this.overview_label,
            this.announcer,
        );

        this.geometry = create_canvas_geometry(
            [],
            this.overrides,
            this.column_count(),
        );

        this.surface.registerDomEvent(
            this.element,
            "pointerdown",
            (event) => this.begin_background(event),
        );

        this.surface.registerDomEvent(
            this.element,
            "pointermove",
            (event) => this.queue_pointer(event),
        );

        this.surface.registerDomEvent(
            this.element,
            "pointerup",
            (event) => {
                this.queue_pointer(event);
                this.flush_pointer();

                this.finish_gesture(
                    event.pointerId,
                    false,
                );
            },
        );

        this.surface.registerDomEvent(
            this.element,
            "pointercancel",
            (event) => this.finish_gesture(
                event.pointerId,
                true,
            ),
        );

        this.surface.registerDomEvent(
            this.element,
            "lostpointercapture",
            (event) => this.finish_gesture(
                event.pointerId,
                true,
            ),
        );

        this.surface.registerDomEvent(
            this.element,
            "wheel",
            (event) => this.handle_wheel(event),
            { passive: false },
        );

        this.surface.registerDomEvent(
            this.element,
            "keydown",
            (event) => this.handle_keyboard(event),
        );

        this.surface.registerDomEvent(
            this.element,
            "click",
            (event) => {
                if (this.is_overview && performance.now() > this.ignore_click_until) this.reveal_at(
                    event.clientX,
                    event.clientY,
                );
            },
        );

        if (typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver((entries) => {
                const size = entries[0]?.contentRect;
                if (size) {
                    this.viewport_width = size.width || 800;
                    this.viewport_height = size.height || 500;
                }
                this.schedule_render();
            });
            observer.observe(this.element);
            this.surface.register(() => observer.disconnect());
        }

        const theme_event = this.host.app.workspace.on(
            "css-change",
            () => this.schedule_render(),
        );
        this.surface.register(() => this.host.app.workspace.offref(theme_event));

        this.surface.register(() => {
            this.is_alive = false;

            if (this.frame_id !== undefined) this.get_window().cancelAnimationFrame(this.frame_id);

            if (this.gesture_frame_id !== undefined) this.get_window().cancelAnimationFrame(this.gesture_frame_id);

            if (this.camera_timer !== undefined) this.get_window().clearTimeout(this.camera_timer);

            if (this.gesture) this.finish_gesture(
                this.gesture.pointer_id,
                true,
            );
        });
    }

    set_groups(
        groups: CanvasGroup[],
        should_reveal = false,
    ): void {
        // Keep mounted controls and geometry stable until the captured pointer finishes.
        if (this.gesture) {
            this.deferred_groups = {
                groups,
                should_reveal: should_reveal || Boolean(this.deferred_groups?.should_reveal),
            };
            if (this.gesture.item_id && !this.host.repository.get_item(this.gesture.item_id)) this.finish_gesture(
                this.gesture.pointer_id,
                true,
            );
            return;
        }
        this.groups = groups;
        const parsed = parse_canvas_layout(this.bindings.read("beautiful_canvas_layout"));
        const signature = JSON.stringify(serialize_canvas_layout(parsed));

        if (!this.gesture && signature !== this.layout_signature) {
            this.overrides = parsed;
            this.layout_signature = signature;
            this.history.length = 0;
        }

        const camera_value = this.bindings.read("beautiful_canvas_camera");
        const camera_signature = JSON.stringify(camera_value ?? null);

        if (!this.gesture && this.camera_timer === undefined && camera_signature !== this.camera_signature) {
            this.camera = read_camera(camera_value);
            this.camera_signature = camera_signature;
        }

        this.rebuild_geometry();

        if (should_reveal && this.geometry.nodes[0]) this.reveal_node(
            this.geometry.nodes[0],
            false,
            0.8,
        );

        this.schedule_render();
    }

    update_selection(): void {
        for (const [id, card] of this.mounted) {
            card.checkbox.checked = this.bindings.selected.has(id);

            card.surface.element.classList.toggle(
                "is_selected",
                this.bindings.selected.has(id),
            );
        }

        this.schedule_render();
    }

    zoom_by(factor: number): void {
        this.zoom_at(
            this.element.clientWidth / 2,
            this.element.clientHeight / 2,
            factor,
        );
    }

    actual_size(): void {
        this.zoom_by(1 / this.camera.zoom);
    }

    reset_camera(): void {
        this.camera = {
            x: 16,
            y: 16,
            zoom: 1,
        };

        this.persist_camera();
        this.schedule_render();
    }

    fit_all(): void {
        if (!this.geometry.nodes.length) return;

        this.camera = fit_camera(
            this.geometry.bounds,
            this.element.clientWidth || 800,
            this.element.clientHeight || 500,
        );

        this.persist_camera();
        this.schedule_render();
    }

    fit_selected(): void {
        const nodes = [...this.bindings.selected].map((id) => this.geometry.by_id.get(id)).filter((node): node is CanvasNode => Boolean(node));

        if (!nodes.length) {
            this.host.notify("Select captures to fit them in the canvas.");

            return;
        }

        const min_x = Math.min(...nodes.map((node) => node.frame.x));
        const min_y = Math.min(...nodes.map((node) => node.frame.y));
        const max_x = Math.max(...nodes.map((node) => node.frame.x + node.frame.width));
        const max_y = Math.max(...nodes.map((node) => node.frame.y + node.frame.height));

        this.camera = fit_camera(
            {
                x: min_x,
                y: min_y,
                width: max_x - min_x,
                height: max_y - min_y,
            },
            this.element.clientWidth || 800,
            this.element.clientHeight || 500,
        );

        this.persist_camera();
        this.schedule_render();
    }

    arrange(): void {
        const arranged = create_canvas_geometry(
            this.groups,
            new Map(),
            this.column_count(),
        );

        this.commit_frames(new Map(arranged.nodes.map((node) => [node.item.id, node.frame])));
        this.fit_all();
        this.announcer.textContent = "Cards arranged in the current Bases sort and group order.";
    }

    reset_layout(): void {
        const updates = new Map<
            string,
            CanvasFrame | undefined
        >();

        for (const id of this.overrides.keys()) updates.set(
            id,
            undefined,
        );

        this.commit_frames(updates);

        this.camera = {
            x: 16,
            y: 16,
            zoom: 1,
        };

        this.persist_camera();
        this.schedule_render();
    }

    undo_layout(): void {
        const entry = this.history.pop();

        if (!entry) {
            this.host.notify("There is no canvas layout change to undo.");

            return;
        }

        const latest = parse_canvas_layout(this.bindings.read("beautiful_canvas_layout"));

        for (const [id, after] of entry.after) {
            if (!are_frames_equal(
                latest.get(id),
                after,
            )) {
                this.history.length = 0;
                this.host.notify("The layout changed elsewhere. Undo was canceled to preserve that change.");

                return;
            }
        }

        this.apply_frames(
            latest,
            entry.before,
        );

        this.save_layout(latest);
        this.rebuild_geometry();
        this.schedule_render();
        this.announcer.textContent = "Canvas layout change undone.";
    }

    toggle_grid(): void {
        this.bindings.write(
            "should_show_grid",
            !this.should_show_grid(),
        );

        this.schedule_render();
    }

    toggle_snapping(): void {
        this.bindings.write(
            "should_snap_cards",
            !this.should_snap(),
        );

        this.host.notify(this.should_snap() ? "Hold Shift while dragging to snap." : "Shift snapping disabled.");
    }

    private get_window(): Window {
        return this.element.ownerDocument.defaultView ?? window;
    }

    private column_count(): number {
        const value = this.bindings.read("column_count");

        return typeof value === "number" && Number.isFinite(value) ? Math.max(
            1,
            Math.min(
                8,
                Math.floor(value),
            ),
        ) : this.host.get_settings().card_columns;
    }

    private should_snap(): boolean {
        const value = this.bindings.read("should_snap_cards");

        return typeof value === "boolean" ? value : this.host.get_settings().should_snap_cards;
    }

    private should_show_grid(): boolean {
        const value = this.bindings.read("should_show_grid");

        return typeof value === "boolean" ? value : this.host.get_settings().should_show_grid;
    }

    private grid_size(): number {
        const value = this.bindings.read("snap_grid_size");

        return typeof value === "number" && Number.isFinite(value) ? Math.max(
            4,
            Math.min(
                128,
                value,
            ),
        ) : this.host.get_settings().snap_grid_size;
    }

    private rebuild_geometry(): void {
        this.geometry = create_canvas_geometry(
            this.groups,
            this.overrides,
            this.column_count(),
        );
    }

    private schedule_render(): void {
        if (!this.is_alive || this.frame_id !== undefined) return;

        this.frame_id = this.get_window().requestAnimationFrame(() => {
            this.frame_id = undefined;
            if (this.gesture && this.gesture.mode !== "pan") return;
            this.render();
        });
    }

    private view_bounds(): CanvasFrame {
        const margin = 100 / this.camera.zoom;

        return {
            x: -this.camera.x / this.camera.zoom - margin,
            y: -this.camera.y / this.camera.zoom - margin,
            width: this.viewport_width / this.camera.zoom + margin * 2,
            height: this.viewport_height / this.camera.zoom + margin * 2,
        };
    }

    private render(): void {
        if (!this.is_alive) return;

        const { x, y, zoom } = this.camera;
        this.world.element.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
        this.guides.element.style.transform = this.world.element.style.transform;

        this.element.classList.toggle(
            "has_grid",
            this.should_show_grid() && zoom >= 0.35,
        );

        this.element.style.setProperty(
            "--beautiful_canvas_grid_size",
            `${this.grid_size() * zoom}px`,
        );

        this.element.style.setProperty(
            "--beautiful_canvas_pan_x",
            `${x}px`,
        );

        this.element.style.setProperty(
            "--beautiful_canvas_pan_y",
            `${y}px`,
        );

        const bounds = this.view_bounds();
        const visible_map = new Map(this.geometry.index.query(bounds).map((node) => [node.item.id, node]));

        for (const [id, frame] of this.preview_frames) {
            const node = this.geometry.by_id.get(id);
            const is_visible = frame.x <= bounds.x + bounds.width && frame.x + frame.width >= bounds.x && frame.y <= bounds.y + bounds.height && frame.y + frame.height >= bounds.y;

            if (node && is_visible) visible_map.set(
                id,
                node,
            );
            else visible_map.delete(id);
        }

        const visible = [...visible_map.values()];
        const active = this.element.ownerDocument.activeElement as HTMLElement | null;

        const active_id = resolve_active_item_id(
            this.world.element,
            active,
            this.focused_id,
        );

        if (active_id) this.focused_id = active_id;

        const overview = should_render_overview(
            zoom,
            visible.length,
        );

        this.empty_state.element.hidden = this.geometry.nodes.length > 0;

        if (overview && active_id) this.element.focus({ preventScroll: true });

        this.is_overview = overview;
        this.overview.hidden = !overview;
        this.overview_label.hidden = !overview;
        this.world.element.hidden = overview;

        if (overview) {
            for (const card of this.mounted.values()) card.surface.dispose();

            this.mounted.clear();
            this.draw_overview(visible);
            this.overview_label.textContent = `${this.geometry.nodes.length.toLocaleString()} captures · Overview · Click a cluster to zoom in`;
        } else {
            const pinned_ids = [active_id, this.gesture?.item_id].filter((id): id is string => Boolean(id));
            const pinned = pinned_ids.map((id) => this.geometry.by_id.get(id)).filter((node): node is CanvasNode => Boolean(node));

            const wanted = new Map(select_interactive_nodes(
                visible,
                pinned,
            ).map((node) => [node.item.id, node]));

            for (const [id, card] of this.mounted) if (!wanted.has(id)) {
                card.surface.dispose();
                this.mounted.delete(id);
            }

            for (const node of wanted.values()) {
                const settings = this.host.get_settings();
                const signature = `${node.item.revision}:${settings.should_show_previews}:${settings.should_show_metadata}:${node.group_label}`;
                let card = this.mounted.get(node.item.id);

                if (card && card.signature !== signature && !this.gesture) {
                    card.surface.dispose();
                    this.mounted.delete(node.item.id);
                    card = undefined;
                }

                if (!card) {
                    card = this.create_card(
                        node,
                        signature,
                    );

                    this.mounted.set(
                        node.item.id,
                        card,
                    );
                }

                const frame = this.preview_frames.get(node.item.id) ?? node.frame;

                Object.assign(
                    card.surface.element.style,
                    {
                        left: `${frame.x}px`,
                        top: `${frame.y}px`,
                        width: `${frame.width}px`,
                        height: `${frame.height}px`,
                    },
                );

                card.surface.element.classList.toggle(
                    "is_dragging",
                    Boolean(this.gesture?.originals.has(node.item.id)),
                );

                card.surface.element.classList.toggle(
                    "is_selected",
                    this.bindings.selected.has(node.item.id),
                );

                card.checkbox.checked = this.bindings.selected.has(node.item.id);
                card.title.tabIndex = this.focused_id === node.item.id ? 0 : -1;
            }

            if (![...this.mounted.values()].some((card) => card.title.tabIndex === 0)) {
                const first = this.mounted.values().next().value as MountedCard | undefined;

                if (first) first.title.tabIndex = 0;
            }

            if (active && !active.isConnected && active_id) {
                const card = this.mounted.get(active_id);
                (active.matches('input[type="checkbox"]') ? card?.checkbox : card?.title)?.focus({ preventScroll: true });
            }
        }

        this.paint_guides();
    }

    private draw_overview(nodes: CanvasNode[]): void {
        const width = this.viewport_width;
        const height = this.viewport_height;

        const ratio = Math.min(
            2,
            this.get_window().devicePixelRatio || 1,
        );

        this.overview.width = Math.ceil(width * ratio);
        this.overview.height = Math.ceil(height * ratio);
        const context = this.overview.getContext("2d");

        if (!context) return;

        context.setTransform(
            ratio,
            0,
            0,
            ratio,
            0,
            0,
        );

        context.clearRect(
            0,
            0,
            width,
            height,
        );

        const style = this.get_window().getComputedStyle(this.element);
        const foreground = style.getPropertyValue("--text-muted").trim() || style.color;
        const accent = style.getPropertyValue("--interactive-accent").trim() || style.color;
        const clusters = new Map<
            string,
            { x: number; y: number; count: number; selected: boolean; }
        >();

        for (const node of nodes) {
            const frame = this.preview_frames.get(node.item.id) ?? node.frame;
            const x = frame.x * this.camera.zoom + this.camera.x;
            const y = frame.y * this.camera.zoom + this.camera.y;
            const cell_x = Math.floor(x / 20) * 20;
            const cell_y = Math.floor(y / 20) * 20;
            const key = `${cell_x}:${cell_y}`;

            const cluster = clusters.get(key) ?? {
                x: cell_x,
                y: cell_y,
                count: 0,
                selected: false,
            };

            cluster.count += 1;
            cluster.selected ||= this.bindings.selected.has(node.item.id) || node.item.id === this.focused_id;

            clusters.set(
                key,
                cluster,
            );
        }

        for (const cluster of clusters.values()) {
            context.fillStyle = cluster.selected ? accent : foreground;
            context.globalAlpha = cluster.selected ? 0.95 : 0.55;

            context.fillRect(
                cluster.x + 2,
                cluster.y + 2,
                16,
                14,
            );

            if (cluster.count > 1) {
                context.globalAlpha = 1;
                context.fillStyle = style.getPropertyValue("--background-primary").trim() || "transparent";
                context.font = "10px sans-serif";
                context.textAlign = "center";

                context.fillText(
                    String(cluster.count),
                    cluster.x + 10,
                    cluster.y + 13,
                );
            }
        }

        context.globalAlpha = 1;
    }

    private create_card(
        node: CanvasNode,
        signature: string,
    ): MountedCard {
        const item = node.item;

        const card = create_card(
            this.world,
            item.title,
        );

        const surface = card.surface;

        surface.element.classList.add(
            "beautiful_inbox_item",
            "beautiful_inbox_canvas_card",
        );

        surface.element.dataset.itemId = item.id;

        surface.element.setAttribute(
            "role",
            "listitem",
        );

        const header = card.content.create_region("beautiful_inbox_item_header");

        const checkbox = create_checkbox(
            header,
            {
                label: `Select ${item.title}`,
                value: this.bindings.selected.has(item.id),
                on_change: (value) => {
                    if (value) this.bindings.selected.add(item.id); else this.bindings.selected.delete(item.id);

                    this.selection_anchor = item.id;
                    this.bindings.on_selection();
                    this.update_selection();
                },
            },
        );

        const icon = header.element.ownerDocument.createElement("span");
        icon.className = "beautiful_inbox_kind_icon";

        icon.setAttribute(
            "aria-hidden",
            "true",
        );

        setIcon(
            icon,
            KIND_ICONS[item.kind],
        );

        header.element.append(icon);

        const title = create_button(
            header,
            {
                label: item.title,
                on_click: () => { if (performance.now() > this.ignore_click_until) this.bindings.on_open(this.host.repository.get_item(item.id) ?? item); },
            },
        ).buttonEl;

        title.classList.add("beautiful_inbox_item_title");

        surface.registerDomEvent(
            title,
            "focus",
            () => { this.focused_id = item.id; },
        );

        const tools = header.create_region("beautiful_inbox_card_tools");

        const move = create_icon_button(
            tools,
            {
                label: `Move ${item.title}. Arrow keys move; Shift moves farther.`,
                icon: "grip",
                on_click: () => { if (performance.now() > this.ignore_click_until) this.open_geometry_dialog(item.id); },
            },
        );

        move.extraSettingsEl.dataset.canvasHandle = "move";
        move.extraSettingsEl.dataset.itemId = item.id;

        const more = create_icon_button(
            tools,
            {
                label: `More actions for ${item.title}`,
                icon: "ellipsis",
                on_click: () => {
                    const bounds = more.extraSettingsEl.getBoundingClientRect();

                    menu.showAtPosition(
                        {
                            x: bounds.left,
                            y: bounds.bottom,
                        },
                        more.extraSettingsEl.ownerDocument,
                    );
                },
            },
        );

        const menu = create_menu(
            surface,
            [
                {
                    label: "Open details",
                    icon: "panel-right",
                    on_click: () => this.bindings.on_open(this.host.repository.get_item(item.id) ?? item),
                },
                {
                    label: "Open note",
                    icon: "file-text",
                    on_click: () => { void this.host.open_note(item.id); },
                },
                {
                    label: "Position and size…",
                    icon: "move",
                    on_click: () => this.open_geometry_dialog(item.id),
                },
                {
                    label: "Center this card",
                    icon: "focus",
                    on_click: () => this.reveal_node(node),
                },
            ],
        );

        surface.registerDomEvent(
            surface.element,
            "contextmenu",
            (event) => {
                event.preventDefault();
                event.stopPropagation();
                menu.showAtMouseEvent(event);
            },
        );

        surface.registerDomEvent(
            header.element,
            "pointerdown",
            (event) => {
                const target = event.target as HTMLElement;

                if (!can_start_card_drag(target)) return;

                this.begin_card(
                    event,
                    item.id,
                    "move",
                );
            },
        );

        if (this.host.get_settings().should_show_previews && item.preview && item.kind !== "image") {
            const preview = card.content.element.ownerDocument.createElement("p");
            preview.className = "beautiful_inbox_item_preview";
            preview.textContent = item.preview;
            card.content.element.append(preview);
        }

        if (node.group_label) {
            const group = card.content.element.ownerDocument.createElement("span");
            group.className = "beautiful_inbox_group_badge beautiful_secondary_text";
            group.textContent = node.group_label;
            card.content.element.append(group);
        }

        if (this.host.get_settings().should_show_metadata) {
            const metadata = card.content.element.ownerDocument.createElement("p");
            metadata.className = "beautiful_inbox_item_metadata beautiful_secondary_text";
            metadata.textContent = [item.status, item.kind, ...item.tags.map((tag) => `#${tag}`)].filter(Boolean).join(" · ");
            card.content.element.append(metadata);
        }

        if (item.kind === "image" && this.host.get_settings().should_show_previews) {
            let request = this.thumbnail_cache.get(item.id);

            if (!request || request.revision !== item.revision) {
                request = {
                    revision: item.revision,
                    promise: this.host.repository.list_attachments(item.id),
                };

                this.thumbnail_cache.set(
                    item.id,
                    request,
                );

                if (this.thumbnail_cache.size > 256) {
                    const first = this.thumbnail_cache.keys().next().value;

                    if (first) this.thumbnail_cache.delete(first);
                }
            }

            void request.promise.then((attachments) => {
                if (!surface.element.isConnected) return;

                const attachment = attachments.find((value) => value.kind === "image");

                if (!attachment) return;

                const image = card.content.element.ownerDocument.createElement("img");
                image.className = "beautiful_inbox_card_thumbnail";
                image.loading = "lazy";
                image.src = attachment.resource_url;
                image.alt = attachment.name;
                card.content.element.append(image);
            }).catch(() => { });
        }

        const resize = create_icon_button(
            card.actions,
            {
                label: `Resize ${item.title}. Arrow keys resize; Shift resizes farther.`,
                icon: "move-diagonal-2",
                on_click: () => { if (performance.now() > this.ignore_click_until) this.open_geometry_dialog(item.id); },
            },
        );

        resize.extraSettingsEl.dataset.canvasHandle = "resize";
        resize.extraSettingsEl.dataset.itemId = item.id;
        resize.extraSettingsEl.classList.add("beautiful_inbox_resize_handle");

        surface.registerDomEvent(
            resize.extraSettingsEl,
            "pointerdown",
            (event) => this.begin_card(
                event,
                item.id,
                "resize",
            ),
        );

        return {
            surface,
            title,
            checkbox,
            signature,
        };
    }

    private begin_background(event: PointerEvent): void {
        if (this.gesture || (event.button !== 0 && event.button !== 1)) return;

        const target = event.target as HTMLElement;

        if (target.closest(".beautiful_inbox_item")) return;

        event.preventDefault();
        event.stopPropagation();
        this.element.focus({ preventScroll: true });

        this.gesture = {
            pointer_id: event.pointerId,
            mode: "pan",
            start_x: event.clientX,
            start_y: event.clientY,
            camera: { ...this.camera },
            originals: new Map(),
            original_overrides: new Map(),
            has_moved: false,
        };

        this.element.setPointerCapture(event.pointerId);
    }

    private begin_card(
        event: PointerEvent,
        id: string,
        mode: "move" | "resize",
    ): void {
        if (event.button !== 0 || this.gesture) return;

        const node = this.geometry.by_id.get(id);

        if (!node) return;

        event.preventDefault();
        event.stopPropagation();
        this.focused_id = id;
        this.element.focus({ preventScroll: true });

        if (!this.bindings.selected.has(id)) {
            this.bindings.selected.clear();
            this.bindings.selected.add(id);
            this.bindings.on_selection();
        }

        const ids = mode === "resize" ? [id] : [...this.bindings.selected];
        const originals = new Map<
            string,
            CanvasFrame
        >();
        const original_overrides = new Map<
            string,
            CanvasFrame | undefined
        >();

        for (const selected_id of ids) {
            const selected = this.geometry.by_id.get(selected_id);

            if (selected) {
                originals.set(
                    selected_id,
                    { ...selected.frame },
                );

                original_overrides.set(
                    selected_id,
                    this.overrides.get(selected_id),
                );
            }
        }

        this.gesture = {
            pointer_id: event.pointerId,
            mode,
            item_id: id,
            start_x: event.clientX,
            start_y: event.clientY,
            camera: { ...this.camera },
            originals,
            original_overrides,
            has_moved: false,
        };

        this.move_delta = {
            x: 0,
            y: 0,
        };
        for (const [selected_id, card] of this.mounted) {
            card.surface.element.classList.toggle(
                "is_dragging",
                originals.has(selected_id),
            );
        }
        this.element.setPointerCapture(event.pointerId);
    }

    private queue_pointer(event: PointerEvent): void {
        if (!this.gesture || this.gesture.pointer_id !== event.pointerId) return;
        // Pointer events can outpace display frames; only the latest sample is painted.
        this.pending_pointer = {
            pointer_id: event.pointerId,
            client_x: event.clientX,
            client_y: event.clientY,
            should_snap: should_snap_pointer(
                event.shiftKey,
                this.should_snap(),
            ),
        };
        if (this.gesture_frame_id !== undefined) return;
        this.gesture_frame_id = this.get_window().requestAnimationFrame(() => {
            this.gesture_frame_id = undefined;
            this.flush_pointer();
        });
    }

    private flush_pointer(): void {
        if (this.gesture_frame_id !== undefined) this.get_window().cancelAnimationFrame(this.gesture_frame_id);
        this.gesture_frame_id = undefined;
        const sample = this.pending_pointer;
        this.pending_pointer = undefined;
        if (sample) this.update_gesture(sample);
    }

    private update_gesture(event: CanvasPointerSample): void {
        const gesture = this.gesture;

        if (!gesture || gesture.pointer_id !== event.pointer_id) return;

        const screen_x = event.client_x - gesture.start_x;
        const screen_y = event.client_y - gesture.start_y;

        if (!gesture.has_moved && Math.hypot(
            screen_x,
            screen_y,
        ) < 4) return;

        gesture.has_moved = true;

        if (gesture.mode === "pan") {
            this.camera = {
                x: gesture.camera.x + screen_x,
                y: gesture.camera.y + screen_y,
                zoom: gesture.camera.zoom,
            };
        } else {
            const primary = gesture.item_id ? gesture.originals.get(gesture.item_id) : undefined;

            if (!primary) return;

            let frame = calculate_gesture_frame(
                primary,
                screen_x,
                screen_y,
                gesture.camera.zoom,
                gesture.mode === "resize",
            );

            this.guide_values = [];

            if (event.should_snap) {
                const nearby = this.geometry.index.query({
                    x: frame.x - 100,
                    y: frame.y - 100,
                    width: frame.width + 200,
                    height: frame.height + 200,
                }).filter((node) => !gesture.originals.has(node.item.id));

                const snapped = snap_frame(
                    frame,
                    nearby.map((node) => node.frame),
                    this.grid_size(),
                    6 / gesture.camera.zoom,
                    gesture.mode === "resize",
                );

                frame = snapped.frame;
                this.guide_values = snapped.guides;
            }

            if (gesture.mode === "resize") this.preview_frames.set(
                gesture.item_id ?? "",
                frame,
            );
            else this.move_delta = {
                x: frame.x - primary.x,
                y: frame.y - primary.y,
            };
        }

        if (gesture.mode === "pan") this.render();
        else this.paint_gesture(gesture);
    }

    private paint_gesture(gesture: CanvasGesture): void {
        // A shared delta keeps a large selection proportional to mounted cards while moving.
        for (const [id, card] of this.mounted) {
            if (!gesture.originals.has(id)) continue;
            const style = card.surface.element.style;
            if (gesture.mode === "move") style.transform = `translate3d(${this.move_delta.x}px, ${this.move_delta.y}px, 0)`;
            else {
                const frame = this.preview_frames.get(id);
                if (frame) {
                    style.width = `${frame.width}px`;
                    style.height = `${frame.height}px`;
                }
            }
        }
        this.paint_guides();
    }

    private finish_gesture(
        pointer_id: number,
        should_cancel: boolean,
    ): void {
        const gesture = this.gesture;

        if (!gesture || gesture.pointer_id !== pointer_id) return;

        this.pending_pointer = undefined;
        if (this.gesture_frame_id !== undefined) this.get_window().cancelAnimationFrame(this.gesture_frame_id);
        this.gesture_frame_id = undefined;
        this.gesture = undefined;

        if (this.element.hasPointerCapture(pointer_id)) this.element.releasePointerCapture(pointer_id);

        if (gesture.has_moved) this.ignore_click_until = performance.now() + 250;

        if (should_cancel) this.camera = gesture.camera;
        else if (gesture.mode === "pan" && gesture.has_moved) this.persist_camera();
        else if (gesture.has_moved && gesture.mode !== "pan") {
            if (gesture.mode === "move") {
                for (const [id, original] of gesture.originals) this.preview_frames.set(
                    id,
                    {
                        ...original,
                        x: original.x + this.move_delta.x,
                        y: original.y + this.move_delta.y,
                    },
                );
            }
            const latest = parse_canvas_layout(this.bindings.read("beautiful_canvas_layout"));

            const has_conflict = [...gesture.original_overrides].some(([id, frame]) => !are_frames_equal(
                latest.get(id),
                frame,
            ));

            if (has_conflict) this.host.notify("The layout changed elsewhere. This gesture was canceled to preserve that change.");
            else this.commit_frames(new Map(this.preview_frames));
        }

        for (const [id, card] of this.mounted) {
            card.surface.element.style.transform = "";
            card.surface.element.classList.remove("is_dragging");
            const frame = this.geometry.by_id.get(id)?.frame;
            if (frame) Object.assign(
                card.surface.element.style,
                {
                    left: `${frame.x}px`,
                    top: `${frame.y}px`,
                    width: `${frame.width}px`,
                    height: `${frame.height}px`,
                },
            );
        }
        this.preview_frames.clear();
        this.move_delta = {
            x: 0,
            y: 0,
        };
        this.guide_values = [];
        this.paint_guides();
        const latest_layout = parse_canvas_layout(this.bindings.read("beautiful_canvas_layout"));
        const latest_signature = JSON.stringify(serialize_canvas_layout(latest_layout));

        if (latest_signature !== this.layout_signature) {
            this.overrides = latest_layout;
            this.layout_signature = latest_signature;
            this.history.length = 0;
            this.rebuild_geometry();
        }

        const deferred = this.deferred_groups;
        this.deferred_groups = undefined;
        if (deferred) this.set_groups(
            deferred.groups,
            deferred.should_reveal,
        );
        this.schedule_render();
    }

    private handle_wheel(event: WheelEvent): void {
        event.preventDefault();
        event.stopPropagation();

        if (this.gesture) return;

        const bounds = this.element.getBoundingClientRect();

        if (event.ctrlKey || event.metaKey) this.zoom_at(
            event.clientX - bounds.left,
            event.clientY - bounds.top,
            Math.exp(-event.deltaY * 0.002),
        );
        else {
            const scale = event.deltaMode === 1 ? 16 : 1;
            this.camera.x -= (event.shiftKey ? event.deltaY : event.deltaX) * scale;
            this.camera.y -= (event.shiftKey ? 0 : event.deltaY) * scale;
            this.persist_camera();
            this.schedule_render();
        }
    }

    private zoom_at(
        x: number,
        y: number,
        factor: number,
    ): void {
        if (this.gesture) return;

        const zoom = Math.max(
            0.0001,
            Math.min(
                3,
                this.camera.zoom * factor,
            ),
        );

        this.camera.x = x - (x - this.camera.x) * zoom / this.camera.zoom;
        this.camera.y = y - (y - this.camera.y) * zoom / this.camera.zoom;
        this.camera.zoom = zoom;
        this.persist_camera();
        this.schedule_render();
    }

    private persist_camera(): void {
        if (this.camera_timer !== undefined) this.get_window().clearTimeout(this.camera_timer);

        this.camera_timer = this.get_window().setTimeout(
            () => {
                this.camera_timer = undefined;
                this.camera_signature = JSON.stringify(this.camera);

                this.bindings.write(
                    "beautiful_canvas_camera",
                    { ...this.camera },
                );
            },
            250,
        );
    }

    private apply_frames(
        target: Map<
            string,
            CanvasFrame
        >,
        updates: Map<
            string,
            CanvasFrame | undefined
        >,
    ): void {
        for (const [id, frame] of updates) {
            if (frame) target.set(
                id,
                { ...frame },
            ); else target.delete(id);
        }
    }

    private commit_frames(updates: Map<
        string,
        CanvasFrame | undefined
    >): void {
        if (!updates.size) return;

        const latest = parse_canvas_layout(this.bindings.read("beautiful_canvas_layout"));
        const before = new Map<
            string,
            CanvasFrame | undefined
        >();

        for (const id of updates.keys()) before.set(
            id,
            latest.get(id),
        );

        this.history.push({
            before,
            after: new Map(updates),
        });

        while (this.history.length > 50 || this.history.reduce(
            (
                count,
                entry,
            ) => count + entry.before.size,
            0,
        ) > 50000) this.history.shift();

        this.apply_frames(
            latest,
            updates,
        );

        this.save_layout(latest);
        this.rebuild_geometry();
        this.schedule_render();
        this.announcer.textContent = "Card position and size saved.";
    }

    private save_layout(layout: Map<
        string,
        CanvasFrame
    >): void {
        const value = serialize_canvas_layout(layout);

        this.bindings.write(
            "beautiful_canvas_layout",
            value,
        );

        this.overrides = parse_canvas_layout(value);
        this.layout_signature = JSON.stringify(value);
    }

    private handle_keyboard(event: KeyboardEvent): void {
        const target = event.target as HTMLElement;

        if (target.closest("input,textarea,select,[contenteditable='true']") || event.defaultPrevented) return;

        if (event.key === "Escape" && this.gesture) {
            event.preventDefault();
            event.stopPropagation();

            this.finish_gesture(
                this.gesture.pointer_id,
                true,
            );

            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            event.stopPropagation();
            this.undo_layout();

            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
            event.preventDefault();
            event.stopPropagation();

            for (const node of this.geometry.nodes) this.bindings.selected.add(node.item.id);

            this.bindings.on_selection();
            this.update_selection();

            return;
        }

        if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            event.stopPropagation();
            this.zoom_by(1.2);

            return;
        }

        if (event.key === "-") {
            event.preventDefault();
            event.stopPropagation();
            this.zoom_by(1 / 1.2);

            return;
        }

        if (event.key === "0") {
            event.preventDefault();
            event.stopPropagation();
            this.actual_size();

            return;
        }

        if (event.key === "Home") {
            event.preventDefault();
            event.stopPropagation();
            this.reset_camera();

            return;
        }

        const id = resolve_active_item_id(
            this.world.element,
            target,
            this.focused_id,
        ) ?? this.focused_id;

        const node = id ? this.geometry.by_id.get(id) : undefined;

        if (this.is_overview && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            const current = node ?? this.geometry.nodes[0];

            if (current) this.reveal_node(current);

            return;
        }

        if (!node) return;

        if (event.key === " ") {
            event.preventDefault();
            event.stopPropagation();

            if (event.shiftKey && this.selection_anchor) {
                const ids = this.geometry.nodes.map((value) => value.item.id);
                const first = ids.indexOf(this.selection_anchor);
                const last = ids.indexOf(node.item.id);

                for (const item_id of ids.slice(
                    Math.max(
                        0,
                        Math.min(
                            first,
                            last,
                        ),
                    ),
                    Math.max(
                        first,
                        last,
                    ) + 1,
                )) this.bindings.selected.add(item_id);
            } else {
                if (this.bindings.selected.has(node.item.id)) this.bindings.selected.delete(node.item.id); else this.bindings.selected.add(node.item.id);

                this.selection_anchor = node.item.id;
            }

            this.bindings.on_selection();
            this.update_selection();

            return;
        }

        if (!event.key.startsWith("Arrow")) return;

        event.preventDefault();
        event.stopPropagation();
        const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        const handle = target.closest<HTMLElement>("[data-canvas-handle]")?.dataset.canvasHandle;

        if (handle || event.ctrlKey || event.metaKey) {
            const step = this.grid_size() * (event.shiftKey && !event.ctrlKey && !event.metaKey ? 4 : 1);
            const should_resize = handle === "resize" || Boolean((event.ctrlKey || event.metaKey) && event.shiftKey);
            const ids = should_resize ? [node.item.id] : this.bindings.selected.has(node.item.id) ? [...this.bindings.selected] : [node.item.id];
            const updates = new Map<
                string,
                CanvasFrame
            >();

            for (const item_id of ids) {
                const frame = this.geometry.by_id.get(item_id)?.frame;

                if (!frame) continue;

                updates.set(
                    item_id,
                    should_resize ? {
                        ...frame,
                        width: Math.max(
                            220,
                            Math.min(
                                1600,
                                frame.width + horizontal * step,
                            ),
                        ),
                        height: Math.max(
                            120,
                            Math.min(
                                1600,
                                frame.height + vertical * step,
                            ),
                        ),
                    } : {
                        ...frame,
                        x: frame.x + horizontal * step,
                        y: frame.y + vertical * step,
                    },
                );
            }

            this.commit_frames(updates);

            return;
        }

        const center_x = node.frame.x + node.frame.width / 2;
        const center_y = node.frame.y + node.frame.height / 2;

        const nearest = this.geometry.nodes.filter((candidate) => {
            const x = candidate.frame.x + candidate.frame.width / 2 - center_x;
            const y = candidate.frame.y + candidate.frame.height / 2 - center_y;

            return candidate.item.id !== node.item.id && (horizontal ? x * horizontal > 0 : y * vertical > 0);
        }).sort((
            left,
            right,
        ) => {
            const score = (candidate: CanvasNode): number => {
                const x = candidate.frame.x + candidate.frame.width / 2 - center_x;
                const y = candidate.frame.y + candidate.frame.height / 2 - center_y;

                return Math.hypot(
                    x,
                    y,
                ) + Math.abs(horizontal ? y : x) * 2;
            };

            return score(left) - score(right);
        })[0];

        if (nearest) this.reveal_node(nearest);
    }

    private reveal_node(
        node: CanvasNode,
        should_focus = true,
        minimum_zoom = 0.35,
    ): void {
        if (should_focus) this.focused_id = node.item.id;

        this.camera = fit_camera(
            node.frame,
            this.element.clientWidth || 800,
            this.element.clientHeight || 500,
        );

        this.camera.zoom = Math.max(
            minimum_zoom,
            Math.min(
                1,
                this.camera.zoom,
            ),
        );

        this.camera.x = (this.element.clientWidth || 800) / 2 - (node.frame.x + node.frame.width / 2) * this.camera.zoom;
        this.camera.y = (this.element.clientHeight || 500) / 2 - (node.frame.y + node.frame.height / 2) * this.camera.zoom;
        this.persist_camera();
        this.render();

        if (should_focus) this.mounted.get(node.item.id)?.title.focus({ preventScroll: true });
    }

    private reveal_at(
        client_x: number,
        client_y: number,
    ): void {
        const bounds = this.element.getBoundingClientRect();
        const x = (client_x - bounds.left - this.camera.x) / this.camera.zoom;
        const y = (client_y - bounds.top - this.camera.y) / this.camera.zoom;
        const tolerance = 24 / this.camera.zoom;

        const candidates = this.geometry.index.query({
            x: x - tolerance,
            y: y - tolerance,
            width: tolerance * 2,
            height: tolerance * 2,
        });

        const nearest = candidates.sort((
            left,
            right,
        ) => Math.hypot(
            left.frame.x + left.frame.width / 2 - x,
            left.frame.y + left.frame.height / 2 - y,
        ) - Math.hypot(
            right.frame.x + right.frame.width / 2 - x,
            right.frame.y + right.frame.height / 2 - y,
        ))[0];

        if (nearest) this.reveal_node(nearest);
        else this.zoom_at(
            client_x - bounds.left,
            client_y - bounds.top,
            2,
        );
    }

    private paint_guides(): void {
        const bounds = this.view_bounds();
        for (let index = 0; index < Math.max(
            this.guide_values.length,
            this.guide_pool.length,
        ); index++) {
            const guide = this.guide_values[index];
            let line = this.guide_pool[index];
            if (!guide) {
                if (line) line.hidden = true;
                continue;
            }
            if (!line) {
                line = this.guides.element.ownerDocument.createElement("div");
                this.guide_pool.push(line);
                this.guides.element.append(line);
            }
            line.hidden = false;
            line.className = `beautiful_inbox_alignment_guide is_${guide.axis}`;
            if (guide.axis === "x") {
                line.style.left = `${guide.value}px`;
                line.style.top = `${bounds.y}px`;
                line.style.height = `${bounds.height}px`;
                line.style.width = "";
                line.style.borderLeftWidth = `${1 / this.camera.zoom}px`;
                line.style.borderTopWidth = "";
            } else {
                line.style.top = `${guide.value}px`;
                line.style.left = `${bounds.x}px`;
                line.style.width = `${bounds.width}px`;
                line.style.height = "";
                line.style.borderTopWidth = `${1 / this.camera.zoom}px`;
                line.style.borderLeftWidth = "";
            }
        }
    }

    private open_geometry_dialog(id: string): void {
        const node = this.geometry.by_id.get(id);

        if (!node) return;

        const values = { ...node.frame };

        const modal = new BeautifulModal(
            this.host.app,
            "Card position and size",
            (surface) => {
                const fields = surface.create_region("beautiful_inbox_item_fields");

                for (const key of ["x", "y", "width", "height"] as const) {
                    const input = create_text_input(
                        fields,
                        {
                            label: key,
                            value: String(values[key]),
                            on_change: (value) => { values[key] = Number(value); },
                        },
                    );

                    input.inputEl.type = "number";
                    input.inputEl.step = String(this.grid_size());

                    if (key === "width" || key === "height") {
                        input.inputEl.min = key === "width" ? "220" : "120";
                        input.inputEl.max = "1600";
                    }
                }

                const feedback = create_feedback(
                    surface,
                    {
                        state: "info",
                        message: "Coordinates and dimensions use canvas units. This changes the view layout, not the note.",
                    },
                );

                create_button(
                    surface,
                    {
                        label: "Apply",
                        is_primary: true,
                        on_click: () => {
                            if (!Object.values(values).every(Number.isFinite) || values.width < 220 || values.height < 120 || values.width > 1600 || values.height > 1600) {
                                feedback.element.textContent = "Choose finite coordinates, width 220–1600, and height 120–1600.";

                                return;
                            }

                            this.commit_frames(new Map([[id, values]]));
                            modal.close();
                        },
                    },
                );
            },
        );

        this.host.own_modal?.(modal);
        modal.open();
    }
}
