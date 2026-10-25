import { PluginSettingTab, Setting } from "obsidian";
import type { App, Plugin } from "obsidian";

import { BeautifulModal, create_button, create_surface } from "@beautiful/design";
import type { DesignSurface } from "@beautiful/design";

import type { EmailAccount, EmailProvider, InboxHost, InboxSettings } from "./contracts";

import { validate_base_name, validate_vault_folder } from "./settings_schema";
import { normalize_tags } from "./storage/schema";

export class InboxSettingTab extends PluginSettingTab {
    private readonly host: InboxHost;
    private readonly owner_plugin: Plugin;
    private surface: DesignSurface | undefined;
    private preview_modal: BeautifulModal | undefined;

    constructor(
        app: App,
        plugin: Plugin,
        host: InboxHost,
    ) {
        super(
            app,
            plugin,
        );
        this.host = host;
        this.owner_plugin = plugin;
    }

    display(): void {
        this.surface?.dispose();
        this.containerEl.replaceChildren();
        this.surface = create_surface(
            this.owner_plugin,
            this.containerEl,
        );
        const container = this.surface.element;
        this.render_storage(container);
        this.render_capture(container);
        this.render_presentation(container);
        this.render_processing(container);
        this.render_integrations(container);
        this.render_advanced(container);
    }

    hide(): void {
        this.preview_modal?.close();
        this.surface?.dispose();
        this.surface = undefined;
    }

    private save_change(change: () => void): void {
        try {
            change();
            void this.host.save_settings().then(() => this.host.email.start_polling()).catch((error: unknown) => this.host.notify(error instanceof Error ? error.message : "Settings could not be saved."));
        } catch (error) {
            this.host.notify(error instanceof Error ? error.message : "Invalid setting.");
        }
    }

    private add_heading(
        container: HTMLElement,
        title: string,
    ): void {
        new Setting(container).setName(title).setHeading();
    }

    private add_text(
        container: HTMLElement,
        name: string,
        description: string,
        value: string,
        update: (value: string) => void,
    ): void {
        new Setting(container).setName(name).setDesc(description).addText((input) => {
            input.setValue(value).onChange((next_value) => this.save_change(() => update(next_value)));
            input.inputEl.setAttribute(
                "aria-label",
                name,
            );
        });
    }

    private add_toggle(
        container: HTMLElement,
        name: string,
        description: string,
        key: keyof InboxSettings,
    ): void {
        new Setting(container).setName(name).setDesc(description).addToggle((toggle) => {
            toggle.setValue(Boolean(this.host.get_settings()[key])).onChange((value) => this.save_change(() => {
                const settings = this.host.get_settings();
                Object.assign(
                    settings,
                    { [key]: value },
                );
            }));
            toggle.toggleEl.setAttribute(
                "aria-label",
                name,
            );
        });
    }

    private add_number(
        container: HTMLElement,
        name: string,
        description: string,
        value: number,
        minimum: number,
        maximum: number,
        update: (value: number) => void,
    ): void {
        this.add_text(
            container,
            name,
            description,
            String(value),
            (text) => {
                const number = Number(text);

                if (!text.trim() || !Number.isInteger(number) || number < minimum || number > maximum) {
                    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
                }

                update(number);
            },
        );
    }

    private render_storage(container: HTMLElement): void {
        const settings = this.host.get_settings();
        this.add_heading(
            container,
            "Storage",
        );
        this.add_text(
            container,
            "Base folder",
            "Vault-relative location. Changing this does not move existing files.",
            settings.base_folder,
            (value) => { settings.base_folder = validate_vault_folder(value); },
        );
        this.add_text(
            container,
            "Base name",
            "Name of the Inbox Base, without its extension.",
            settings.base_name,
            (value) => { settings.base_name = validate_base_name(value); },
        );
        this.add_text(
            container,
            "Capture folder",
            "New captures are ordinary Markdown notes. Existing captures remain in their current locations.",
            settings.capture_folder,
            (value) => { settings.capture_folder = validate_vault_folder(value); },
        );
        this.add_text(
            container,
            "Attachment folder",
            "Destination for files imported through Inbox. Core audio uses Obsidian's attachment setting.",
            settings.attachment_folder,
            (value) => { settings.attachment_folder = validate_vault_folder(value); },
        );
        this.add_text(
            container,
            "Filename template",
            "Supported placeholders: {date}, {title}, and {id}. Filenames are sanitized and collisions are resolved.",
            settings.filename_template,
            (value) => {
                if (!value.trim()) {
                    throw new Error("Filename template cannot be empty.");
                }

                settings.filename_template = value;
            },
        );
    }

    private render_capture(container: HTMLElement): void {
        const settings = this.host.get_settings();
        this.add_heading(
            container,
            "Capture",
        );
        this.add_text(
            container,
            "Default tags",
            "Comma-separated tags applied to new captures.",
            settings.default_tags.join(", "),
            (value) => {
                settings.default_tags = normalize_tags(value.split(",").map((tag) => tag.trim().replace(
                    /^#/,
                    "",
                )).filter(Boolean));
            },
        );
        this.add_toggle(
            container,
            "Show capture composer",
            "Show an optional inline capture disclosure. The Capture button remains available when this is off.",
            "should_show_capture",
        );
        this.add_toggle(
            container,
            "Clear after capture",
            "Clear the composer after a successful capture. Drafts survive unsuccessful saves.",
            "should_clear_after_capture",
        );
        this.add_toggle(
            container,
            "Open Inbox after capture",
            "Reveal Inbox after captures made through commands or automation.",
            "should_open_after_capture",
        );
        this.add_toggle(
            container,
            "Save URI captures automatically",
            "When off, external URI captures open a populated composer for review.",
            "should_save_uri_automatically",
        );
    }

    private render_presentation(container: HTMLElement): void {
        const settings = this.host.get_settings();
        this.add_heading(
            container,
            "Presentation",
        );
        this.add_number(
            container,
            "Auto arrange columns",
            "Columns used when arranging untouched cards. Cards can be moved and resized independently.",
            settings.card_columns,
            1,
            8,
            (value) => { settings.card_columns = value; },
        );
        this.add_number(
            container,
            "Snap grid size",
            "Distance between snap positions. Background dots are spaced more widely. Each Base view can override its canvas preferences.",
            settings.snap_grid_size,
            8,
            64,
            (value) => { settings.snap_grid_size = value; },
        );
        this.add_toggle(
            container,
            "Enable Shift snapping",
            "Hold Shift while moving or resizing to align cards to the grid and nearby card edges. Movement is free-form otherwise.",
            "should_snap_cards",
        );
        this.add_toggle(
            container,
            "Show canvas grid",
            "Show subtle alignment dots behind cards.",
            "should_show_grid",
        );
        this.add_toggle(
            container,
            "Show previews",
            "Display bounded text and attachment previews where supported.",
            "should_show_previews",
        );
        this.add_toggle(
            container,
            "Show metadata",
            "Display capture type, date, source, and tags.",
            "should_show_metadata",
        );
    }

    private render_processing(container: HTMLElement): void {
        this.add_heading(
            container,
            "Processing and audio",
        );
        this.add_toggle(
            container,
            "Return due items to Inbox",
            "Deferred items become unprocessed when their review date arrives, while Obsidian runs or on launch.",
            "should_restore_due",
        );
        this.add_toggle(
            container,
            "Enable core audio capture",
            "Requires the Audio Recorder core plugin. Recordings are captured by Obsidian itself.",
            "is_audio_enabled",
        );
    }

    private render_integrations(container: HTMLElement): void {
        this.add_heading(
            container,
            "Email integrations",
        );
        new Setting(container).setName("Add email account").setDesc("Read-only imports. Supply your own public OAuth client ID; refresh credentials use Obsidian SecretStorage.").addButton((button) => button.setButtonText("Gmail").onClick(() => this.add_account("gmail"))).addButton((button) => button.setButtonText("Outlook").onClick(() => this.add_account("outlook")));

        for (const account of this.host.get_settings().email_accounts) {
            this.render_account(
                container,
                account,
            );
        }
    }

    private add_account(provider: EmailProvider): void {
        this.save_change(() => {
            this.host.get_settings().email_accounts.push({
                id: crypto.randomUUID(),
                provider,
                label: provider === "gmail" ? "Gmail" : "Outlook",
                client_id: "",
                tenant: "common",
                folder: provider === "gmail" ? "INBOX" : "inbox",
                query: "",
                initial_days: 7,
                is_polling_enabled: false,
                poll_interval_minutes: 15,

            });
        });
        this.display();
    }

    private render_account(
        container: HTMLElement,
        account: EmailAccount,
    ): void {
        this.add_heading(
            container,
            account.label,
        );
        this.add_text(
            container,
            "Account label",
            "A local name for this connection.",
            account.label,
            (value) => { account.label = value; },
        );
        this.add_text(
            container,
            "Public client ID",
            account.provider === "gmail" ? "Google Desktop app client ID. Gmail sign-in is supported on desktop." : "Microsoft public-client application ID with device-code flow enabled.",
            account.client_id,
            (value) => { account.client_id = value.trim(); },
        );

        if (account.provider === "outlook") {
            this.add_text(
                container,
                "Tenant",
                "Use common, consumers, organizations, or your tenant ID.",
                account.tenant,
                (value) => { account.tenant = value.trim() || "common"; },
            );
        }

        this.add_text(
            container,
            "Folder or label",
            account.provider === "gmail" ? "Gmail label ID, such as INBOX." : "Outlook folder ID or well-known folder name, such as inbox.",
            account.folder,
            (value) => { account.folder = value.trim(); },
        );
        this.add_text(
            container,
            "Import filter",
            account.provider === "gmail" ? "Optional Gmail search expression." : "Optional Outlook message search text.",
            account.query,
            (value) => { account.query = value; },
        );
        this.add_number(
            container,
            "Initial import days",
            "Preview the initial import before syncing. Already imported messages are skipped.",
            account.initial_days,
            1,
            36500,
            (value) => { account.initial_days = value; },
        );
        this.add_number(
            container,
            "Polling interval in minutes",
            "Polling runs only while Obsidian is open.",
            account.poll_interval_minutes,
            1,
            1440,
            (value) => { account.poll_interval_minutes = value; },
        );
        new Setting(container).setName("Enable polling").addToggle((toggle) => toggle.setValue(account.is_polling_enabled).onChange((value) => this.save_change(() => { account.is_polling_enabled = value; })));
        new Setting(container).setName(account.account_address ?? "Connection").setDesc(account.last_sync_at ? `Last sync: ${account.last_sync_at}` : "Not synced yet.").addButton((button) => button.setButtonText("Connect").onClick(() => {
            void this.host.email.connect(account.id).then(() => this.display()).catch((error: unknown) => this.host.notify(error instanceof Error ? error.message : "Connection failed."));
        })).addButton((button) => button.setButtonText("Preview").onClick(() => {
            void this.preview_account(account);
        })).addButton((button) => button.setButtonText("Sync").onClick(() => {
            void this.preview_account(account);
        })).addButton((button) => button.setButtonText("Disconnect").onClick(() => {
            void this.host.email.disconnect(account.id).then(() => this.display()).catch((error: unknown) => this.host.notify(error instanceof Error ? error.message : "Disconnect failed."));
        })).addButton((button) => button.setButtonText("Remove").onClick(() => {
            void this.host.email.disconnect(account.id).then(() => {
                this.save_change(() => { this.host.get_settings().email_accounts = this.host.get_settings().email_accounts.filter((candidate) => candidate.id !== account.id); });
                this.display();
            }).catch((error: unknown) => this.host.notify(error instanceof Error ? error.message : "Account could not be removed."));
        }));
    }

    private async preview_account(account: EmailAccount): Promise<void> {
        try {
            const first_page = await this.host.email.preview(account.id);
            this.preview_modal?.close();
            const modal = new BeautifulModal(
                this.app,
                `Preview ${account.label}`,
                (surface) => {
                    const captures = [...first_page.captures];
                    let cursor = first_page.next_cursor;
                    const summary = surface.element.ownerDocument.createElement("p");
                    const list = surface.element.ownerDocument.createElement("ol");
                    const feedback = surface.element.ownerDocument.createElement("p");
                    feedback.setAttribute(
                        "role",
                        "status",
                    );
                    surface.element.append(
                        summary,
                        list,
                        feedback,
                    );
                    const render = (): void => {
                        const existing = new Set(this.host.repository.list_items().map((item) => `${item.source_id ?? ""}\u0000${item.external_id ?? ""}`));
                        const duplicates = captures.filter((capture) => capture.source_id && capture.external_id && existing.has(`${capture.source_id}\u0000${capture.external_id}`)).length;
                        summary.textContent = `${captures.length} messages previewed; ${duplicates} already captured. Import uses the configured ${account.initial_days}-day window and limit of ${this.host.get_settings().import_limit}.`;
                        list.replaceChildren();
                        for (const capture of captures) {
                            const item = list.ownerDocument.createElement("li");
                            item.textContent = capture.title || "Untitled message";
                            list.append(item);
                        }
                    };
                    const more = create_button(
                        surface,
                        {
                            label: "Preview more",
                            is_disabled: !cursor,
                            on_click: () => {
                                more.setDisabled(true);
                                void this.host.email.preview(
                                    account.id,
                                    cursor,
                                ).then((page) => {
                                    captures.push(...page.captures);
                                    cursor = page.next_cursor;
                                    more.setDisabled(!cursor || captures.length >= this.host.get_settings().import_limit);
                                    render();
                                }).catch(() => { feedback.textContent = "More messages could not be loaded. Try the preview again."; more.setDisabled(false); });
                            },

                        },
                    );
                    const import_button = create_button(
                        surface,
                        {
                            label: "Import messages",
                            is_primary: true,
                            on_click: () => {
                                import_button.setDisabled(true);
                                void this.host.email.sync(account.id).then(() => modal.close()).catch((error: unknown) => {
                                    feedback.textContent = error instanceof Error ? error.message : "Import failed.";
                                    import_button.setDisabled(false);
                                });
                            },

                        },
                    );
                    create_button(
                        surface,
                        {
                            label: "Cancel",
                            on_click: () => modal.close(),

                        },
                    );
                    render();
                },
            );
            this.preview_modal = modal;
            modal.setCloseCallback(() => {
                if (this.preview_modal === modal) this.preview_modal = undefined;
            });
            modal.open();
        } catch (error) {
            this.host.notify(error instanceof Error ? error.message : "Preview failed.");
        }
    }

    private render_advanced(container: HTMLElement): void {
        const settings = this.host.get_settings();
        this.add_heading(
            container,
            "Advanced",
        );
        this.add_number(
            container,
            "Attachment limit in MB",
            "Maximum size per manually imported file. Core recording has its own native behavior.",
            settings.attachment_limit_mb,
            1,
            250,
            (value) => { settings.attachment_limit_mb = value; },
        );
        this.add_number(
            container,
            "Import limit",
            "Maximum number of captures per import or email synchronization run.",
            settings.import_limit,
            1,
            10000,
            (value) => { settings.import_limit = value; },
        );
        new Setting(container).setName("Storage diagnostics").setDesc("Malformed records and duplicate IDs are reported without rewriting your notes.").addButton((button) => button.setButtonText("Check records").onClick(() => {
            const diagnostics = this.host.repository.get_diagnostics();
            this.host.notify(diagnostics.length ? diagnostics.slice(
                0,
                10,
            ).join("\n") : "No Inbox record issues found.");
        }));
    }
}
