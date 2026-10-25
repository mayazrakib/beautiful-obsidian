import {
    ButtonComponent,
    DropdownComponent,
    ExtraButtonComponent,
    Menu,
    Setting,
    TextComponent,
    ToggleComponent,
} from "obsidian";

import type { DesignSurface } from "./surface";

import { bind_callback } from "./lifecycle";
import { require_label } from "./surface";

class IconButton extends ExtraButtonComponent {
    setDisabled(is_disabled: boolean): this {
        super.setDisabled(is_disabled);

        this.extraSettingsEl.setAttribute(
            "aria-disabled",
            String(is_disabled),
        );

        return this;
    }
}

export interface ButtonOptions {
    label: string;
    on_click: () => void;
    is_disabled?: boolean;
    is_primary?: boolean;
    is_warning?: boolean;
}

export interface IconButtonOptions {
    label: string;
    icon: string;
    on_click: () => void;
    is_disabled?: boolean;
}

export interface TextInputOptions {
    label: string;
    value?: string;
    placeholder?: string;
    is_disabled?: boolean;
    on_change: (value: string) => void;
}

export interface ToggleOptions {
    label: string;
    value: boolean;
    is_disabled?: boolean;
    on_change: (value: boolean) => void;
}

export interface DropdownOptions {
    label: string;
    options: Readonly<Record<string, string>>;
    value: string;
    is_disabled?: boolean;
    on_change: (value: string) => void;
}

export interface SettingOptions {
    name: string;
    description?: string;
    is_disabled?: boolean;
}

export interface MenuAction {
    label: string;
    icon?: string;
    is_disabled?: boolean;
    on_click: () => void;
}

export function create_button(
    surface: DesignSurface,
    options: ButtonOptions,
): ButtonComponent {
    require_label(options.label);

    const button = new ButtonComponent(surface.element);
    button.setButtonText(options.label);
    button.setDisabled(options.is_disabled ?? false);
    button.onClick(bind_callback(
        surface,
        options.on_click,
    ));

    if (options.is_primary) {
        button.setCta();
    }

    if (options.is_warning) {
        button.setWarning();
    }

    surface.register(() => {
        button.buttonEl.remove();
    });

    return button;
}

export function create_icon_button(
    surface: DesignSurface,
    options: IconButtonOptions,
): ExtraButtonComponent {
    require_label(options.label);

    const button = new IconButton(surface.element);
    button.setIcon(options.icon);
    button.setTooltip(options.label);

    button.extraSettingsEl.setAttribute(
        "aria-label",
        options.label,
    );

    button.extraSettingsEl.setAttribute(
        "role",
        "button",
    );

    button.extraSettingsEl.tabIndex = 0;
    button.setDisabled(options.is_disabled ?? false);
    button.onClick(bind_callback(
        surface,
        options.on_click,
    ));

    surface.registerDomEvent(
        button.extraSettingsEl,
        "keydown",
        (event) => {
            if (!event.defaultPrevented && (event.key === "Enter" || event.key === " ") && !button.disabled) {
                event.preventDefault();
                button.extraSettingsEl.click();
            }
        },
    );

    surface.register(() => {
        button.extraSettingsEl.remove();
    });

    return button;
}

export function create_text_input(
    surface: DesignSurface,
    options: TextInputOptions,
): TextComponent {
    require_label(options.label);

    const input = new TextComponent(surface.element);

    input.inputEl.setAttribute(
        "aria-label",
        options.label,
    );

    input.setValue(options.value ?? "");
    input.setPlaceholder(options.placeholder ?? "");
    input.setDisabled(options.is_disabled ?? false);
    input.onChange(bind_callback(
        surface,
        options.on_change,
    ));

    surface.register(() => {
        input.inputEl.remove();
    });

    return input;
}

export function create_toggle(
    surface: DesignSurface,
    options: ToggleOptions,
): ToggleComponent {
    require_label(options.label);

    const toggle = new ToggleComponent(surface.element);

    toggle.toggleEl.setAttribute(
        "aria-label",
        options.label,
    );

    toggle.setValue(options.value);
    toggle.setDisabled(options.is_disabled ?? false);
    toggle.onChange(bind_callback(
        surface,
        options.on_change,
    ));

    surface.register(() => {
        toggle.toggleEl.remove();
    });

    return toggle;
}

export function create_dropdown(
    surface: DesignSurface,
    options: DropdownOptions,
): DropdownComponent {
    require_label(options.label);

    if (!Object.prototype.hasOwnProperty.call(
        options.options,
        options.value,
    )) {
        throw new Error("The dropdown value must match an available option.");
    }

    const dropdown = new DropdownComponent(surface.element);

    dropdown.selectEl.setAttribute(
        "aria-label",
        options.label,
    );

    dropdown.addOptions({ ...options.options });
    dropdown.setValue(options.value);
    dropdown.setDisabled(options.is_disabled ?? false);
    dropdown.onChange(bind_callback(
        surface,
        options.on_change,
    ));

    surface.register(() => {
        dropdown.selectEl.remove();
    });

    return dropdown;
}

export function create_setting_row(
    surface: DesignSurface,
    options: SettingOptions,
): Setting {
    require_label(options.name);

    const setting = new Setting(surface.element);
    setting.setName(options.name);
    setting.setDesc(options.description ?? "");
    setting.setDisabled(options.is_disabled ?? false);
    surface.register(() => setting.settingEl.remove());

    return setting;
}

export function create_menu(
    surface: DesignSurface,
    actions: readonly MenuAction[],
): Menu {
    for (const action of actions) {
        require_label(action.label);
    }

    const menu = new Menu();

    for (const action of actions) {
        menu.addItem((item) => {
            item.setTitle(action.label);
            item.setDisabled(action.is_disabled ?? false);
            item.onClick(bind_callback(
                surface,
                action.on_click,
            ));

            if (action.icon) {
                item.setIcon(action.icon);
            }
        });
    }

    surface.register(() => menu.hide());

    return menu;
}
