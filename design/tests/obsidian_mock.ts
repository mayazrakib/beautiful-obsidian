// This mock verifies Beautiful contracts. It does not reproduce Obsidian rendering or focus management.
export class Component {
    private children: Component[] = [];
    private cleanups: (() => void)[] = [];
    private is_loaded = false;

    load(): void {
        this.is_loaded = true;

        for (const child of this.children) {
            child.load();
        }
    }

    unload(): void {
        for (const child of this.children) {
            child.unload();
        }

        for (const cleanup of this.cleanups.splice(0)) {
            cleanup();
        }

        this.children = [];
        this.is_loaded = false;
    }

    addChild<Child extends Component>(child: Child): Child {
        this.children.push(child);

        if (this.is_loaded) {
            child.load();
        }

        return child;
    }

    removeChild<Child extends Component>(child: Child): Child {
        child.unload();
        this.children = this.children.filter((candidate) => candidate !== child);

        return child;
    }

    register(cleanup: () => void): void {
        this.cleanups.push(cleanup);
    }

    registerDomEvent(
        element: HTMLElement,
        event_name: string,
        callback: EventListener,
    ): void {
        element.addEventListener(
            event_name,
            callback,
        );

        this.register(() => element.removeEventListener(
            event_name,
            callback,
        ));
    }
}

export class ButtonComponent {
    readonly buttonEl: HTMLButtonElement;
    disabled = false;

    constructor(container: HTMLElement) {
        this.buttonEl = container.ownerDocument.createElement("button");
        this.buttonEl.type = "button";
        container.append(this.buttonEl);
    }

    setButtonText(label: string): this {
        this.buttonEl.textContent = label;

        return this;
    }

    setDisabled(is_disabled: boolean): this {
        this.disabled = is_disabled;
        this.buttonEl.disabled = is_disabled;

        return this;
    }

    setCta(): this {
        this.buttonEl.classList.add("mod-cta");

        return this;
    }

    setWarning(): this {
        this.buttonEl.classList.add("mod-warning");

        return this;
    }

    onClick(callback: () => void): this {
        this.buttonEl.addEventListener(
            "click",
            callback,
        );

        return this;
    }
}

export class ExtraButtonComponent {
    readonly extraSettingsEl: HTMLElement;
    disabled = false;

    constructor(container: HTMLElement) {
        this.extraSettingsEl = container.ownerDocument.createElement("div");
        container.append(this.extraSettingsEl);
    }

    setIcon(icon: string): this {
        this.extraSettingsEl.dataset.icon = icon;

        return this;
    }

    setTooltip(label: string): this {
        this.extraSettingsEl.title = label;

        return this;
    }

    setDisabled(is_disabled: boolean): this {
        this.disabled = is_disabled;

        return this;
    }

    onClick(callback: () => void): this {
        this.extraSettingsEl.addEventListener(
            "click",
            () => {
                if (!this.disabled) {
                    callback();
                }
            },
        );

        return this;
    }
}

export class TextComponent {
    readonly inputEl: HTMLInputElement;
    private callback: (value: string) => void = () => { };

    constructor(container: HTMLElement) {
        this.inputEl = container.ownerDocument.createElement("input");

        this.inputEl.addEventListener(
            "input",
            () => this.callback(this.inputEl.value),
        );

        container.append(this.inputEl);
    }

    setValue(value: string): this {
        this.inputEl.value = value;

        return this;
    }

    setPlaceholder(value: string): this {
        this.inputEl.placeholder = value;

        return this;
    }

    setDisabled(is_disabled: boolean): this {
        this.inputEl.disabled = is_disabled;

        return this;
    }

    onChange(callback: (value: string) => void): this {
        this.callback = callback;

        return this;
    }
}

export class ToggleComponent {
    readonly toggleEl: HTMLInputElement;
    private callback: (value: boolean) => void = () => { };

    constructor(container: HTMLElement) {
        this.toggleEl = container.ownerDocument.createElement("input");
        this.toggleEl.type = "checkbox";

        this.toggleEl.addEventListener(
            "change",
            () => this.callback(this.toggleEl.checked),
        );

        container.append(this.toggleEl);
    }

    setValue(value: boolean): this {
        this.toggleEl.checked = value;

        return this;
    }

    setDisabled(is_disabled: boolean): this {
        this.toggleEl.disabled = is_disabled;

        return this;
    }

    onChange(callback: (value: boolean) => void): this {
        this.callback = callback;

        return this;
    }
}

export class DropdownComponent {
    readonly selectEl: HTMLSelectElement;
    private callback: (value: string) => void = () => { };

    constructor(container: HTMLElement) {
        this.selectEl = container.ownerDocument.createElement("select");

        this.selectEl.addEventListener(
            "change",
            () => this.callback(this.selectEl.value),
        );

        container.append(this.selectEl);
    }

    addOptions(options: Record<
        string,
        string
    >): this {
        for (const [value, label] of Object.entries(options)) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            this.selectEl.append(option);
        }

        return this;
    }

    setValue(value: string): this {
        this.selectEl.value = value;

        return this;
    }

    setDisabled(is_disabled: boolean): this {
        this.selectEl.disabled = is_disabled;

        return this;
    }

    onChange(callback: (value: string) => void): this {
        this.callback = callback;

        return this;
    }
}

export class Setting {
    readonly settingEl: HTMLElement;

    constructor(container: HTMLElement) {
        this.settingEl = container.ownerDocument.createElement("div");
        container.append(this.settingEl);
    }

    setName(name: string): this {
        this.settingEl.setAttribute(
            "aria-label",
            name,
        );

        return this;
    }

    setDesc(description: string): this {
        this.settingEl.textContent = description;

        return this;
    }

    setDisabled(is_disabled: boolean): this {
        this.settingEl.setAttribute(
            "aria-disabled",
            String(is_disabled),
        );

        return this;
    }
}

class MenuItem {
    label = "";
    icon = "";
    is_disabled = false;
    callback = (): void => { };

    setTitle(label: string): this {
        this.label = label;

        return this;
    }

    setIcon(icon: string): this {
        this.icon = icon;

        return this;
    }

    setDisabled(is_disabled: boolean): this {
        this.is_disabled = is_disabled;

        return this;
    }

    onClick(callback: () => void): this {
        this.callback = callback;

        return this;
    }
}

export class Menu {
    readonly items: MenuItem[] = [];
    is_hidden = false;

    addItem(configure: (item: MenuItem) => void): this {
        const item = new MenuItem();
        configure(item);
        this.items.push(item);

        return this;
    }

    hide(): this {
        this.is_hidden = true;

        return this;
    }
}

export class Modal {
    readonly contentEl = document.createElement("div");
    title = "";

    constructor(app: unknown) {
        void app;
    }

    setTitle(title: string): this {
        this.title = title;

        return this;
    }

    onOpen(): void { }

    onClose(): void { }

    open(): void {
        document.body.append(this.contentEl);
        this.onOpen();
    }

    close(): void {
        this.onClose();
        this.contentEl.remove();
    }
}

export class TextAreaComponent {
    readonly inputEl: HTMLTextAreaElement;
    private callback: (value: string) => void = () => { };

    constructor(container: HTMLElement) {
        this.inputEl = container.ownerDocument.createElement("textarea");

        this.inputEl.addEventListener(
            "input",
            () => this.callback(this.inputEl.value),
        );

        container.append(this.inputEl);
    }

    setValue(value: string): this {
        this.inputEl.value = value;

        return this;
    }

    getValue(): string {
        return this.inputEl.value;
    }

    setPlaceholder(value: string): this {
        this.inputEl.placeholder = value;

        return this;
    }

    setDisabled(is_disabled: boolean): this {
        this.inputEl.disabled = is_disabled;

        return this;
    }

    onChange(callback: (value: string) => void): this {
        this.callback = callback;

        return this;
    }
}
