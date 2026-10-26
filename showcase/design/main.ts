import { ItemView, Notice, Plugin } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";

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
} from "../../design/src/index";
import type { DesignSurface } from "../../design/src/index";

const VIEW_TYPE = "beautiful_design_gallery";

class GalleryView extends ItemView {
    private surface: DesignSurface | undefined;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Beautiful Design Gallery";
    }

    getIcon(): string {
        return "palette";
    }

    async onOpen(): Promise<void> {
        this.surface?.dispose();

        this.surface = create_surface(
            this,
            this.contentEl,
        );

        const intro = this.contentEl.ownerDocument.createElement("p");
        intro.textContent = "Native Obsidian controls with shared Beautiful layouts. Change themes or pane widths, and use Tab to inspect focus states.";
        this.surface.element.append(intro);
        this.render_controls(this.surface);
        this.render_patterns(this.surface);
    }

    private render_controls(surface: DesignSurface): void {
        const section = create_detail_section(
            surface,
            "Native controls",
        );

        const toolbar = create_toolbar(
            section,
            "Example controls",
        );

        create_button(
            toolbar.actions,
            {
                label: "Default button",
                on_click: () => new Notice("Default action selected."),
            },
        );

        create_button(
            toolbar.actions,
            {
                label: "Primary action",
                is_primary: true,
                on_click: () => new Notice("Primary action selected."),
            },
        );

        create_button(
            toolbar.actions,
            {
                label: "Disabled",
                is_disabled: true,
                on_click: () => { },
            },
        );

        create_icon_button(
            toolbar.actions,
            {
                label: "Open example dialog",
                icon: "panel-top",
                on_click: () => this.open_dialog(),
            },
        );

        const menu = create_menu(
            section,
            [{
                label: "Example menu action",
                icon: "check",
                on_click: () => new Notice("Menu action selected."),
            }],
        );

        const menu_button = create_button(
            toolbar.actions,
            {
                label: "Open menu",
                on_click: () => {
                    const bounds = menu_button.buttonEl.getBoundingClientRect();

                    menu.showAtPosition({
                        x: bounds.left,
                        y: bounds.bottom,
                    });
                },
            },
        );

        create_text_input(
            toolbar.filters,
            {
                label: "Search examples",
                placeholder: "Search examples",
                on_change: () => { },
            },
        );

        create_dropdown(
            toolbar.filters,
            {
                label: "Example filter",
                value: "all",
                options: {
                    all: "All examples",
                    active: "Active examples",
                },
                on_change: () => { },
            },
        );

        create_toggle(
            section,
            {
                label: "Standalone toggle example",
                value: true,
                on_change: () => { },
            },
        );

        create_setting_row(
            section,
            {
                name: "Setting row",
                description: "Uses Obsidian's standard setting layout and controls.",
            },
        ).addToggle((toggle) => toggle.setValue(true));

        create_setting_row(
            section,
            {
                name: "Disabled setting",
                description: "The setting and its control are disabled.",
                is_disabled: true,
            },
        ).addText((input) => input.setValue("Unavailable").setDisabled(true));
    }

    private render_patterns(surface: DesignSurface): void {
        const section = create_detail_section(
            surface,
            "Layout and feedback patterns",
        );

        const row = create_record_row(
            section,
            {
                title: "Example record",
                metadata: "Supporting information stays with the record.",
                status: "Ready",
            },
        );

        create_button(
            row.actions,
            {
                label: "Open details",
                on_click: () => this.open_dialog(),
            },
        );

        create_empty_state(
            section,
            {
                title: "Nothing here yet",
                description: "An empty state explains what to do next.",
            },
        );

        for (const state of ["loading", "success", "error", "info"] as const) {
            create_feedback(
                section,
                {
                    state,
                    message: `${state.charAt(0).toUpperCase()}${state.slice(1)}: example feedback with a readable message.`,
                },
            );
        }
    }

    private open_dialog(): void {
        const modal = new BeautifulModal(
            this.app,
            "Example dialog",
            (surface) => {
                create_text_input(
                    surface,
                    {
                        label: "Example name",
                        placeholder: "Enter a name",
                        on_change: () => { },
                    },
                );

                create_button(
                    surface,
                    {
                        label: "Done",
                        is_primary: true,
                        on_click: () => modal.close(),
                    },
                );
            },
        );

        this.surface?.register(() => modal.close());
        modal.open();
    }

    async onClose(): Promise<void> {
        this.surface?.dispose();
        this.surface = undefined;
    }
}

export default class BeautifulGalleryPlugin extends Plugin {
    onload(): void {
        this.registerView(
            VIEW_TYPE,
            (leaf) => new GalleryView(leaf),
        );

        this.addCommand({
            id: "open_gallery",
            name: "Open design gallery",
            callback: async () => {
                const existing_leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
                const leaf = existing_leaf ?? this.app.workspace.getLeaf("tab");

                if (!existing_leaf) {
                    await leaf.setViewState({
                        type: VIEW_TYPE,
                        active: true,
                    });
                }

                await this.app.workspace.revealLeaf(leaf);
            },
        });
    }
}
