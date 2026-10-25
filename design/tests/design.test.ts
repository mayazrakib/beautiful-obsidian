import { Component } from "obsidian";
import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    BeautifulModal,
    create_button,
    create_detail_section,
    create_dropdown,
    create_empty_state,
    create_feedback,
    create_icon_button,
    create_menu,
    create_record_row,
    create_setting_row,
    create_surface,
    create_text_input,
    create_toggle,
    create_toolbar,
} from "../src/index";

const OWNERS: Component[] = [];

function create_fixture() {
    const owner = new Component();
    owner.load();
    OWNERS.push(owner);

    const container = document.createElement("div");
    document.body.append(container);

    return {
        owner,
        container,
        surface: create_surface(
            owner,
            container,
        ),
    };
}

afterEach(() => {
    for (const owner of OWNERS.splice(0)) {
        owner.unload();
    }

    document.body.replaceChildren();
});

describe(
    "Native control contracts",
    () => {
        it(
            "preserves ordinary button defaults and dispatches actions",
            () => {
                const { surface } = create_fixture();
                const on_click = vi.fn();

                const button = create_button(
                    surface,
                    {
                        label: "Capture",
                        on_click,
                    },
                );

                button.buttonEl.click();
                expect(on_click).toHaveBeenCalledOnce();
                expect(button.buttonEl.classList.contains("mod-cta")).toBe(false);
                expect(button.buttonEl.disabled).toBe(false);
            },
        );

        it(
            "rejects unnamed controls before attaching DOM",
            () => {
                const { surface } = create_fixture();

                expect(() => create_icon_button(
                    surface,
                    {
                        label: " ",
                        icon: "plus",
                        on_click: vi.fn(),
                    },
                )).toThrow("accessible label");

                expect(() => create_text_input(
                    surface,
                    {
                        label: "",
                        on_change: vi.fn(),
                    },
                )).toThrow("accessible label");

                expect(surface.element.childElementCount).toBe(0);
            },
        );

        it(
            "provides keyboard activation and disabled semantics for icon controls",
            () => {
                const { surface } = create_fixture();
                const on_click = vi.fn();

                const button = create_icon_button(
                    surface,
                    {
                        label: "Add item",
                        icon: "plus",
                        on_click,
                    },
                );

                expect(button.extraSettingsEl.getAttribute("aria-label")).toBe("Add item");
                expect(button.extraSettingsEl.tabIndex).toBe(0);

                button.extraSettingsEl.dispatchEvent(new KeyboardEvent(
                    "keydown",
                    { key: "Enter" },
                ));

                button.extraSettingsEl.dispatchEvent(new KeyboardEvent(
                    "keydown",
                    { key: " " },
                ));

                expect(on_click).toHaveBeenCalledTimes(2);
                button.setDisabled(true);
        expect(button.extraSettingsEl.getAttribute("aria-disabled")).toBe("true");

                button.extraSettingsEl.dispatchEvent(new KeyboardEvent(
                    "keydown",
                    { key: "Enter" },
                ));

                expect(on_click).toHaveBeenCalledTimes(2);
            },
        );

        it(
            "labels inputs and forwards text, dropdown, and toggle values",
            () => {
                const { surface } = create_fixture();
                const on_text = vi.fn();
                const on_dropdown = vi.fn();
                const on_toggle = vi.fn();

                const input = create_text_input(
                    surface,
                    {
                        label: "Search",
                        on_change: on_text,
                    },
                );

                const dropdown = create_dropdown(
                    surface,
                    {
                        label: "Filter",
                        value: "all",
                        options: {
                            all: "All",
                            open: "Open",
                        },
                        on_change: on_dropdown,
                    },
                );

                const toggle = create_toggle(
                    surface,
                    {
                        label: "Show completed",
                        value: false,
                        on_change: on_toggle,
                    },
                );

                expect(input.inputEl.getAttribute("aria-label")).toBe("Search");
                expect(dropdown.selectEl.getAttribute("aria-label")).toBe("Filter");
                expect(toggle.toggleEl.getAttribute("aria-label")).toBe("Show completed");
                input.inputEl.value = "Meeting";
                input.inputEl.dispatchEvent(new Event("input"));
                dropdown.selectEl.value = "open";
                dropdown.selectEl.dispatchEvent(new Event("change"));
                toggle.setValue(true);
                toggle.toggleEl.dispatchEvent(new Event("change"));
                expect(on_text).toHaveBeenCalledWith("Meeting");
                expect(on_dropdown).toHaveBeenCalledWith("open");
                expect(on_toggle).toHaveBeenCalledWith(true);
            },
        );

        it(
            "rejects a dropdown selection outside its options",
            () => {
                const { surface } = create_fixture();

                expect(() => create_dropdown(
                    surface,
                    {
                        label: "Filter",
                        value: "missing",
                        options: { all: "All" },
                        on_change: vi.fn(),
                    },
                )).toThrow("available option");

                expect(surface.element.childElementCount).toBe(0);
            },
        );

        it(
            "prevents disabled buttons from invoking actions",
            () => {
                const { surface } = create_fixture();
                const on_click = vi.fn();

                const button = create_button(
                    surface,
                    {
                        label: "Unavailable",
                        is_disabled: true,
                        on_click,
                    },
                );

                button.buttonEl.click();
                expect(on_click).not.toHaveBeenCalled();
            },
        );
    },
);

describe(
    "Surface lifecycle and isolation",
    () => {
        it(
            "releases actions, menus, event listeners, and DOM when its owner unloads",
            () => {
                const { owner, container, surface } = create_fixture();
                const on_click = vi.fn();

                const button = create_button(
                    surface,
                    {
                        label: "Run",
                        on_click,
                    },
                );

                const icon = create_icon_button(
                    surface,
                    {
                        label: "Add",
                        icon: "plus",
                        on_click,
                    },
                );

                const menu = create_menu(
                    surface,
                    [{
                        label: "Run",
                        on_click,
                    }],
                );

                owner.unload();
                button.buttonEl.click();
                icon.extraSettingsEl.click();

                icon.extraSettingsEl.dispatchEvent(new KeyboardEvent(
                    "keydown",
                    { key: "Enter" },
                ));

                expect(on_click).not.toHaveBeenCalled();
                expect(container.childElementCount).toBe(0);

                expect(menu).toHaveProperty(
                    "is_hidden",
                    true,
                );
            },
        );

        it(
            "disposes one surface without affecting another instance",
            () => {
                const first = create_fixture();
                const second = create_fixture();
                const on_click = vi.fn();

                const button = create_button(
                    second.surface,
                    {
                        label: "Keep",
                        on_click,
                    },
                );

                first.surface.dispose();
                button.buttonEl.click();
                expect(on_click).toHaveBeenCalledOnce();
                expect(first.container.childElementCount).toBe(0);
                expect(second.container.childElementCount).toBe(1);
            },
        );
    },
);

describe(
    "Layout patterns",
    () => {
        it(
            "provides a named wrapping group without an unsupported toolbar keyboard contract",
            () => {
                const { surface } = create_fixture();

                const toolbar = create_toolbar(
                    surface,
                    "Task filters",
                );

                expect(toolbar.surface.element.getAttribute("role")).toBe("group");
                expect(toolbar.surface.element.getAttribute("aria-label")).toBe("Task filters");
                expect(toolbar.filters.element.parentElement).toBe(toolbar.surface.element);
                expect(toolbar.actions.element.parentElement).toBe(toolbar.surface.element);
            },
        );

        it(
            "renders record metadata and status as text without interpreting HTML",
            () => {
                const { surface } = create_fixture();

                const row = create_record_row(
                    surface,
                    {
                        title: "<img src=x>",
                        metadata: "Project",
                        status: "Blocked",
                    },
                );

                expect(row.content.element.textContent).toContain("<img src=x>");
                expect(row.content.element.textContent).toContain("Blocked");
                expect(row.content.element.querySelector("img")).toBeNull();
            },
        );

        it(
            "exposes descriptive empty, detail, and setting states",
            () => {
                const { surface } = create_fixture();

                create_empty_state(
                    surface,
                    {
                        title: "Inbox clear",
                        description: "Capture your next idea.",
                    },
                );

                create_detail_section(
                    surface,
                    "Details",
                );

                create_setting_row(
                    surface,
                    {
                        name: "Example",
                        description: "Example description.",
                    },
                );

                expect(surface.element.textContent).toContain("Inbox clear");
                expect(surface.element.textContent).toContain("Capture your next idea.");
                expect(surface.element.querySelectorAll("h3")).toHaveLength(2);
            },
        );

        it.each(["loading", "success", "error", "info"] as const)(
            "announces %s feedback",
            (state) => {
                const { surface } = create_fixture();

                const feedback = create_feedback(
                    surface,
                    {
                        state,
                        message: `${state}: example message`,
                    },
                );

                expect(feedback.element.getAttribute("role")).toBe(state === "error" ? "alert" : "status");
                expect(feedback.element.textContent).toContain(state);
            },
        );
    },
);

describe(
    "Modal lifecycle",
    () => {
        it(
            "cleans old content on close and rebuilds safely on reopen",
            () => {
                const callbacks = vi.fn();

                const modal = new BeautifulModal(
                    {} as App,
                    "Example",
                    (surface) => {
                        create_button(
                            surface,
                            {
                                label: "Run",
                                on_click: callbacks,
                            },
                        );
                    },
                );

                modal.open();

                const old_button = modal.contentEl.querySelector("button");
                modal.close();
                old_button?.click();
                expect(callbacks).not.toHaveBeenCalled();
                expect(modal.contentEl.childElementCount).toBe(0);
                modal.open();
                expect(modal.contentEl.querySelectorAll("button")).toHaveLength(1);
                modal.close();
            },
        );

        it(
            "cleans partially rendered content if rendering fails",
            () => {
                const modal = new BeautifulModal(
                    {} as App,
                    "Example",
                    (surface) => {
                        create_button(
                            surface,
                            {
                                label: "Partial",
                                on_click: vi.fn(),
                            },
                        );

                        throw new Error("Rendering failed.");
                    },
                );

                expect(() => modal.open()).toThrow("Rendering failed.");
                expect(modal.contentEl.childElementCount).toBe(0);
            },
        );
    },
);
