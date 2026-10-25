import { describe, expect, it } from "vitest";

import type { InboxItem } from "../src/contracts";
import type { CanvasFrame, CanvasNode } from "../src/ui/canvas_model";

import {
    CanvasSpatialIndex,
    create_canvas_geometry,
    fit_camera,
    parse_canvas_layout,
    serialize_canvas_layout,
    snap_frame,
} from "../src/ui/canvas_model";

function create_item(id: string): InboxItem {
    return {
        id,
        path: `${id}.md`,
        title: id,
        kind: "text",
        status: "unprocessed",
        captured_at: "2026-10-25T00:00:00.000Z",
        tags: [],
        preview: "Preview",
        revision: "revision",
    };
}

function intersects(
    first: CanvasFrame,
    second: CanvasFrame,
): boolean {
    return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

function create_node(
    id: string,
    frame: CanvasFrame,
): CanvasNode {
    return {
        item: create_item(id),
        frame,
        group_key: "all",
        group_label: "All",
    };
}

describe(
    "Canvas persisted layout",
    () => {
        it(
            "validates version, finite frames, safe IDs and bounds without mutating input",
            () => {
                const source = JSON.parse('{"version":1,"cards":{"valid":{"x":20000000,"y":-20000000,"width":1,"height":9000},"__proto__":{"x":0,"y":0,"width":320,"height":200},"invalid":{"x":"1","y":0,"width":320,"height":200}}}') as unknown;
                const original = JSON.stringify(source);
                const layout = parse_canvas_layout(source);
                expect([...layout]).toEqual([["valid", {
                    x: 10_000_000,
                    y: -10_000_000,
                    width: 220,
                    height: 1600,
                }]]);
                expect(JSON.stringify(source)).toBe(original);
                expect(parse_canvas_layout({
                    version: 2,
                    cards: {},
                }).size).toBe(0);
                expect(parse_canvas_layout(null).size).toBe(0);
                expect(parse_canvas_layout({
                    version: 1,
                    cards: {
                        invalid: {
                            x: NaN,
                            y: 0,
                            width: 320,
                            height: 200,
                        }
                    },
                }).size).toBe(0);
            },
        );

        it(
            "limits editable configuration to 10,000 inspected entries",
            () => {
                const cards = Object.fromEntries(Array.from(
                    { length: 10_100 },
                    (
                        _,
                        index,
                    ) => [`id-${index}`, {
                        x: index,
                        y: 0,
                        width: 320,
                        height: 200,
                    }],
                ));
                expect(parse_canvas_layout({
                    version: 1,
                    cards,
                }).size).toBe(10_000);
            },
        );

        it(
            "serializes only explicit overrides into a detached safe dictionary",
            () => {
                const frame = {
                    x: 16,
                    y: 32,
                    width: 320,
                    height: 200,
                };
                const overrides = new Map([["b", frame], ["a", frame], ["__proto__", frame]]);
                const serialized = serialize_canvas_layout(overrides);
                expect(Object.getPrototypeOf(serialized.cards)).toBeNull();
                expect(Object.keys(serialized.cards)).toEqual(["a", "b"]);
                expect(parse_canvas_layout(JSON.parse(JSON.stringify(serialized)))).toEqual(new Map([["a", frame], ["b", frame]]));
                expect(serialized.cards.a).not.toBe(frame);
                expect(overrides.size).toBe(3);
            },
        );
    },
);

describe(
    "Canvas automatic geometry",
    () => {
        it(
            "preserves native group order, item order and stable manual identities",
            () => {
                const first = create_item("first");
                const second = create_item("second");
                const third = create_item("third");
                const manual = {
                    x: -900,
                    y: -500,
                    width: 420,
                    height: 280,
                };
                const overrides = new Map([[second.id, manual]]);
                const groups = [{
                    key: "one",
                    label: "One",
                    items: [first, second],
                }, {
                    key: "two",
                    label: "Two",
                    items: [third],
                }];
                const geometry = create_canvas_geometry(
                    groups,
                    overrides,
                    2,
                );
                expect(geometry.nodes.map((node) => node.item.id)).toEqual(["first", "second", "third"]);
                expect(geometry.by_id.get(second.id)?.frame).toEqual(manual);
                expect(geometry.by_id.get(second.id)?.group_key).toBe("one");
                expect(geometry.groups[0]?.frame.y).toBe(-532);
                expect(geometry.bounds.x).toBe(-900);
                second.path = "renamed.md";
                expect(create_canvas_geometry(
                    groups,
                    overrides,
                    2,
                ).by_id.get(second.id)?.frame).toEqual(manual);
                create_canvas_geometry(
                    [{
                        key: "one",
                        label: "One",
                        items: [first],
                    }],
                    overrides,
                    2,
                );
                expect(overrides.get(second.id)).toBe(manual);
            },
        );

        it(
            "reserves manual occupied slots and keeps automatic groups disjoint",
            () => {
                const manual = create_item("manual");
                const geometry = create_canvas_geometry(
                    [
                        {
                            key: "first",
                            label: "First",
                            items: [create_item("auto"), manual],
                        },
                        {
                            key: "second",
                            label: "Second",
                            items: [create_item("next")],
                        },
                    ],
                    new Map([[manual.id, {
                        x: 32,
                        y: 64,
                        width: 320,
                        height: 200,
                    }]]),
                    2,
                );
                expect(geometry.by_id.get("auto")?.frame.x).toBe(384);
                for (const node of geometry.nodes) {
                    for (const other of geometry.nodes) {
                        if (node !== other) {
                            expect(intersects(
                                node.frame,
                                other.frame,
                            )).toBe(false);
                        }
                    }
                }
            },
        );

        it(
            "deduplicates stable IDs and normalizes invalid default dimensions and columns",
            () => {
                const item = create_item("one");
                const geometry = create_canvas_geometry(
                    [{
                        key: "all",
                        label: "",
                        items: [item, item],
                    }],
                    new Map(),
                    NaN,
                    NaN,
                    Infinity,
                );
                expect(geometry.nodes).toHaveLength(1);
                expect(geometry.nodes[0]?.frame).toEqual({
                    x: 32,
                    y: 32,
                    width: 320,
                    height: 200,
                });
                expect(create_canvas_geometry(
                    [],
                    new Map(),
                    3,
                ).bounds).toEqual({
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                });
            },
        );
    },
);

describe(
    "Canvas spatial index",
    () => {
        it(
            "keeps 10,000 maximum-size automatic cards within coordinate bounds without overlap",
            () => {
                const items = Array.from(
                    { length: 10_000 },
                    (
                        _,
                        index,
                    ) => create_item(`item-${index}`),
                );
                const geometry = create_canvas_geometry(
                    [{
                        key: "all",
                        label: "All",
                        items,
                    }],
                    new Map(),
                    1,
                    1600,
                    1600,
                );
                for (const node of geometry.nodes) {
                    expect(Math.abs(node.frame.x)).toBeLessThanOrEqual(10_000_000);
                    expect(Math.abs(node.frame.y)).toBeLessThanOrEqual(10_000_000);
                    expect(geometry.index.query(node.frame)).toEqual([node]);
                }
            },
        );

        it(
            "matches brute force for 10,000 cards and repeated viewport queries",
            () => {
                const items = Array.from(
                    { length: 10_000 },
                    (
                        _,
                        index,
                    ) => create_item(`item-${index}`),
                );
                const geometry = create_canvas_geometry(
                    [{
                        key: "all",
                        label: "All",
                        items,
                    }],
                    new Map(),
                    8,
                );
                const started = performance.now();
                let maximum_visible = 0;
                for (let index = 0; index < 200; index++) {
                    const rectangle = {
                        x: -50 + index % 7 * 200,
                        y: index * 1300,
                        width: 1200,
                        height: 900,
                    };
                    const visible = geometry.index.query(rectangle);
                    expect(visible).toEqual(geometry.nodes.filter((node) => intersects(
                        node.frame,
                        rectangle,
                    )));
                    maximum_visible = Math.max(
                        maximum_visible,
                        visible.length,
                    );
                }
                expect(maximum_visible).toBeLessThan(30);
                expect(performance.now() - started).toBeLessThan(3000);
            },
        );

        it(
            "handles negative cells, boundaries, enormous cards and enormous queries without cell explosions",
            () => {
                const ordinary = create_node(
                    "ordinary",
                    {
                        x: -320,
                        y: -200,
                        width: 320,
                        height: 200,
                    },
                );
                const giant = create_node(
                    "giant",
                    {
                        x: -1e12,
                        y: -1e12,
                        width: 2e12,
                        height: 2e12,
                    },
                );
                const extreme = create_node(
                    "extreme",
                    {
                        x: 1e308,
                        y: 1e308,
                        width: 1e308,
                        height: 1e308,
                    },
                );
                const index = new CanvasSpatialIndex([ordinary, giant, extreme, ordinary]);
                expect(index.query({
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                }).map((node) => node.item.id)).toEqual(["giant"]);
                expect(index.query({
                    x: -400,
                    y: -300,
                    width: 200,
                    height: 200,
                }).map((node) => node.item.id)).toEqual(["ordinary", "giant"]);
                expect(index.query({
                    x: -1e13,
                    y: -1e13,
                    width: 2e13,
                    height: 2e13,
                })).toHaveLength(2);
                expect(index.query({
                    x: NaN,
                    y: 0,
                    width: 1,
                    height: 1,
                })).toEqual([]);
                expect(index.query({
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 1,
                })).toEqual([]);
            },
        );
    },
);

describe(
    "Canvas snapping and camera",
    () => {
        it(
            "snaps movement to the grid and closer card edges without mutating persisted state",
            () => {
                const original = {
                    x: 17,
                    y: 35,
                    width: 320,
                    height: 200,
                };
                expect(snap_frame(
                    original,
                    [],
                    16,
                    8,
                ).frame).toEqual({
                    ...original,
                    x: 16,
                    y: 32,
                });
                const guided = snap_frame(
                    original,
                    [{
                        x: 18,
                        y: 36,
                        width: 320,
                        height: 200,
                    }],
                    0,
                    8,
                );
                expect(guided.frame).toEqual({
                    ...original,
                    x: 18,
                    y: 36,
                });
                expect(guided.guides).toEqual([{
                    axis: "x",
                    value: 338,
                }, {
                    axis: "y",
                    value: 236,
                }]);
                expect(original).toEqual({
                    x: 17,
                    y: 35,
                    width: 320,
                    height: 200,
                });
                expect(snap_frame(
                    original,
                    [{
                        x: 1000,
                        y: 1000,
                        width: 320,
                        height: 200,
                    }],
                    0,
                    8,
                ).frame).toEqual(original);
            },
        );

        it(
            "resizes from a fixed origin with grid, limits and valid guides",
            () => {
                const original = {
                    x: 32,
                    y: 48,
                    width: 323,
                    height: 203,
                };
                expect(snap_frame(
                    original,
                    [],
                    16,
                    8,
                    true,
                ).frame).toEqual({
                    x: 32,
                    y: 48,
                    width: 320,
                    height: 208,
                });
                const normalized = snap_frame(
                    {
                        x: 2e7,
                        y: -2e7,
                        width: 1,
                        height: 9000,
                    },
                    [],
                    0,
                    8,
                    true,
                );
                expect(normalized.frame).toEqual({
                    x: 1e7,
                    y: -1e7,
                    width: 220,
                    height: 1600,
                });
                expect(normalized.guides).toEqual([]);
            },
        );

        it(
            "fits all 10,000 cards with pixel translation and a sufficiently small overview zoom",
            () => {
                const items = Array.from(
                    { length: 10_000 },
                    (
                        _,
                        index,
                    ) => create_item(`item-${index}`),
                );
                const { bounds } = create_canvas_geometry(
                    [{
                        key: "all",
                        label: "All",
                        items,
                    }],
                    new Map(),
                    3,
                );
                const camera = fit_camera(
                    bounds,
                    1200,
                    800,
                );
                expect(camera.zoom).toBeLessThan(0.01);
                expect(camera.zoom).toBeGreaterThanOrEqual(0.0001);
                expect(bounds.x * camera.zoom + camera.x).toBeGreaterThanOrEqual(31.99);
                expect(bounds.y * camera.zoom + camera.y).toBeGreaterThanOrEqual(31.99);
                expect((bounds.x + bounds.width) * camera.zoom + camera.x).toBeLessThanOrEqual(1168.01);
                expect((bounds.y + bounds.height) * camera.zoom + camera.y).toBeLessThanOrEqual(768.01);
            },
        );

        it(
            "uses bounded zoom and deterministic fallback for empty or invalid viewports",
            () => {
                expect(fit_camera(
                    {
                        x: -100,
                        y: -100,
                        width: 10,
                        height: 10,
                    },
                    1200,
                    800,
                ).zoom).toBe(2);
                expect(fit_camera(
                    {
                        x: 0,
                        y: 0,
                        width: 1e12,
                        height: 1e12,
                    },
                    1200,
                    800,
                ).zoom).toBe(0.0001);
                expect(fit_camera(
                    {
                        x: 0,
                        y: 0,
                        width: 0,
                        height: 0,
                    },
                    1200,
                    800,
                )).toEqual({
                    x: 32,
                    y: 32,
                    zoom: 1,
                });
                expect(fit_camera(
                    {
                        x: 0,
                        y: 0,
                        width: 320,
                        height: 200,
                    },
                    NaN,
                    800,
                )).toEqual({
                    x: 32,
                    y: 32,
                    zoom: 1,
                });
            },
        );
    },
);
