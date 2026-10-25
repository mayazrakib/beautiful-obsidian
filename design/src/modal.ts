import { Component, Modal } from "obsidian";
import type { App } from "obsidian";

import type { DesignSurface } from "./surface";

import { create_surface, require_label } from "./surface";

export class BeautifulModal extends Modal {
    private readonly render_content: (surface: DesignSurface) => void;
    private content_owner: Component | undefined;

    constructor(
        app: App,
        title: string,
        render_content: (surface: DesignSurface) => void,
    ) {
        require_label(title);
        super(app);
        this.setTitle(title);
        this.render_content = render_content;
    }

    onOpen(): void {
        this.content_owner?.unload();
        this.content_owner = new Component();
        this.content_owner.load();

        try {
            this.render_content(create_surface(
                this.content_owner,
                this.contentEl,
            ));
        } catch (error) {
            this.content_owner.unload();
            this.content_owner = undefined;
            this.close();
            throw error;
        }
    }

    onClose(): void {
        this.content_owner?.unload();
        this.content_owner = undefined;
        this.contentEl.replaceChildren();
    }
}
