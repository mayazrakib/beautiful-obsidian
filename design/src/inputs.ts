import { TextAreaComponent } from "obsidian";

import type { DesignSurface } from "./surface";

import { bind_callback } from "./lifecycle";
import { require_label } from "./surface";

export interface TextAreaOptions {
    label: string;
    value?: string;
    placeholder?: string;
    rows?: number;
    is_disabled?: boolean;
    on_change: (value: string) => void;
}

export interface CheckboxOptions {
    label: string;
    value: boolean;
    is_disabled?: boolean;
    on_change: (value: boolean) => void;
}

export function create_text_area(
    surface: DesignSurface,
    options: TextAreaOptions,
): TextAreaComponent {
    require_label(options.label);
    const input = new TextAreaComponent(surface.element);

    input.inputEl.setAttribute(
        "aria-label",
        options.label,
    );

    input.inputEl.rows = options.rows ?? 4;
    input.setValue(options.value ?? "");
    input.setPlaceholder(options.placeholder ?? "");
    input.setDisabled(options.is_disabled ?? false);

    input.onChange(bind_callback(
        surface,
        options.on_change,
    ));

    surface.register(() => input.inputEl.remove());

    return input;
}

export function create_checkbox(
    surface: DesignSurface,
    options: CheckboxOptions,
): HTMLInputElement {
    require_label(options.label);
    const checkbox = surface.element.ownerDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = options.value;
    checkbox.disabled = options.is_disabled ?? false;

    checkbox.setAttribute(
        "aria-label",
        options.label,
    );

    surface.element.append(checkbox);

    surface.registerDomEvent(
        checkbox,
        "change",
        () => options.on_change(checkbox.checked),
    );

    return checkbox;
}
