import type { DesignSurface } from "./surface";

import { require_label } from "./surface";

export interface ToolbarRegions {
    surface: DesignSurface;
    filters: DesignSurface;
    actions: DesignSurface;
}

export interface RecordRowOptions {
    title: string;
    metadata?: string;
    status?: string;
}

export interface RecordRowRegions {
    surface: DesignSurface;
    content: DesignSurface;
    actions: DesignSurface;
}

export interface EmptyStateOptions {
    title: string;
    description: string;
}

export interface FeedbackOptions {
    state: "loading" | "success" | "error" | "info";
    message: string;
}

export function create_toolbar(
    parent: DesignSurface,
    label: string,
): ToolbarRegions {
    require_label(label);

    const surface = parent.create_region("beautiful_toolbar");

    surface.element.setAttribute(
        "role",
        "group",
    );

    surface.element.setAttribute(
        "aria-label",
        label,
    );

    return {
        surface,
        filters: surface.create_region("beautiful_toolbar_filters"),
        actions: surface.create_region("beautiful_toolbar_actions"),
    };
}

export function create_record_row(
    parent: DesignSurface,
    options: RecordRowOptions,
): RecordRowRegions {
    require_label(options.title);

    const surface = parent.create_region("beautiful_record_row");
    const content = surface.create_region("beautiful_record_content");
    const title = content.element.ownerDocument.createElement("div");
    title.className = "beautiful_record_title";
    title.textContent = options.title;
    content.element.append(title);

    if (options.metadata) {
        const metadata = content.element.ownerDocument.createElement("div");
        metadata.className = "beautiful_secondary_text";
        metadata.textContent = options.metadata;
        content.element.append(metadata);
    }

    if (options.status) {
        const status = content.element.ownerDocument.createElement("div");
        status.className = "beautiful_secondary_text";
        status.textContent = options.status;
        content.element.append(status);
    }

    return {
        surface,
        content,
        actions: surface.create_region("beautiful_record_actions"),
    };
}

export function create_detail_section(
    parent: DesignSurface,
    title: string,
): DesignSurface {
    require_label(title);

    const surface = parent.create_region("beautiful_detail_section");
    const heading = surface.element.ownerDocument.createElement("h3");
    heading.textContent = title;
    surface.element.append(heading);

    return surface.create_region("beautiful_detail_content");
}

export function create_empty_state(
    parent: DesignSurface,
    options: EmptyStateOptions,
): DesignSurface {
    require_label(options.title);

    const surface = parent.create_region("beautiful_empty_state");
    const heading = surface.element.ownerDocument.createElement("h3");
    heading.textContent = options.title;

    const description = surface.element.ownerDocument.createElement("p");
    description.className = "beautiful_secondary_text";
    description.textContent = options.description;

    surface.element.append(
        heading,
        description,
    );

    return surface;
}

export function create_feedback(
    parent: DesignSurface,
    options: FeedbackOptions,
): DesignSurface {
    require_label(options.message);

    const surface = parent.create_region("beautiful_feedback");
    surface.element.dataset.state = options.state;

    surface.element.setAttribute(
        "role",
        options.state === "error" ? "alert" : "status",
    );

    surface.element.setAttribute(
        "aria-atomic",
        "true",
    );

    surface.element.textContent = options.message;

    return surface;
}
