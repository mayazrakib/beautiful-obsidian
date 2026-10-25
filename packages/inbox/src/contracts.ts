import type { App, Modal, TFile } from "obsidian";

export type InboxStatus = "unprocessed" | "deferred" | "processed" | "archived";
export type CaptureKind = "text" | "link" | "note" | "file" | "image" | "audio" | "email";
export type EmailProvider = "gmail" | "outlook";

export interface InboxItem {
    id: string;
    path: string;
    title: string;
    kind: CaptureKind;
    status: InboxStatus;
    captured_at: string;
    review_at?: string;
    tags: string[];
    source_url?: string;
    source_note?: string;
    source_id?: string;
    external_id?: string;
    preview: string;
    revision: string;
}

export interface CaptureInput {
    title?: string;
    body?: string;
    kind?: CaptureKind;
    tags?: string[];
    source_url?: string;
    source_note?: string;
    source_id?: string;
    external_id?: string;
    captured_at?: string;
}

export interface CaptureResult {
    status: "created" | "duplicate";
    item: InboxItem;
}

export interface ItemPatch {
    title?: string;
    body?: string;
    status?: InboxStatus;
    review_at?: string | null;
    tags?: string[];
}

export interface OperationReport {
    succeeded: string[];
    failed: { id: string; message: string; }[];
}

export interface InboxAttachment {
    path: string;
    name: string;
    kind: "image" | "audio" | "file";
    resource_url: string;
    size_bytes: number;
}

export interface InboxRepository {
    start(): Promise<void>;
    dispose(): void;
    subscribe(listener: () => void): () => void;
    list_items(): InboxItem[];
    get_item(id: string): InboxItem | undefined;
    read_body(id: string): Promise<string>;
    capture(input: CaptureInput): Promise<CaptureResult>;
    update_item(
        id: string,
        patch: ItemPatch,
        expected_revision?: string,
    ): Promise<InboxItem>;
    process_items(
        ids: string[],
        status: InboxStatus,
        review_at?: string,
    ): Promise<OperationReport>;
    undo(): Promise<OperationReport>;
    trash_items(ids: string[]): Promise<OperationReport>;
    restore_due(): Promise<void>;
    ensure_base(): Promise<TFile>;
    import_files(
        files: File[],
        input?: CaptureInput,
    ): Promise<CaptureResult[]>;
    attach_files(
        id: string,
        files: File[],
    ): Promise<InboxItem>;
    list_attachments(id: string): Promise<InboxAttachment[]>;
    remove_attachment(
        id: string,
        path: string,
        should_trash_file?: boolean,
    ): Promise<InboxItem>;
    get_diagnostics(): string[];
}

export interface EmailAccount {
    id: string;
    provider: EmailProvider;
    label: string;
    client_id: string;
    tenant: string;
    folder: string;
    query: string;
    initial_days: number;
    is_polling_enabled: boolean;
    poll_interval_minutes: number;
    secret_id?: string;
    account_address?: string;
    cursor?: string;
    last_sync_at?: string;
    sync_scope?: string;
}

export interface InboxSettings {
    base_folder: string;
    base_name: string;
    capture_folder: string;
    attachment_folder: string;
    filename_template: string;
    default_tags: string[];
    card_columns: number;
    snap_grid_size: number;
    should_snap_cards: boolean;
    should_show_grid: boolean;
    should_show_previews: boolean;
    should_show_metadata: boolean;
    should_show_capture: boolean;
    should_save_uri_automatically: boolean;
    should_open_after_capture: boolean;
    should_clear_after_capture: boolean;
    is_audio_enabled: boolean;
    should_restore_due: boolean;
    attachment_limit_mb: number;
    import_limit: number;
    email_accounts: EmailAccount[];
}

export interface AudioState {
    phase: "idle" | "starting" | "recording" | "saving" | "error" | "unavailable";
    message: string;
    item_id?: string;
}

export interface AudioCapture {
    get_state(): AudioState;
    subscribe(listener: () => void): () => void;
    start(): Promise<void>;
    stop(): Promise<void>;
    dispose(): void;
}

export interface EmailPreview {
    captures: CaptureInput[];
    next_cursor?: string;
    has_more: boolean;
}

export interface EmailSyncState {
    is_syncing: boolean;
    message: string;
    imported: number;
    duplicates: number;
}

export interface EmailService {
    get_state(): EmailSyncState;
    subscribe(listener: () => void): () => void;
    connect(account_id: string): Promise<void>;
    disconnect(account_id: string): Promise<void>;
    preview(
        account_id: string,
        cursor?: string,
    ): Promise<EmailPreview>;
    sync(account_id?: string): Promise<void>;
    cancel(): void;
    start_polling(): void;
    import_attachments(item_id: string): Promise<void>;
    dispose(): void;
}

export interface InboxHost {
    app: App;
    repository: InboxRepository;
    audio: AudioCapture;
    email: EmailService;
    get_settings(): InboxSettings;
    save_settings(): Promise<void>;
    open_inbox(should_open_new?: boolean): Promise<void>;
    open_capture(input?: CaptureInput): void;
    open_note(id: string): Promise<void>;
    notify(message: string): void;
    show_auth_code(
        url: string,
        code: string,
    ): void;
    own_modal?(modal: Modal): void;
    when_ready?(): Promise<void>;
}

export interface InboxApi {
    version: 1;
    capture(input: CaptureInput): Promise<CaptureResult>;
    read(id: string): Promise<{ item: InboxItem | undefined; body: string; }>;
    list(options?: { limit?: number; offset?: number; status?: InboxStatus; }): { items: InboxItem[]; total: number; next_offset: number | null; };
    update(
        id: string,
        patch: ItemPatch,
        expected_revision?: string,
    ): Promise<InboxItem>;
    process(
        ids: string[],
        status: InboxStatus,
        review_at?: string,
    ): Promise<OperationReport>;
    import(captures: CaptureInput[]): Promise<CaptureResult[]>;
    get_item(id: string): InboxItem | undefined;
}
