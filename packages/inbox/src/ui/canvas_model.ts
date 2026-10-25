import type { InboxItem } from "../contracts";

export interface CanvasFrame {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CanvasCamera {
    x: number;
    y: number;
    zoom: number;
}

export interface CanvasNode {
    item: InboxItem;
    frame: CanvasFrame;
    group_key: string;
    group_label: string;
}

export interface CanvasGroup {
    key: string;
    label: string;
    items: InboxItem[];
}

export interface CanvasGeometry {
    nodes: CanvasNode[];
    bounds: CanvasFrame;
    groups: { key: string; label: string; frame: CanvasFrame }[];
    by_id: Map<
        string,
        CanvasNode
    >;
    index: CanvasSpatialIndex;
}

interface SnapGuide {
    axis: "x" | "y";
    value: number;
}

interface AxisSnap {
    delta: number;
    value?: number;
}

const COORDINATE_LIMIT = 10_000_000;
const MINIMUM_WIDTH = 220;
const MINIMUM_HEIGHT = 120;
const MAXIMUM_SIZE = 1600;
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 200;
const CELL_SIZE = 512;
const MAXIMUM_NODE_CELLS = 64;
const MAXIMUM_QUERY_CELLS = 4096;
const MAXIMUM_LAYOUT_ENTRIES = 10_000;
const CANVAS_PADDING = 32;
const CARD_GAP = 32;
const GROUP_GAP = 64;
const GROUP_LABEL_HEIGHT = 32;
const MINIMUM_ZOOM = 0.0001;
const MAXIMUM_ZOOM = 2;
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function clamp_number(
    value: number,
    minimum: number,
    maximum: number,
): number {
    return Math.min(
        maximum,
        Math.max(
            minimum,
            value,
        ),
    );
}

function is_finite_frame(value: unknown): value is CanvasFrame {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const frame = value as Record<
        string,
        unknown
    >;

    return ["x", "y", "width", "height"].every((key) => typeof frame[key] === "number" && Number.isFinite(frame[key]));
}

function normalize_frame(frame: CanvasFrame): CanvasFrame {
    return {
        x: clamp_number(
            Number.isFinite(frame.x) ? frame.x : 0,
            -COORDINATE_LIMIT,
            COORDINATE_LIMIT,
        ),
        y: clamp_number(
            Number.isFinite(frame.y) ? frame.y : 0,
            -COORDINATE_LIMIT,
            COORDINATE_LIMIT,
        ),
        width: clamp_number(
            Number.isFinite(frame.width) ? frame.width : DEFAULT_WIDTH,
            MINIMUM_WIDTH,
            MAXIMUM_SIZE,
        ),
        height: clamp_number(
            Number.isFinite(frame.height) ? frame.height : DEFAULT_HEIGHT,
            MINIMUM_HEIGHT,
            MAXIMUM_SIZE,
        ),
    };
}

function is_safe_id(id: string): boolean {
    return id.length > 0 && id.length <= 256 && !UNSAFE_KEYS.has(id);
}

export function parse_canvas_layout(value: unknown): Map<
    string,
    CanvasFrame
> {
    const layout = new Map<
        string,
        CanvasFrame
    >();

    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return layout;
    }

    const document = value as Record<
        string,
        unknown
    >;

    if (document.version !== 1 || !document.cards || typeof document.cards !== "object" || Array.isArray(document.cards)) {
        return layout;
    }

    let inspected = 0;

    for (const id in document.cards) {
        if (!Object.prototype.hasOwnProperty.call(
            document.cards,
            id,
        )) {
            continue;
        }

        if (inspected++ >= MAXIMUM_LAYOUT_ENTRIES) {
            break;
        }

        const frame = (document.cards as Record<
            string,
            unknown
        >)[id];

        if (is_safe_id(id) && is_finite_frame(frame)) {
            layout.set(
                id,
                normalize_frame(frame),
            );
        }
    }

    return layout;
}

export function serialize_canvas_layout(layout: ReadonlyMap<
    string,
    CanvasFrame
>): {
    version: 1; cards: Record<
        string,
        CanvasFrame
    >
} {
    const cards = Object.create(null) as Record<
        string,
        CanvasFrame
    >;

    for (const [id, frame] of [...layout].sort((
        [first],
        [second],
    ) => first.localeCompare(second))) {
        if (is_safe_id(id) && is_finite_frame(frame)) {
            cards[id] = normalize_frame(frame);
        }
    }

    return {
        version: 1,
        cards,
    };
}

function does_intersect(
    first: CanvasFrame,
    second: CanvasFrame,
): boolean {
    return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

function get_cell_bounds(frame: CanvasFrame): { left: number; top: number; right: number; bottom: number; count: number } {
    const left = Math.floor(frame.x / CELL_SIZE);
    const top = Math.floor(frame.y / CELL_SIZE);
    const right = Math.floor((frame.x + frame.width) / CELL_SIZE);
    const bottom = Math.floor((frame.y + frame.height) / CELL_SIZE);

    const count = [left, top, right, bottom].every(Number.isSafeInteger) ? (right - left + 1) * (bottom - top + 1) : Infinity;

    return {
        left,
        top,
        right,
        bottom,
        count,
    };
}

export class CanvasSpatialIndex {
    private readonly cells = new Map<
        string,
        CanvasNode[]
    >();
    private readonly nodes: CanvasNode[] = [];
    private readonly broad_nodes: CanvasNode[] = [];
    private readonly order = new Map<
        CanvasNode,
        number
    >();

    constructor(nodes: readonly CanvasNode[]) {
        const seen = new Set<string>();

        for (const node of nodes) {
            if (seen.has(node.item.id) || !is_finite_frame(node.frame) || node.frame.width <= 0 || node.frame.height <= 0) {
                continue;
            }

            seen.add(node.item.id);
            this.order.set(
                node,
                this.nodes.length,
            );
            this.nodes.push(node);
            const bounds = get_cell_bounds(node.frame);

            if (bounds.count > MAXIMUM_NODE_CELLS) {
                this.broad_nodes.push(node);
                continue;
            }

            for (let cell_y = bounds.top; cell_y <= bounds.bottom; cell_y++) {
                for (let cell_x = bounds.left; cell_x <= bounds.right; cell_x++) {
                    const key = `${cell_x}:${cell_y}`;
                    const bucket = this.cells.get(key) ?? [];
                    bucket.push(node);
                    this.cells.set(
                        key,
                        bucket,
                    );
                }
            }
        }
    }

    query(rectangle: CanvasFrame): CanvasNode[] {
        if (!is_finite_frame(rectangle) || rectangle.width <= 0 || rectangle.height <= 0) {
            return [];
        }

        const bounds = get_cell_bounds(rectangle);

        if (bounds.count > MAXIMUM_QUERY_CELLS) {
            return this.nodes.filter((node) => does_intersect(
                node.frame,
                rectangle,
            ));
        }

        const candidates = new Set(this.broad_nodes);

        for (let cell_y = bounds.top; cell_y <= bounds.bottom; cell_y++) {
            for (let cell_x = bounds.left; cell_x <= bounds.right; cell_x++) {
                for (const node of this.cells.get(`${cell_x}:${cell_y}`) ?? []) {
                    candidates.add(node);
                }
            }
        }

        return [...candidates].filter((node) => does_intersect(
            node.frame,
            rectangle,
        )).sort((
            first,
            second,
        ) => (this.order.get(first) ?? 0) - (this.order.get(second) ?? 0));
    }
}

function get_bounds(frames: readonly CanvasFrame[]): CanvasFrame {
    if (!frames.length) {
        return {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        };
    }

    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    for (const frame of frames) {
        left = Math.min(
            left,
            frame.x,
        );
        top = Math.min(
            top,
            frame.y,
        );
        right = Math.max(
            right,
            frame.x + frame.width,
        );
        bottom = Math.max(
            bottom,
            frame.y + frame.height,
        );
    }

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    };
}

export function create_canvas_geometry(
    groups: readonly CanvasGroup[],
    overrides: ReadonlyMap<
        string,
        CanvasFrame
    >,
    columns: number,
    default_width = DEFAULT_WIDTH,
    default_height = DEFAULT_HEIGHT,
): CanvasGeometry {
    const defaults = normalize_frame({
        x: 0,
        y: 0,
        width: default_width,
        height: default_height,
    });
    const block_height = Math.max(
        1,
        Math.floor((COORDINATE_LIMIT - CANVAS_PADDING - defaults.height) / (defaults.height + CARD_GAP)),
    ) * (defaults.height + CARD_GAP);
    const column_count = Number.isFinite(columns) ? clamp_number(
        Math.floor(columns),
        1,
        32,
    ) : 3;
    const manual_nodes: CanvasNode[] = [];
    const seen_manual = new Set<string>();

    for (const group of groups) {
        for (const item of group.items) {
            const frame = overrides.get(item.id);

            if (frame && is_finite_frame(frame) && !seen_manual.has(item.id)) {
                seen_manual.add(item.id);
                manual_nodes.push({
                    item,
                    frame: normalize_frame(frame),
                    group_key: group.key,
                    group_label: group.label,
                });
            }
        }
    }

    const manual_index = new CanvasSpatialIndex(manual_nodes);
    const manual_by_id = new Map(manual_nodes.map((node) => [node.item.id, node]));
    const nodes: CanvasNode[] = [];
    const by_id = new Map<
        string,
        CanvasNode
    >();
    const group_regions: CanvasGeometry["groups"] = [];
    let group_top = CANVAS_PADDING;

    for (const group of groups) {
        const group_nodes: CanvasNode[] = [];
        const label_height = group.label ? GROUP_LABEL_HEIGHT : 0;
        let slot = 0;

        for (const item of group.items) {
            if (by_id.has(item.id)) {
                continue;
            }

            let node = manual_by_id.get(item.id);

            if (!node) {
                let frame: CanvasFrame;

                do {
                    const natural_y = group_top + label_height + Math.floor(slot / column_count) * (defaults.height + CARD_GAP);
                    const block = Math.floor((natural_y - CANVAS_PADDING) / block_height);

                    frame = {
                        x: CANVAS_PADDING + ((slot % column_count) + block * column_count) * (defaults.width + CARD_GAP),
                        y: CANVAS_PADDING + (natural_y - CANVAS_PADDING) % block_height,
                        width: defaults.width,
                        height: defaults.height,
                    };
                    slot++;
                } while (manual_index.query(frame).length > 0);

                node = {
                    item,
                    frame,
                    group_key: group.key,
                    group_label: group.label,
                };
            } else {
                slot++;
            }

            nodes.push(node);
            group_nodes.push(node);
            by_id.set(
                item.id,
                node,
            );
        }

        if (group_nodes.length) {
            const bounds = get_bounds(group_nodes.map((node) => node.frame));
            group_regions.push({
                key: group.key,
                label: group.label,
                frame: {
                    x: bounds.x,
                    y: bounds.y - label_height,
                    width: bounds.width,
                    height: bounds.height + label_height,
                },
            });
            group_top += label_height + Math.max(
                1,
                Math.ceil(slot / column_count),
            ) * (defaults.height + CARD_GAP) + GROUP_GAP;
        }
    }

    return {
        nodes,
        bounds: get_bounds(group_regions.map((group) => group.frame)),
        groups: group_regions,
        by_id,
        index: new CanvasSpatialIndex(nodes),
    };
}

function find_axis_snap(
    anchors: readonly number[],
    targets: readonly number[],
    threshold: number,
    grid_delta: number,
    has_grid: boolean,
): AxisSnap {
    let best: AxisSnap = { delta: grid_delta };
    let nearest = has_grid ? Math.abs(grid_delta) : Infinity;

    for (const anchor of anchors) {
        for (const value of targets) {
            const delta = value - anchor;
            const distance = Math.abs(delta);

            if (distance <= threshold && distance <= nearest) {
                nearest = distance;
                best = {
                    delta,
                    value,
                };
            }
        }
    }

    return best;
}

export function snap_frame(
    frame: CanvasFrame,
    other_frames: readonly CanvasFrame[],
    grid_size: number,
    threshold_world: number,
    is_resize = false,
): { frame: CanvasFrame; guides: SnapGuide[] } {
    const normalized = normalize_frame(frame);
    const grid = Number.isFinite(grid_size) && grid_size > 0 ? grid_size : 0;
    const threshold = Number.isFinite(threshold_world) ? Math.max(
        0,
        threshold_world,
    ) : 0;
    const horizontal_targets: number[] = [];
    const vertical_targets: number[] = [];

    for (const other of other_frames) {
        if (is_finite_frame(other) && other.width > 0 && other.height > 0) {
            horizontal_targets.push(
                other.x,
                other.x + other.width / 2,
                other.x + other.width,
            );
            vertical_targets.push(
                other.y,
                other.y + other.height / 2,
                other.y + other.height,
            );
        }
    }

    const horizontal_anchors = is_resize ? [normalized.x + normalized.width] : [normalized.x, normalized.x + normalized.width / 2, normalized.x + normalized.width];
    const vertical_anchors = is_resize ? [normalized.y + normalized.height] : [normalized.y, normalized.y + normalized.height / 2, normalized.y + normalized.height];
    const grid_x_anchor = is_resize ? normalized.x + normalized.width : normalized.x;
    const grid_y_anchor = is_resize ? normalized.y + normalized.height : normalized.y;
    const grid_x_delta = grid ? Math.round(grid_x_anchor / grid) * grid - grid_x_anchor : 0;
    const grid_y_delta = grid ? Math.round(grid_y_anchor / grid) * grid - grid_y_anchor : 0;
    const horizontal = find_axis_snap(
        horizontal_anchors,
        horizontal_targets,
        threshold,
        grid_x_delta,
        grid > 0,
    );
    const vertical = find_axis_snap(
        vertical_anchors,
        vertical_targets,
        threshold,
        grid_y_delta,
        grid > 0,
    );
    const snapped = normalize_frame({
        x: normalized.x + (is_resize ? 0 : horizontal.delta),
        y: normalized.y + (is_resize ? 0 : vertical.delta),
        width: normalized.width + (is_resize ? horizontal.delta : 0),
        height: normalized.height + (is_resize ? vertical.delta : 0),
    });
    const guides: SnapGuide[] = [];
    const applied_x = is_resize ? snapped.width - normalized.width : snapped.x - normalized.x;
    const applied_y = is_resize ? snapped.height - normalized.height : snapped.y - normalized.y;

    if (horizontal.value !== undefined && Math.abs(applied_x - horizontal.delta) < 0.001) {
        guides.push({
            axis: "x",
            value: horizontal.value,
        });
    }

    if (vertical.value !== undefined && Math.abs(applied_y - vertical.delta) < 0.001) {
        guides.push({
            axis: "y",
            value: vertical.value,
        });
    }

    return {
        frame: snapped,
        guides,
    };
}

export function fit_camera(
    bounds: CanvasFrame,
    viewport_width: number,
    viewport_height: number,
): CanvasCamera {
    if (!is_finite_frame(bounds) || bounds.width <= 0 || bounds.height <= 0 || !Number.isFinite(viewport_width) || !Number.isFinite(viewport_height) || viewport_width <= 0 || viewport_height <= 0) {
        return {
            x: CANVAS_PADDING,
            y: CANVAS_PADDING,
            zoom: 1,
        };
    }

    const available_width = Math.max(
        1,
        viewport_width - CANVAS_PADDING * 2,
    );
    const available_height = Math.max(
        1,
        viewport_height - CANVAS_PADDING * 2,
    );
    const zoom = clamp_number(
        Math.min(
            available_width / bounds.width,
            available_height / bounds.height,
        ),
        MINIMUM_ZOOM,
        MAXIMUM_ZOOM,
    );

    return {
        x: (viewport_width - bounds.width * zoom) / 2 - bounds.x * zoom,
        y: (viewport_height - bounds.height * zoom) / 2 - bounds.y * zoom,
        zoom,
    };
}
