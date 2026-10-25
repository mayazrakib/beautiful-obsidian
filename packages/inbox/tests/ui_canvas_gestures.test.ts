import { Component } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { create_surface } from "@beautiful/design";

import type { InboxHost, InboxItem } from "../src/contracts";
import type { CanvasFrame } from "../src/ui/canvas_model";

import { DEFAULT_SETTINGS } from "../src/defaults";
import { InboxCanvas } from "../src/ui/canvas_controller";

vi.mock(
    "obsidian",
    async (load_original) => ({
        ...await load_original<typeof import("obsidian")>(),
        setIcon: vi.fn(),

    }),
);

const OWNERS: Component[] = [];

function create_fixture() {
    const callbacks = new Map<
        number,
        FrameRequestCallback
    >();
    let sequence = 0;
    vi.spyOn(
        window,
        "requestAnimationFrame",
    ).mockImplementation((callback) => {
        callbacks.set(
            ++sequence,
            callback,
        );
        return sequence;
    });
    vi.spyOn(
        window,
        "cancelAnimationFrame",
    ).mockImplementation((id) => { callbacks.delete(id); });
    const item: InboxItem = {
        id: "capture_1",
        path: "Inbox/First.md",
        title: "First capture",
        kind: "text",
        status: "unprocessed",
        captured_at: "2026-10-25T10:00:00Z",
        tags: [],
        preview: "Preview",
        revision: "revision_1",

    };
    const configuration = new Map<
        string,
        unknown
    >();
    const write = vi.fn((
        key: string,
        value: unknown,
    ) => {
        configuration.set(
            key,
            structuredClone(value),
        );
    });
    const listeners = new Map<
        string,
        () => void
    >();
    const workspace = {
        on: vi.fn((
            event: string,
            callback: () => void,
        ) => {
            listeners.set(
                event,
                callback,
            );
            return { event };
        }),
        offref: vi.fn((reference: { event: string }) => { listeners.delete(reference.event); }),

    };
    const host = {
        app: { workspace },
        repository: {
            get_item: () => item,
            list_attachments: async () => [],

        },
        get_settings: () => DEFAULT_SETTINGS,
        notify: vi.fn(),

    } as unknown as InboxHost;
    const owner = new Component();
    owner.load();
    OWNERS.push(owner);
    const container = document.createElement("div");
    document.body.append(container);
    const canvas = new InboxCanvas(
        create_surface(
            owner,
            container,
        ),
        host,
        {
            read: (key) => configuration.get(key),
            write,
            selected: new Set(),
            on_selection: vi.fn(),
            on_open: vi.fn(),

        },
    );
    const captured = new Set<number>();
    Object.assign(
        canvas.element,
        {
            setPointerCapture: (id: number) => { captured.add(id); },
            hasPointerCapture: (id: number) => captured.has(id),
            releasePointerCapture: (id: number) => { captured.delete(id); },

        },
    );
    const flush = () => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) callback(performance.now());
    };
    canvas.set_groups([{
        key: "all",
        label: "",
        items: [item],

    }]);
    flush();
    const card = container.querySelector<HTMLElement>(".beautiful_inbox_item");
    if (!card) throw new Error("Missing mounted capture.");
    const original: CanvasFrame = {
        x: Number.parseFloat(card.style.left),
        y: Number.parseFloat(card.style.top),
        width: Number.parseFloat(card.style.width),
        height: Number.parseFloat(card.style.height),

    };
    const handle = (mode: "move" | "resize") => {
        const element = card.querySelector<HTMLElement>(`[data-canvas-handle="${mode}"]`);
        if (!element) throw new Error("Missing capture handle.");
        return element;
    };
    const saved = () => (configuration.get("beautiful_canvas_layout") as {
        cards: Record<
            string,
            CanvasFrame
        >
    } | undefined)?.cards[item.id];
    return {
        canvas,
        card,
        item,
        host,
        write,
        callbacks,
        flush,
        handle,
        saved,
        original,
        owner,
        configuration,
        workspace,
        emit_theme: () => listeners.get("css-change")?.(),

    };
}

function send_pointer(
    target: HTMLElement,
    type: string,
    x: number,
    y: number,
    should_snap = false,
): void {
    const event = new MouseEvent(
        type,
        {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: x,
            clientY: y,
            shiftKey: should_snap,

        },
    );
    Object.defineProperty(
        event,
        "pointerId",
        { value: 7 },
    );
    target.dispatchEvent(event);
}

afterEach(() => {
    for (const owner of OWNERS.splice(0)) owner.unload();
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe(
    "Canvas pointer integration with mocked Obsidian",
    () => {
        it(
            "coalesces a pointer burst and preserves fractional free-form movement without saving previews",
            () => {
                const fixture = create_fixture();
                send_pointer(
                    fixture.handle("move"),
                    "pointerdown",
                    100,
                    100,
                );
                for (let index = 1; index <= 40; index++) send_pointer(
                    fixture.canvas.element,
                    "pointermove",
                    100 + index + 0.25,
                    111.5,
                );
                expect(fixture.callbacks.size).toBe(1);
                expect(fixture.card.style.transform).toBe("");
                expect(fixture.write).not.toHaveBeenCalled();
                fixture.flush();
                expect(fixture.card.style.transform).toBe("translate3d(40.25px, 11.5px, 0)");
                expect(fixture.card.style.left).toBe(`${fixture.original.x}px`);
                expect(fixture.write).not.toHaveBeenCalled();
                send_pointer(
                    fixture.canvas.element,
                    "pointerup",
                    140.25,
                    111.5,
                );
                expect(fixture.saved()?.x).toBe(fixture.original.x + 40.25);
                expect(fixture.saved()?.y).toBe(fixture.original.y + 11.5);
                expect(fixture.write).toHaveBeenCalledTimes(1);
            },
        );

        it(
            "uses Shift for grid snapping and commits the final pointerup sample without waiting for a frame",
            () => {
                const fixture = create_fixture();
                send_pointer(
                    fixture.handle("move"),
                    "pointerdown",
                    100,
                    100,
                );
                send_pointer(
                    fixture.canvas.element,
                    "pointermove",
                    105,
                    105,
                );
                send_pointer(
                    fixture.canvas.element,
                    "pointerup",
                    129.25,
                    121.5,
                    true,
                );
                expect(fixture.saved()?.x).toBe(64);
                expect(fixture.saved()?.y).toBe(48);
                expect(fixture.card.style.transform).toBe("");
                expect(fixture.write).toHaveBeenCalledTimes(1);
            },
        );

        it(
            "resizes freely and restores both dimensions when Escape cancels",
            () => {
                const fixture = create_fixture();
                send_pointer(
                    fixture.handle("resize"),
                    "pointerdown",
                    100,
                    100,
                );
                send_pointer(
                    fixture.canvas.element,
                    "pointermove",
                    119.25,
                    127.5,
                );
                fixture.flush();
                expect(fixture.card.style.width).toBe(`${fixture.original.width + 19.25}px`);
                expect(fixture.card.style.height).toBe(`${fixture.original.height + 27.5}px`);
                fixture.canvas.element.dispatchEvent(new KeyboardEvent(
                    "keydown",
                    {
                        key: "Escape",
                        bubbles: true,

                    },
                ));
                expect(fixture.card.style.width).toBe(`${fixture.original.width}px`);
                expect(fixture.card.style.height).toBe(`${fixture.original.height}px`);
                expect(fixture.write).not.toHaveBeenCalled();
            },
        );

        it(
            "defers background projection replacement until the active gesture ends",
            () => {
                const fixture = create_fixture();
                send_pointer(
                    fixture.handle("move"),
                    "pointerdown",
                    100,
                    100,
                );
                send_pointer(
                    fixture.canvas.element,
                    "pointermove",
                    117.25,
                    119.5,
                );
                fixture.canvas.set_groups([{
                    key: "all",
                    label: "",
                    items: [{
                        ...fixture.item,
                        title: "Background update",
                        revision: "revision_2",

                    }],

                }]);
                fixture.flush();
                expect(fixture.card.isConnected).toBe(true);
                expect(fixture.card.textContent).toContain("First capture");
                send_pointer(
                    fixture.canvas.element,
                    "pointerup",
                    117.25,
                    119.5,
                );
                fixture.flush();
                expect(fixture.canvas.element.textContent).toContain("Background update");
                expect(fixture.saved()?.x).toBe(fixture.original.x + 17.25);
            },
        );

        it(
            "repaints the overview after live theme changes and removes its subscription on unload",
            () => {
                const context = {
                    setTransform: vi.fn(),
                    clearRect: vi.fn(),
                    fillRect: vi.fn(),
                    fillText: vi.fn(),
                    fillStyle: "",
                    globalAlpha: 1,
                    font: "",
                    textAlign: "",

                };
                vi.spyOn(
                    HTMLCanvasElement.prototype,
                    "getContext",
                ).mockReturnValue(context as unknown as CanvasRenderingContext2D);
                const fixture = create_fixture();
                fixture.canvas.element.style.setProperty(
                    "--text-muted",
                    "rgb(1, 2, 3)",
                );
                fixture.canvas.zoom_by(0.1);
                fixture.flush();
                expect(context.fillStyle).toBe("rgb(1, 2, 3)");
                fixture.canvas.element.style.setProperty(
                    "--text-muted",
                    "rgb(4, 5, 6)",
                );
                fixture.emit_theme();
                expect(fixture.callbacks.size).toBe(1);
                fixture.flush();
                expect(context.fillStyle).toBe("rgb(4, 5, 6)");
                fixture.owner.unload();
                expect(fixture.workspace.offref).toHaveBeenCalledExactlyOnceWith({ event: "css-change" });
                fixture.emit_theme();
                expect(fixture.callbacks.size).toBe(0);
            },
        );

        it(
            "discards a queued movement when the view unloads",
            () => {
                const fixture = create_fixture();
                send_pointer(
                    fixture.handle("move"),
                    "pointerdown",
                    100,
                    100,
                );
                send_pointer(
                    fixture.canvas.element,
                    "pointermove",
                    180,
                    130,
                );
                fixture.owner.unload();
                fixture.flush();
                expect(fixture.write).not.toHaveBeenCalled();
                expect(fixture.canvas.element.isConnected).toBe(false);
            },
        );
    },
);
