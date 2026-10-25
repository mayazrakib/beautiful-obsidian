import type { DesignSurface } from "./surface";

import { require_label } from "./surface";

export interface CardRegions {
    surface: DesignSurface;
    content: DesignSurface;
    actions: DesignSurface;
}

export function create_card(
    parent: DesignSurface,
    label: string,
): CardRegions {
    require_label(label);
    const surface = parent.create_region("beautiful_card");

    surface.element.setAttribute(
        "aria-label",
        label,
    );

    return {
        surface,
        content: surface.create_region("beautiful_card_content"),
        actions: surface.create_region("beautiful_card_actions"),
    };
}
