import { Notice, parseYaml, Plugin, TFile } from "obsidian";
import type { Modal } from "obsidian";

import { BeautifulModal, create_button } from "@beautiful/design";

import type { CaptureInput, InboxApi, InboxHost, InboxSettings } from "./contracts";

import { create_inbox_api } from "./api";
import { CoreAudioCapture, InboxEmailService, register_capture_entrypoints } from "./integrations/index";
import { InboxSettingTab } from "./settings";
import { load_settings } from "./settings_schema";
import { upgrade_inbox_base } from "./storage/base";
import { InboxStore } from "./storage/index";
import { open_capture_modal, open_import_modal, open_process_next, register_inbox_views } from "./ui/index";

export default class BeautifulInboxPlugin extends Plugin implements InboxHost {
    repository!: InboxStore;
    audio!: CoreAudioCapture;
    email!: InboxEmailService;
    api!: InboxApi;
    private inbox_settings!: InboxSettings;
    private save_queue: Promise<void> = Promise.resolve();
    private is_ready = false;
    private is_disposed = false;
    private initialization_error: Error | undefined;
    private resolve_ready: (() => void) | undefined;
    private readonly ready_promise = new Promise<void>((resolve) => { this.resolve_ready = resolve; });
    private auth_modal: BeautifulModal | undefined;
    private readonly active_modals = new Set<Modal>();

    async onload(): Promise<void> {
        this.inbox_settings = load_settings(await this.loadData());
        this.repository = new InboxStore(
            this.app,
            () => this.inbox_settings,
        );
        this.audio = new CoreAudioCapture(this);
        this.email = new InboxEmailService(this);
        this.api = create_inbox_api(
            this.repository,
            () => this.inbox_settings,
            () => this.when_ready(),
        );
        const has_bases = register_inbox_views(
            this,
            this,
        );

        this.addRibbonIcon(
            "inbox",
            "Inbox",
            () => this.run_action(() => this.open_inbox()),
        );
        this.addSettingTab(new InboxSettingTab(
            this.app,
            this,
            this,
        ));
        this.register_commands();
        register_capture_entrypoints(
            this,
            this,
        );

        this.register(() => {
            this.is_disposed = true;
            this.resolve_ready?.();
            this.auth_modal?.close();
            for (const modal of this.active_modals) modal.close();
            this.active_modals.clear();
            this.audio.dispose();
            this.email.dispose();
            this.repository.dispose();
        });

        this.app.workspace.onLayoutReady(() => {
            this.run_action(
                async () => {
                    if (this.is_disposed) return;
                    await this.repository.start();
                    if (this.is_disposed) return;
                    this.is_ready = true;
                    this.resolve_ready?.();
                    await this.refresh_inbox_leaves();
                    this.email.start_polling();

                    if (this.inbox_settings.should_restore_due) {
                        await this.repository.restore_due();
                    }
                },
                (error) => {
                    if (!this.is_ready) {
                        this.initialization_error = error instanceof Error ? error : new Error("Inbox initialization failed.");
                        this.resolve_ready?.();
                    }
                },
            );
        });

        this.registerInterval(window.setInterval(
            () => {
                if (this.is_ready && this.inbox_settings.should_restore_due) {
                    this.run_action(() => this.repository.restore_due());
                }
            },
            60000,
        ));

        if (!has_bases) {
            this.notify("Beautiful Inbox capture is available. Enable the Bases core plugin to use the Inbox views.");
        }
    }

    async when_ready(): Promise<void> {
        await this.ready_promise;
        if (this.initialization_error) throw this.initialization_error;
        if (this.is_disposed) throw new Error("Beautiful Inbox is no longer enabled.");
    }

    get_settings(): InboxSettings {
        return this.inbox_settings;
    }

    async save_settings(): Promise<void> {
        const snapshot = load_settings(this.inbox_settings);
        this.save_queue = this.save_queue.catch(() => { }).then(() => this.saveData(snapshot));

        await this.save_queue;
        this.app.workspace.trigger("beautiful_inbox_settings_changed");
    }

    async open_inbox(should_open_new = false): Promise<void> {
        await this.when_ready();
        const file = await this.repository.ensure_base();
        const existing = should_open_new ? undefined : this.app.workspace.getLeavesOfType("bases").find((leaf) => leaf.getViewState().state?.file === file.path);
        const leaf = existing ?? this.app.workspace.getLeaf("tab");

        if (!existing) {
            await leaf.openFile(file);
        }

        await this.app.workspace.revealLeaf(leaf);
        this.app.workspace.setActiveLeaf(
            leaf,
            { focus: true },
        );
    }

    open_capture(input: CaptureInput = {}): void {
        this.own_modal(open_capture_modal(
            this,
            input,
        ));
    }

    own_modal(modal: Modal): void {
        this.active_modals.add(modal);
        modal.setCloseCallback(() => this.active_modals.delete(modal));
    }

    async open_note(id: string): Promise<void> {
        const item = this.repository.get_item(id);
        const file = item ? this.app.vault.getAbstractFileByPath(item.path) : null;

        if (!(file instanceof TFile)) {
            throw new Error("The capture note could not be found.");
        }

        await this.app.workspace.getLeaf("tab").openFile(file);
    }

    notify(message: string): void {
        new Notice(
            message,
            8000,
        );
    }

    show_auth_code(
        url: string,
        code: string,
    ): void {
        this.auth_modal?.close();
        const modal = new BeautifulModal(
            this.app,
            "Connect email account",
            (surface) => {
                const explanation = surface.element.ownerDocument.createElement("p");
                explanation.textContent = "Open the provider's sign-in page and enter this code. Keep this window open until sign-in completes.";
                const code_element = surface.element.ownerDocument.createElement("code");
                code_element.textContent = code;
                const link = surface.element.ownerDocument.createElement("a");
                link.href = url;
                link.textContent = "Open sign-in page";
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                surface.element.append(
                    explanation,
                    code_element,
                    link,
                );
                create_button(
                    surface,
                    {
                        label: "Copy code",
                        on_click: () => {
                            void navigator.clipboard.writeText(code).catch(() => this.notify("The code could not be copied. Select and copy it manually."));
                        },

                    },
                );
                create_button(
                    surface,
                    {
                        label: "Cancel sign-in",
                        on_click: () => { this.email.cancel(); modal.close(); },

                    },
                );
            },
        );
        this.auth_modal = modal;
        const unsubscribe = this.email.subscribe(() => {
            if (!this.email.get_state().is_syncing) {
                modal.close();
            }
        });
        modal.setCloseCallback(() => {
            unsubscribe();
            if (this.email.get_state().is_syncing) this.email.cancel();
            if (this.auth_modal === modal) this.auth_modal = undefined;
        });
        modal.open();
    }

    private async refresh_inbox_leaves(): Promise<void> {
        for (const leaf of this.app.workspace.getLeavesOfType("bases")) {
            const state = leaf.getViewState();
            const path: unknown = state.state?.file;
            const file = typeof path === "string" ? this.app.vault.getAbstractFileByPath(path) : null;

            if (!(file instanceof TFile) || file.extension !== "base") continue;

            let parsed: unknown;

            try {
                parsed = parseYaml(await this.app.vault.cachedRead(file));
            } catch {
                continue;
            }

            if (!parsed || typeof parsed !== "object" || !("views" in parsed) || !Array.isArray(parsed.views)) continue;

            const views = parsed.views.filter((view): view is { name?: string; type?: string } => Boolean(view) && typeof view === "object");
            const active_view = views.find((view) => view.name === state.state?.viewName) ?? views[0];

            if (typeof active_view?.type !== "string" || !active_view.type.startsWith("beautiful_inbox_")) continue;

            const renamed_views = await upgrade_inbox_base(
                this.app,
                file,
            );
            const previous_name: unknown = state.state?.viewName;
            const view_name = typeof previous_name === "string" ? renamed_views.get(previous_name) ?? previous_name : "Cards";
            await leaf.setViewState({ type: "empty" });
            await leaf.setViewState({
                ...state,
                state: {
                    ...state.state,
                    viewName: view_name,
                },
            });
        }
    }

    private run_action(
        action: () => Promise<unknown>,
        on_error?: (error: unknown) => void,
    ): void {
        void action().catch((error: unknown) => {
            on_error?.(error);
            this.notify(error instanceof Error ? error.message : "The Inbox action could not be completed.");
        });
    }

    private register_commands(): void {
        this.addCommand({
            id: "open_inbox",
            name: "Open Inbox",
            callback: () => this.run_action(() => this.open_inbox()),

        });
        this.addCommand({
            id: "open_inbox_new_tab",
            name: "Open Inbox in a new tab",
            callback: () => this.run_action(() => this.open_inbox(true)),

        });
        this.addCommand({
            id: "quick_capture",
            name: "Quick capture",
            callback: () => this.open_capture(),

        });
        this.addCommand({
            id: "capture_selection",
            name: "Capture selection",
            editorCallback: (
                editor,
                view,
            ) => {
                const selection = editor.getSelection();
                this.open_capture({
                    body: selection,
                    ...(view.file ? { source_note: view.file.path } : {}),

                });
            },

        });
        this.addCommand({
            id: "capture_note",
            name: "Capture a reference to the current note",
            checkCallback: (is_checking) => {
                const file = this.app.workspace.getActiveFile();

                if (!file || file.extension !== "md") {
                    return false;
                }

                if (!is_checking) {
                    this.open_capture({
                        title: file.basename,
                        body: `[[${file.path}]]`,
                        kind: "note",
                        source_note: file.path,

                    });
                }

                return true;
            },

        });
        this.addCommand({
            id: "capture_clipboard",
            name: "Capture clipboard",
            callback: () => this.run_action(async () => this.open_capture({ body: await navigator.clipboard.readText() })),

        });
        this.addCommand({
            id: "start_audio_capture",
            name: "Start audio capture",
            callback: () => this.run_action(() => this.audio.start()),

        });
        this.addCommand({
            id: "stop_audio_capture",
            name: "Stop audio capture",
            callback: () => this.run_action(() => this.audio.stop()),

        });
        this.addCommand({
            id: "sync_email",
            name: "Sync email",
            callback: () => this.run_action(() => this.email.sync()),

        });
        this.addCommand({
            id: "cancel_email_sync",
            name: "Cancel email sync",
            callback: () => this.email.cancel(),

        });
        this.addCommand({
            id: "import_captures",
            name: "Import captures from JSON or JSONL",
            callback: () => this.own_modal(open_import_modal(this)),

        });
        this.addCommand({
            id: "undo_last_change",
            name: "Undo the last Inbox change",
            callback: () => this.run_action(async () => {
                const result = await this.repository.undo();
                this.notify(`Restored ${result.succeeded.length} captures${result.failed.length ? `; ${result.failed.length} conflicts` : ""}.`);
            }),

        });
        this.addCommand({
            id: "process_next",
            name: "Process the next item",
            callback: () => {
                this.own_modal(open_process_next(this));
            },

        });
        this.addCommand({
            id: "copy_bookmarklet",
            name: "Copy browser capture bookmarklet",
            callback: () => this.run_action(async () => {
                const vault = encodeURIComponent(this.app.vault.getName());
                const bookmarklet = `javascript:(()=>{const p=new URLSearchParams({vault:${JSON.stringify(decodeURIComponent(vault))},title:document.title,url:location.href,text:String(getSelection()||'')});location.href='obsidian://beautiful-inbox?'+p.toString()})()`;
                await navigator.clipboard.writeText(bookmarklet);
                this.notify("Bookmarklet copied. Save it as a browser bookmark to capture page titles, links, and selections.");
            }),

        });
        this.registerEvent(this.app.workspace.on(
            "file-menu",
            (
                menu,
                file,
            ) => {
                if (!(file instanceof TFile) || file.extension !== "md") {
                    return;
                }

                menu.addItem((item) => item.setTitle("Capture in Inbox").setIcon("inbox").onClick(() => this.open_capture({
                    title: file.basename,
                    body: `[[${file.path}]]`,
                    kind: "note",
                    source_note: file.path,

                })));
            },
        ));
    }

}
