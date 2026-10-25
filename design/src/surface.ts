import { Component } from "obsidian";

export class DesignSurface extends Component {
    readonly element: HTMLElement;
    private readonly owner: Component;

    constructor(
        owner: Component,
        container: HTMLElement,
        class_name = "",
    ) {
        super();
        this.owner = owner;
        this.element = container.ownerDocument.createElement("div");
        this.element.classList.add("beautiful_surface");

        if (class_name) {
            this.element.classList.add(class_name);
        }

        container.append(this.element);
        this.register(() => this.element.remove());
        owner.addChild(this);
    }

    create_region(class_name: string): DesignSurface {
        return new DesignSurface(
            this,
            this.element,
            class_name,
        );
    }

    dispose(): void {
        this.owner.removeChild(this);
    }
}

export function create_surface(
    owner: Component,
    container: HTMLElement,
): DesignSurface {
    return new DesignSurface(
        owner,
        container,
    );
}

export function require_label(label: string): void {
    if (!label.trim()) {
        throw new Error("An accessible label is required.");
    }
}
