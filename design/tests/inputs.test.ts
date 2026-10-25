import { Component } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { create_card, create_checkbox, create_surface, create_text_area } from "../src/index";

describe(
    "Shared Inbox presentation additions",
    () => {
        it(
            "names multiline inputs and forwards edits until their owner unloads",
            () => {
                const owner = new Component();
                owner.load();
                const container = document.createElement("div");

                const surface = create_surface(
                    owner,
                    container,
                );

                const on_change = vi.fn();

                const input = create_text_area(
                    surface,
                    {
                        label: "Capture details",
                        rows: 5,
                        on_change,
                    },
                );

                expect(input.inputEl.getAttribute("aria-label")).toBe("Capture details");
                expect(input.inputEl.rows).toBe(5);
                input.inputEl.value = "A thought";
                input.inputEl.dispatchEvent(new Event("input"));
                expect(on_change).toHaveBeenCalledWith("A thought");
                owner.unload();
                input.inputEl.value = "Detached";
                input.inputEl.dispatchEvent(new Event("input"));
                expect(on_change).toHaveBeenCalledTimes(1);
                expect(container.childElementCount).toBe(0);
            },
        );

        it(
            "uses native checkbox semantics and releases its change listener",
            () => {
                const owner = new Component();
                owner.load();
                const container = document.createElement("div");
                document.body.append(container);

                const surface = create_surface(
                    owner,
                    container,
                );

                const on_change = vi.fn();

                const checkbox = create_checkbox(
                    surface,
                    {
                        label: "Select capture",
                        value: false,
                        on_change,
                    },
                );

                expect(checkbox.type).toBe("checkbox");
                expect(checkbox.getAttribute("aria-label")).toBe("Select capture");
                checkbox.click();
                expect(on_change).toHaveBeenCalledWith(true);
                owner.unload();
                checkbox.click();
                expect(on_change).toHaveBeenCalledTimes(1);
                container.remove();
            },
        );

        it(
            "owns card content and actions independently of another instance",
            () => {
                const owner = new Component();
                owner.load();

                const surface = create_surface(
                    owner,
                    document.createElement("div"),
                );

                const first = create_card(
                    surface,
                    "First capture",
                );

                const second = create_card(
                    surface,
                    "Second capture",
                );

                expect(first.surface.element.getAttribute("aria-label")).toBe("First capture");
                expect(first.content.element.parentElement).toBe(first.surface.element);
                first.surface.dispose();
                expect(second.surface.element.parentElement).toBe(surface.element);
                owner.unload();
            },
        );
    },
);
