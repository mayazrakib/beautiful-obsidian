import type { CaptureInput, EmailAccount, EmailPreview, EmailService, EmailSyncState, InboxHost } from "../contracts";

import type { EmailTokens } from "./email_auth";

import { connect_email_account, refresh_tokens } from "./email_auth";
import { assert_not_cancelled, EmailRequestError, read_object, read_objects, read_string, request_email_json, validate_email_url } from "./email_http";
import { decode_base64_url, get_email_attachment_descriptors, parse_email_capture, read_email_identity } from "./email_messages";

const PAGE_SIZE = 25;
const SYNC_OVERLAP_MS = 5 * 60_000;
const MAX_IMPORT_LIMIT = 5000;
const MAX_ATTACHMENT_PAGES = 20;
const MAX_SYNC_PAGES = 100;

interface EmailCursor {
    provider: "gmail" | "outlook";
    query: string;
    page: string;
    offset: number;
    processed_ids: string[];
    started_at: string;
    settings_key: string;
}

interface EmailPage extends EmailPreview {
    current_cursor: EmailCursor;
}

export class InboxEmailService implements EmailService {
    private state: EmailSyncState = {
        is_syncing: false,
        message: "Email accounts import read-only copies.",
        imported: 0,
        duplicates: 0,

    };
    private readonly listeners = new Set<() => void>();
    private controller: AbortController | undefined;
    private poll_timer: ReturnType<typeof setTimeout> | undefined;
    private readonly next_poll_at = new Map<
        string,
        number
    >();
    private readonly access_tokens = new Map<
        string,
        EmailTokens
    >();
    private readonly refresh_operations = new Map<
        string,
        Promise<EmailTokens>
    >();
    private is_disposed = false;

    constructor(private readonly host: InboxHost) { }

    get_state(): EmailSyncState {
        return { ...this.state };
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);

        return () => this.listeners.delete(listener);
    }

    private set_state(patch: Partial<EmailSyncState>): void {
        this.state = {
            ...this.state,
            ...patch,

        };

        for (const listener of this.listeners) {
            listener();
        }
    }

    private get_account(account_id: string): EmailAccount {
        const account = this.host.get_settings().email_accounts.find((candidate) => candidate.id === account_id);

        if (!account) {
            throw new Error("This email account no longer exists.");
        }

        return account;
    }

    private begin_operation(message: string): AbortSignal {
        if (this.is_disposed || this.controller) {
            throw new Error("Another email operation is active. Finish or cancel it first.");
        }

        this.controller = new AbortController();

        this.set_state({
            is_syncing: true,
            message,
            imported: 0,
            duplicates: 0,

        });

        return this.controller.signal;
    }

    private end_operation(): void {
        this.controller = undefined;
        this.set_state({ is_syncing: false });
    }

    private load_tokens(account: EmailAccount): EmailTokens {
        const cached_tokens = this.access_tokens.get(account.id);

        if (cached_tokens) {
            return cached_tokens;
        }

        if (!account.secret_id || !/^beautiful-inbox-[a-z0-9-]+$/.test(account.secret_id)) {
            throw new Error("Connect this email account before importing.");
        }

        const stored = this.host.app.secretStorage.getSecret(account.secret_id);

        if (!stored) {
            throw new Error("This device needs you to reconnect the email account.");
        }

        try {
            const tokens = read_object(JSON.parse(stored));

            if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token) {
                throw new Error("Invalid token.");
            }

            return {
                access_token: "",
                expires_at: 0,
                refresh_token: tokens.refresh_token,

            };
        } catch {
            throw new Error("The saved sign-in is unavailable. Reconnect this account.");
        }
    }

    private async save_tokens(
        account: EmailAccount,
        tokens: EmailTokens,
    ): Promise<void> {
        if (!tokens.refresh_token) {
            throw new Error("The provider did not return offline access. Reconnect and grant the requested permissions.");
        }

        if (!account.secret_id || !/^beautiful-inbox-[a-z0-9-]+$/.test(account.secret_id)) {
            account.secret_id = `beautiful-inbox-${account.provider}-${crypto.randomUUID()}`;
        }

        this.host.app.secretStorage.setSecret(
            account.secret_id,
            JSON.stringify({ refresh_token: tokens.refresh_token }),
        );

        this.access_tokens.set(
            account.id,
            tokens,
        );

        await this.host.save_settings();
    }

    private refresh_account_tokens(
        account: EmailAccount,
        tokens: EmailTokens,
        signal: AbortSignal,
    ): Promise<EmailTokens> {
        const existing = this.refresh_operations.get(account.id);

        if (existing) {
            return existing;
        }

        const operation = refresh_tokens(
            account,
            tokens,
            signal,
        ).then(async (refreshed_tokens) => {
            assert_not_cancelled(signal);

            await this.save_tokens(
                account,
                refreshed_tokens,
            );

            return refreshed_tokens;
        }).finally(() => this.refresh_operations.delete(account.id));

        this.refresh_operations.set(
            account.id,
            operation,
        );

        return operation;
    }

    private async request_authorized(
        account: EmailAccount,
        url: string,
        signal: AbortSignal,
        should_retry_auth = true,
    ): Promise<Record<
        string,
        unknown
    >> {
        const parsed_url = validate_email_url(url);
        const expected_host = account.provider === "gmail" ? "gmail.googleapis.com" : "graph.microsoft.com";

        if (parsed_url.hostname !== expected_host) {
            throw new Error("The email provider returned an unsupported mailbox URL.");
        }

        let tokens = this.load_tokens(account);

        if (tokens.expires_at <= Date.now() + 60_000) {
            tokens = await this.refresh_account_tokens(
                account,
                tokens,
                signal,
            );
        }

        try {
            return await request_email_json(
                {
                    url,
                    headers: {
                        Authorization: `Bearer ${tokens.access_token}`,
                        ...(account.provider === "outlook" ? { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' } : {}),

                    },

                },
                signal,
            );
        } catch (error) {
            if (error instanceof EmailRequestError && error.status === 401 && should_retry_auth) {
                await this.refresh_account_tokens(
                    account,
                    tokens,
                    signal,
                );

                return this.request_authorized(
                    account,
                    url,
                    signal,
                    false,
                );
            }

            throw error;
        }
    }

    async connect(account_id: string): Promise<void> {
        const account = this.get_account(account_id);
        const signal = this.begin_operation("Waiting for provider sign-in.");

        try {
            const tokens = await connect_email_account(
                account,
                this.host,
                signal,
            );

            assert_not_cancelled(signal);

            const profile = await request_email_json(
                {
                    url: account.provider === "gmail" ? "https://gmail.googleapis.com/gmail/v1/users/me/profile" : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName",
                    headers: { Authorization: `Bearer ${tokens.access_token}` },

                },
                signal,
            );

            const address = read_string(account.provider === "gmail" ? profile.emailAddress : profile.mail || profile.userPrincipalName);

            if (!address) {
                throw new Error("The provider did not return an account address. Reconnect this account.");
            }

            if (account.account_address && account.account_address.toLowerCase() !== address.toLowerCase()) {
                delete account.cursor;
                delete account.last_sync_at;
                delete account.sync_scope;
            }

            account.account_address = address;

            await this.save_tokens(
                account,
                tokens,
            );

            this.set_state({ message: "Email connected. Preview messages before importing." });
        } catch (error) {
            this.set_state({ message: signal.aborted ? "Email sign-in cancelled." : "Email sign-in did not finish. Check the account setup and try again." });
            throw error;
        } finally {
            this.end_operation();
            this.start_polling();
        }
    }

    async disconnect(account_id: string): Promise<void> {
        this.cancel();

        const account = this.get_account(account_id);

        if (account.secret_id?.startsWith("beautiful-inbox-")) {
            this.host.app.secretStorage.setSecret(
                account.secret_id,
                "",
            );
        }

        this.access_tokens.delete(account.id);
        delete account.secret_id;
        delete account.cursor;
        account.is_polling_enabled = false;
        await this.host.save_settings();
        this.set_state({ message: "Email disconnected on this device. Imported notes were kept." });
        this.start_polling();
    }

    private create_cursor(
        account: EmailAccount,
        cursor_override?: string,
    ): EmailCursor {
        const settings_key = JSON.stringify([account.provider, account.folder, account.query, account.initial_days, account.account_address]);

        const stored_cursor = cursor_override === undefined ? account.cursor : cursor_override;

        if (stored_cursor && stored_cursor.length < 100_000) {
            try {
                const saved = read_object(JSON.parse(stored_cursor));

                if (saved.provider === account.provider && saved.settings_key === settings_key && typeof saved.query === "string" && typeof saved.page === "string" && Number.isInteger(saved.offset) && Number(saved.offset) >= 0 && Number(saved.offset) <= PAGE_SIZE && typeof saved.started_at === "string") {
                    return {
                        ...saved as unknown as EmailCursor,
                        processed_ids: Array.isArray(saved.processed_ids) ? saved.processed_ids.filter((id): id is string => typeof id === "string").slice(-PAGE_SIZE * 4) : [],

                    };
                }
            } catch {
                // A stale or edited checkpoint restarts with durable source-ID deduplication.
            }
        }

        const started_at = new Date().toISOString();
        const last_sync_ms = account.sync_scope === settings_key ? Date.parse(account.last_sync_at ?? "") : NaN;

        const initial_days = Math.max(
            1,
            Math.min(
                3650,
                account.initial_days || 7,
            ),
        );

        const since_ms = Number.isFinite(last_sync_ms) ? last_sync_ms - SYNC_OVERLAP_MS : Date.now() - initial_days * 86_400_000;
        let query: string;

        if (account.provider === "gmail") {
            query = `${account.query.trim()} after:${Math.floor(since_ms / 1000)}`.trim();
        } else {
            const folder = account.folder.toLowerCase() === "inbox" ? "inbox" : account.folder || "inbox";
            const url = new URL(`https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(folder)}/messages`);

            url.searchParams.set(
                "$top",
                String(PAGE_SIZE),
            );

            url.searchParams.set(
                "$select",
                "id,subject,bodyPreview,from,receivedDateTime,webLink",
            );

            url.searchParams.set(
                "$orderby",
                "receivedDateTime desc",
            );

            url.searchParams.set(
                "$filter",
                `receivedDateTime ge ${new Date(since_ms).toISOString()}`,
            );

            if (account.query.trim()) {
                url.searchParams.delete("$filter");
                url.searchParams.delete("$orderby");

                url.searchParams.set(
                    "$search",
                    `"(${account.query.trim().replaceAll(
                        '"',
                        '\\"',
                    )}) AND received>=${new Date(since_ms).toISOString().slice(
                        0,
                        10,
                    )}"`,
                );
            }

            query = url.toString();
        }

        return {
            provider: account.provider,
            query,
            page: "",
            offset: 0,
            processed_ids: [],
            started_at,
            settings_key,

        };
    }

    private async fetch_page(
        account: EmailAccount,
        signal: AbortSignal,
        cursor_override?: string,
    ): Promise<EmailPage> {
        const cursor = this.create_cursor(
            account,
            cursor_override,
        );

        const captures: CaptureInput[] = [];
        let next_page: string;

        if (account.provider === "gmail") {
            const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");

            url.searchParams.set(
                "maxResults",
                String(PAGE_SIZE),
            );

            url.searchParams.set(
                "q",
                cursor.query,
            );

            if (account.folder) {
                url.searchParams.set(
                    "labelIds",
                    account.folder.toLowerCase() === "inbox" ? "INBOX" : account.folder,
                );
            }

            if (cursor.page) {
                url.searchParams.set(
                    "pageToken",
                    cursor.page,
                );
            }

            const page = await this.request_authorized(
                account,
                url.toString(),
                signal,
            );

            next_page = read_string(page.nextPageToken);

            for (const reference of read_objects(page.messages)) {
                assert_not_cancelled(signal);

                try {
                    const message = await this.request_authorized(
                        account,
                        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(read_string(reference.id))}?format=full`,
                        signal,
                    );

                    captures.push(parse_email_capture(
                        account,
                        message,
                    ));
                } catch (error) {
                    if (!(error instanceof EmailRequestError && error.status === 404)) {
                        throw error;
                    }
                }
            }
        } else {
            const page = await this.request_authorized(
                account,
                cursor.page || cursor.query,
                signal,
            );

            next_page = read_string(page["@odata.nextLink"]);

            for (const reference of read_objects(page.value).filter((message) => !message["@removed"])) {
                assert_not_cancelled(signal);

                try {
                    const message = await this.request_authorized(
                        account,
                        `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(read_string(reference.id))}?$select=id,subject,body,bodyPreview,from,receivedDateTime,webLink`,
                        signal,
                    );

                    captures.push(parse_email_capture(
                        account,
                        message,
                    ));
                } catch (error) {
                    if (!(error instanceof EmailRequestError && error.status === 404)) {
                        throw error;
                    }
                }
            }
        }

        return {
            captures: captures.filter((capture) => !capture.external_id || !cursor.processed_ids.includes(capture.external_id)),
            has_more: Boolean(next_page),
            current_cursor: cursor,
            ...(next_page ? {
                next_cursor: JSON.stringify({
                    ...cursor,
                    page: next_page,
                    offset: 0,
                    processed_ids: [],

                })
            } : {}),

        };
    }

    async preview(
        account_id: string,
        cursor?: string,
    ): Promise<EmailPreview> {
        const signal = this.begin_operation("Loading a read-only email preview.");

        try {
            const page = await this.fetch_page(
                this.get_account(account_id),
                signal,
                cursor,
            );

            this.set_state({ message: `${page.captures.length} messages in this preview. Nothing was imported.` });

            return {
                captures: page.captures,
                has_more: page.has_more,
                ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}),

            };
        } finally {
            this.end_operation();
        }
    }

    async sync(account_id?: string): Promise<void> {
        const accounts = account_id ? [this.get_account(account_id)] : this.host.get_settings().email_accounts.filter((account) => account.secret_id);
        const signal = this.begin_operation("Importing read-only email copies.");

        let remaining = Math.max(
            1,
            Math.min(
                MAX_IMPORT_LIMIT,
                this.host.get_settings().import_limit || 500,
            ),
        );

        let pages_remaining = MAX_SYNC_PAGES;

        try {
            for (const account of accounts) {
                let should_reset_cursor = true;

                while (remaining > 0 && pages_remaining > 0) {
                    let page: EmailPage;

                    try {
                        page = await this.fetch_page(
                            account,
                            signal,
                        );
                    } catch (error) {
                        if (should_reset_cursor && account.cursor && error instanceof EmailRequestError && [400, 410].includes(error.status)) {
                            delete account.cursor;
                            await this.host.save_settings();
                            should_reset_cursor = false;
                            continue;
                        }

                        throw error;
                    }

                    pages_remaining -= 1;

                    let processed_count = 0;
                    const processed_ids = [...page.current_cursor.processed_ids];

                    for (const capture of page.captures) {
                        if (remaining <= 0) break;
                        assert_not_cancelled(signal);
                        const result = await this.host.repository.capture(capture);
                        this.set_state({
                            imported: this.state.imported + (result.status === "created" ? 1 : 0),
                            duplicates: this.state.duplicates + (result.status === "duplicate" ? 1 : 0),

                        });
                        processed_count += 1;
                        if (capture.external_id) processed_ids.push(capture.external_id);
                        if (result.status === "created") remaining -= 1;
                    }

                    assert_not_cancelled(signal);

                    if (account.sync_scope !== page.current_cursor.settings_key) {
                        delete account.last_sync_at;
                    }
                    account.sync_scope = page.current_cursor.settings_key;

                    if (processed_count < page.captures.length) {
                        account.cursor = JSON.stringify({
                            ...page.current_cursor,
                            offset: page.current_cursor.offset + processed_count,
                            processed_ids: [...new Set(processed_ids)].slice(-PAGE_SIZE * 4),

                        });

                        await this.host.save_settings();
                        break;
                    }

                    if (page.next_cursor) {
                        account.cursor = page.next_cursor;
                    } else {
                        delete account.cursor;
                        account.last_sync_at = page.current_cursor.started_at;
                    }

                    await this.host.save_settings();

                    if (!page.has_more) {
                        break;
                    }
                }
            }

            this.set_state({ message: `${this.state.imported} email copies imported; ${this.state.duplicates} duplicates skipped.${remaining === 0 || pages_remaining === 0 ? " Import again to continue." : ""}` });
        } catch (error) {
            this.set_state({ message: signal.aborted ? "Email import cancelled. Saved captures were kept." : "Email import stopped. Saved captures were kept; retry to continue." });
            throw error;
        } finally {
            this.end_operation();
        }
    }

    cancel(): void {
        this.controller?.abort();
    }

    start_polling(): void {
        clearTimeout(this.poll_timer);

        if (this.is_disposed) {
            return;
        }

        const accounts = this.host.get_settings().email_accounts.filter((account) => account.is_polling_enabled && account.secret_id);
        const now = Date.now();

        for (const account of accounts) {
            if (!this.next_poll_at.has(account.id)) {
                this.next_poll_at.set(
                    account.id,
                    now + Math.max(
                        1,
                        account.poll_interval_minutes,
                    ) * 60_000,
                );
            }
        }

        if (!accounts.length) {
            return;
        }

        const next_time = Math.min(...accounts.map((account) => this.next_poll_at.get(account.id) ?? now));

        this.poll_timer = setTimeout(
            () => {
                const due = accounts.find((account) => (this.next_poll_at.get(account.id) ?? 0) <= Date.now());

                if (due) {
                    this.next_poll_at.set(
                        due.id,
                        Date.now() + Math.max(
                            1,
                            due.poll_interval_minutes,
                        ) * 60_000,
                    );

                    if (!this.controller) {
                        void this.sync(due.id).catch(() => this.host.notify("Email polling could not finish an import. Open Inbox settings to review the account.")).finally(() => this.start_polling());

                        return;
                    }
                }

                this.start_polling();
            },
            Math.max(
                1000,
                next_time - now,
            ),
        );
    }

    async import_attachments(item_id: string): Promise<void> {
        const item = this.host.repository.get_item(item_id);

        if (!item?.external_id || !item.source_id?.startsWith("email:")) {
            throw new Error("Select an imported email capture first.");
        }

        const identity = read_email_identity(item.external_id);
        const account = this.host.get_settings().email_accounts.find((candidate) => candidate.provider === identity.provider && (candidate.account_address || candidate.id).toLowerCase() === identity.mailbox && candidate.secret_id);

        if (!account) {
            throw new Error("Reconnect the matching email account to import its attachments.");
        }

        const signal = this.begin_operation("Importing selected email attachments.");

        try {
            const message_url = account.provider === "gmail" ? `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(identity.message_id)}?format=full` : `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(identity.message_id)}/attachments?$top=25`;
            let page_url = message_url;
            let attachment_count = 0;

            for (let page_index = 0; page_url && page_index < MAX_ATTACHMENT_PAGES; page_index += 1) {
                const response = await this.request_authorized(
                    account,
                    page_url,
                    signal,
                );

                for (const attachment of get_email_attachment_descriptors(
                    account.provider,
                    response,
                )) {
                    assert_not_cancelled(signal);

                    const limit_bytes = this.host.get_settings().attachment_limit_mb * 1024 * 1024;

                    if (attachment.size_bytes > limit_bytes) {
                        throw new Error("An email attachment exceeds the configured size limit. Open the original email to download it.");
                    }

                    let data = attachment.data;

                    if (!data && attachment.id) {
                        const attachment_url = account.provider === "gmail" ? `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(identity.message_id)}/attachments/${encodeURIComponent(attachment.id)}` : `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(identity.message_id)}/attachments/${encodeURIComponent(attachment.id)}`;

                        const payload = await this.request_authorized(
                            account,
                            attachment_url,
                            signal,
                        );

                        data = read_string(account.provider === "gmail" ? payload.data : payload.contentBytes);
                    }

                    if (!data) {
                        continue;
                    }

                    const bytes = decode_base64_url(data);

                    if (bytes.byteLength > limit_bytes) {
                        throw new Error("An email attachment exceeds the configured size limit.");
                    }

                    const filename = attachment.name.replace(
                        /[\\/\p{Cc}]/gu,
                        "_",
                    ) || "attachment";

                    const file = new File(
                        [bytes.buffer as ArrayBuffer],
                        filename,
                        { type: attachment.content_type },
                    );

                    await this.host.repository.attach_files(
                        item_id,
                        [file],
                    );

                    attachment_count += 1;
                }

                page_url = account.provider === "outlook" ? read_string(response["@odata.nextLink"]) : "";
            }

            this.set_state({ message: `${attachment_count} email attachments imported.` });
        } finally {
            this.end_operation();
        }
    }

    dispose(): void {
        this.is_disposed = true;
        this.cancel();
        clearTimeout(this.poll_timer);
        this.next_poll_at.clear();
        this.access_tokens.clear();
        this.refresh_operations.clear();
        this.listeners.clear();
    }
}
