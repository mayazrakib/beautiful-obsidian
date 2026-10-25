import { webcrypto } from "node:crypto";

import type { CliData, Plugin, RequestUrlParam } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CaptureInput, EmailAccount, InboxAttachment, InboxHost, InboxItem, InboxSettings } from "../src/contracts";

import { DEFAULT_SETTINGS } from "../src/defaults";
import { CoreAudioCapture } from "../src/integrations/audio";
import { InboxEmailService } from "../src/integrations/email";
import { create_pkce } from "../src/integrations/email_auth";
import { request_email_json } from "../src/integrations/email_http";
import { convert_html_to_text, get_email_attachment_descriptors, parse_email_capture } from "../src/integrations/email_messages";
import { parse_capture_input, register_capture_entrypoints } from "../src/integrations/entrypoints";

const REQUESTS = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock(
    "obsidian",
    () => ({
        requestUrl: REQUESTS.request,
        Platform: { isDesktopApp: true },
        MarkdownView: class { },

    }),
);

const CLEANUPS: (() => void)[] = [];

function create_item(
    id: string,
    input: CaptureInput = {},
): InboxItem {
    return {
        id,
        path: `Beautiful/Inbox/Items/${id}.md`,
        title: input.title ?? "Capture",
        kind: input.kind ?? "text",
        status: "unprocessed",
        captured_at: input.captured_at ?? new Date().toISOString(),
        tags: input.tags ?? [],
        preview: input.body ?? "",
        revision: "revision-1",
        ...(input.source_id ? { source_id: input.source_id } : {}),
        ...(input.external_id ? { external_id: input.external_id } : {}),

    };
}

function create_fixture(accounts: EmailAccount[] = []) {
    const settings: InboxSettings = {
        ...DEFAULT_SETTINGS,
        email_accounts: accounts,

    };

    const secrets = new Map<
        string,
        string
    >();
    const items = new Map<
        string,
        InboxItem
    >();
    const attachments = new Map<
        string,
        InboxAttachment[]
    >();
    const repository_listeners = new Set<() => void>();
    let active_item: InboxItem | undefined;

    const core = {
        recording: false,
        recorder: null as MediaRecorder | null,
        extension: "webm",
        checkPermission: vi.fn(async () => true),
        onStartRecording: vi.fn(async () => { }),
        onStopRecording: vi.fn(() => { }),

    };

    const capture = vi.fn(async (input: CaptureInput) => {
        const duplicate = [...items.values()].find((item) => input.external_id && item.external_id === input.external_id && item.source_id === input.source_id);

        if (duplicate) {
            return {
                status: "duplicate" as const,
                item: duplicate,

            };
        }

        const item = create_item(
            String(items.size + 1),
            input,
        );

        items.set(
            item.id,
            item,
        );

        return {
            status: "created" as const,
            item,

        };
    });

    const host = {
        app: {
            internalPlugins: { getEnabledPluginById: () => core },
            secretStorage: {
                getSecret: (id: string) => secrets.get(id) ?? null,
                setSecret: (
                    id: string,
                    value: string,
                ) => secrets.set(
                    id,
                    value,
                ),

            },
            workspace: {
                getActiveViewOfType: () => ({
                    file: active_item ? { path: active_item.path } : null,
                    editor: {
                        lastLine: () => 1,
                        getLine: () => "",
                        setCursor: vi.fn(),

                    },

                }),
            },

        },
        repository: {
            capture,
            get_item: (id: string) => items.get(id),
            list_items: () => [...items.values()],
            list_attachments: async (id: string) => attachments.get(id) ?? [],
            subscribe: (listener: () => void) => {
                repository_listeners.add(listener);

                return () => repository_listeners.delete(listener);
            },
            attach_files: vi.fn(async () => undefined),
            update_item: vi.fn(async () => undefined),
            process_items: vi.fn(async () => ({
                succeeded: [],
                failed: [],

            })),

        },
        get_settings: () => settings,
        save_settings: vi.fn(async () => { }),
        open_inbox: vi.fn(async () => { }),
        open_capture: vi.fn(),
        open_note: vi.fn(async (id: string) => { active_item = items.get(id); }),
        notify: vi.fn(),
        show_auth_code: vi.fn(),

    } as unknown as InboxHost;

    return {
        host,
        settings,
        secrets,
        items,
        attachments,
        repository_listeners,
        core,
        capture,

    };
}

function create_account(provider: "gmail" | "outlook" = "gmail"): EmailAccount {
    return {
        id: "account-1",
        provider,
        label: "Test account",
        client_id: "public-client-id",
        tenant: "common",
        folder: "INBOX",
        query: "",
        initial_days: 30,
        is_polling_enabled: false,
        poll_interval_minutes: 15,
        account_address: "test@example.com",
        secret_id: "beautiful-inbox-gmail-test",

    };
}

function respond(
    body: Record<
        string,
        unknown
    >,
    status = 200,
) {
    return Promise.resolve({
        status,
        headers: {},
        text: JSON.stringify(body),

    });
}

function gmail_message(id: string): Record<
    string,
    unknown
> {
    return {
        id,
        internalDate: "1700000000000",
        payload: {
            mimeType: "text/plain",
            headers: [{
                name: "Subject",
                value: `Message ${id}`,

            }, {
                name: "From",
                value: "Sender <sender@example.com>",

            }],
            body: { data: btoa("Plain email body") },

        },

    };
}

function use_gmail_fixture(message_ids: string[]): void {
    REQUESTS.request.mockImplementation((options: RequestUrlParam) => {
        const url = new URL(options.url);

        if (url.pathname === "/token") {
            return respond({
                access_token: "ephemeral-access-token",
                refresh_token: "rotated-refresh-token",
                expires_in: 3600,

            });
        }

        if (url.pathname.endsWith("/messages")) {
            return respond({ messages: message_ids.map((id) => ({ id })) });
        }

        return respond(gmail_message(decodeURIComponent(url.pathname.split("/").pop() ?? "")));
    });
}

afterEach(() => {
    for (const cleanup of CLEANUPS.splice(0)) {
        cleanup();
    }

    vi.useRealTimers();
    vi.unstubAllGlobals();
    REQUESTS.request.mockReset();
});

describe(
    "Email read-only import",
    () => {
        it(
            "restarts the initial window when an account import scope changes",
            async () => {
                const account = create_account();
                const fixture = create_fixture([account]);
                fixture.secrets.set(
                    account.secret_id ?? "",
                    JSON.stringify({ refresh_token: "refresh" }),
                );
                use_gmail_fixture([]);
                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                await service.sync(account.id);
                const old_scope = account.sync_scope;
                const old_sync = account.last_sync_at;
                account.query = "label:another-source";
                await service.preview(account.id);
                const message_requests = REQUESTS.request.mock.calls.map((call) => call[0] as RequestUrlParam).filter((options) => options.url.includes("/messages?"));
                const last_query = new URL(message_requests[message_requests.length - 1]?.url ?? "https://example.com").searchParams.get("q") ?? "";
                const after = Number(last_query.match(/after:(\d+)/)?.[1]);
                expect(after).toBeLessThan(Date.now() / 1000 - 29 * 86400);
                expect(last_query).toContain("label:another-source");
                expect(account.sync_scope).toBe(old_scope);
                expect(account.last_sync_at).toBe(old_sync);
                await service.sync(account.id);
                expect(account.sync_scope).not.toBe(old_scope);
            },
        );

        it(
            "does not carry a prior-scope watermark into an interrupted new-scope scan",
            async () => {
                const account = create_account();
                const fixture = create_fixture([account]);
                fixture.secrets.set(
                    account.secret_id ?? "",
                    JSON.stringify({ refresh_token: "refresh" }),
                );
                use_gmail_fixture([]);
                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                await service.sync(account.id);
                account.query = "label:new-scope";
                fixture.settings.import_limit = 2;
                use_gmail_fixture(["one", "two", "three"]);
                await service.sync(account.id);
                expect(account.last_sync_at).toBeUndefined();
                delete account.cursor;
                await service.preview(account.id);
                const requests = REQUESTS.request.mock.calls.map((call) => call[0] as RequestUrlParam).filter((options) => options.url.includes("/messages?"));
                const query = new URL(requests[requests.length - 1]?.url ?? "https://example.com").searchParams.get("q") ?? "";
                expect(Number(query.match(/after:(\d+)/)?.[1])).toBeLessThan(Date.now() / 1000 - 29 * 86400);
            },
        );

        it(
            "resumes a partial provider page by identity when earlier messages disappear",
            async () => {
                const account = create_account();
                const fixture = create_fixture([account]);
                fixture.settings.import_limit = 2;
                fixture.secrets.set(
                    account.secret_id ?? "",
                    JSON.stringify({ refresh_token: "refresh" }),
                );
                use_gmail_fixture(["one", "two", "three"]);
                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                await service.sync(account.id);
                expect(fixture.items.size).toBe(2);
                use_gmail_fixture(["two", "three"]);
                await service.sync(account.id);
                expect(fixture.items.size).toBe(3);
                expect(account.cursor).toBeUndefined();
            },
        );

        it(
            "previews without capture writes and stores only refresh tokens",
            async () => {
                const account = create_account();
                const fixture = create_fixture([account]);

                fixture.secrets.set(
                    account.secret_id ?? "",
                    JSON.stringify({ refresh_token: "old-refresh-token" }),
                );

                use_gmail_fixture(["message-1"]);

                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                const page = await service.preview(account.id);
                expect(page.captures).toHaveLength(1);
                expect(page.captures[0]?.body).toContain("Plain email body");
                expect(page.captures[0]?.source_id).toBe("email:gmail:test%40example.com");
                expect(fixture.capture).not.toHaveBeenCalled();
                const stored = fixture.secrets.get(account.secret_id ?? "") ?? "";
                expect(stored).toContain("rotated-refresh-token");
                expect(stored).not.toContain("ephemeral-access-token");
                expect(stored).not.toContain("access_token");
            },
        );

        it(
            "deduplicates source IDs when importing the same provider message again",
            async () => {
                const account = create_account();
                const fixture = create_fixture([account]);

                fixture.secrets.set(
                    account.secret_id ?? "",
                    JSON.stringify({ refresh_token: "refresh" }),
                );

                use_gmail_fixture(["message-1", "message-2"]);
                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                await service.sync(account.id);
                await service.sync(account.id);
                expect(fixture.items.size).toBe(2);
                expect(service.get_state().duplicates).toBe(2);
                expect(account.last_sync_at).toBeDefined();
                expect(REQUESTS.request.mock.calls.every((call) => !["PATCH", "DELETE", "PUT"].includes((call[0] as RequestUrlParam).method ?? "GET"))).toBe(true);
            },
        );

        it(
            "resumes a bounded partial page and clears its checkpoint after completion",
            async () => {
                const account = create_account();
                const fixture = create_fixture([account]);
                fixture.settings.import_limit = 2;

                fixture.secrets.set(
                    account.secret_id ?? "",
                    JSON.stringify({ refresh_token: "refresh" }),
                );

                use_gmail_fixture(["one", "two", "three"]);
                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                await service.sync(account.id);
                expect(fixture.items.size).toBe(2);
                expect(JSON.parse(account.cursor ?? "{}").offset).toBe(2);
                await service.sync(account.id);
                expect(fixture.items.size).toBe(3);
                expect(account.cursor).toBeUndefined();
            },
        );

        it(
            "cancels an outstanding request without importing messages",
            async () => {
                const account = create_account();
                const fixture = create_fixture([account]);

                fixture.secrets.set(
                    account.secret_id ?? "",
                    JSON.stringify({ refresh_token: "refresh" }),
                );

                REQUESTS.request.mockImplementation(() => new Promise(() => { }));
                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                const operation = service.sync(account.id);
                service.cancel();
                await expect(operation).rejects.toThrow("cancelled");
                expect(fixture.capture).not.toHaveBeenCalled();
            },
        );

        it(
            "blocks provider pagination URLs outside the authenticated provider",
            async () => {
                const account = create_account("outlook");
                const fixture = create_fixture([account]);

                fixture.secrets.set(
                    account.secret_id ?? "",
                    JSON.stringify({ refresh_token: "refresh" }),
                );

                account.cursor = JSON.stringify({
                    provider: "outlook",
                    query: "https://attacker.example/steal",
                    page: "",
                    offset: 0,
                    started_at: new Date().toISOString(),
                    settings_key: JSON.stringify([account.provider, account.folder, account.query, account.initial_days, account.account_address]),

                });

                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                await expect(service.preview(account.id)).rejects.toThrow("unsupported URL");
                expect(REQUESTS.request).not.toHaveBeenCalled();
            },
        );

        it(
            "uses immutable Outlook identifiers and requests plain text bodies",
            async () => {
                const account = create_account("outlook");
                const fixture = create_fixture([account]);

                fixture.secrets.set(
                    account.secret_id ?? "",
                    JSON.stringify({ refresh_token: "refresh" }),
                );

                REQUESTS.request.mockImplementation((options: RequestUrlParam) => {
                    if (options.url.endsWith("/token")) {
                        return respond({
                            access_token: "access",
                            refresh_token: "refresh",
                            expires_in: 3600,

                        });
                    }

                    if (options.url.includes("/mailFolders/")) {
                        return respond({ value: [{ id: "immutable-id" }] });
                    }

                    return respond({
                        id: "immutable-id",
                        subject: "Subject",
                        body: {
                            contentType: "text",
                            content: "Body",

                        },
                        from: { emailAddress: { address: "sender@example.com" } },
                        receivedDateTime: "2026-10-25T01:00:00Z",

                    });
                });

                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                const page = await service.preview(account.id);
                expect(page.captures[0]?.external_id).toContain("immutable-id");
                const requests = REQUESTS.request.mock.calls.map((call) => call[0] as RequestUrlParam).filter((options) => options.url.startsWith("https://graph.microsoft.com/"));
                expect(requests.every((options) => options.headers?.Prefer?.includes('IdType="ImmutableId"'))).toBe(true);
                expect(requests.every((options) => options.headers?.Prefer?.includes('outlook.body-content-type="text"'))).toBe(true);
            },
        );

        it(
            "scrubs disconnected credentials without removing imported captures",
            async () => {
                const account = create_account();
                const fixture = create_fixture([account]);
                const secret_id = account.secret_id ?? "";

                fixture.secrets.set(
                    secret_id,
                    JSON.stringify({ refresh_token: "refresh" }),
                );

                fixture.items.set(
                    "existing",
                    create_item("existing"),
                );

                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                await service.disconnect(account.id);
                expect(fixture.secrets.get(secret_id)).toBe("");
                expect(account.secret_id).toBeUndefined();
                expect(fixture.items.size).toBe(1);
            },
        );

        it(
            "pages previews without advancing the import checkpoint",
            async () => {
                const account = create_account();
                const fixture = create_fixture([account]);

                fixture.secrets.set(
                    account.secret_id ?? "",
                    JSON.stringify({ refresh_token: "refresh" }),
                );

                REQUESTS.request.mockImplementation((options: RequestUrlParam) => {
                    const url = new URL(options.url);

                    if (url.pathname === "/token") {
                        return respond({
                            access_token: "access",
                            refresh_token: "refresh",
                            expires_in: 3600,

                        });
                    }

                    if (url.pathname.endsWith("/messages")) {
                        return respond(url.searchParams.has("pageToken") ? { messages: [{ id: "second" }] } : {
                            messages: [{ id: "first" }],
                            nextPageToken: "page-two",

                        });
                    }

                    return respond(gmail_message(url.pathname.split("/").pop() ?? ""));
                });

                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                const first = await service.preview(account.id);

                const second = await service.preview(
                    account.id,
                    first.next_cursor,
                );

                expect(first.captures[0]?.title).toBe("Message first");
                expect(second.captures[0]?.title).toBe("Message second");
                expect(account.cursor).toBeUndefined();
                expect(fixture.capture).not.toHaveBeenCalled();
            },
        );

        it(
            "completes Outlook device sign-in using public-client tokens",
            async () => {
                vi.useFakeTimers();
                const account = create_account("outlook");
                delete account.secret_id;
                const fixture = create_fixture([account]);

                REQUESTS.request.mockImplementation((options: RequestUrlParam) => {
                    if (options.url.endsWith("/devicecode")) {
                        return respond({
                            device_code: "device-code",
                            user_code: "ABCD-EFGH",
                            verification_uri: "https://microsoft.com/devicelogin",
                            interval: 5,
                            expires_in: 900,

                        });
                    }

                    if (options.url.endsWith("/token")) {
                        expect(options.body).not.toContain("client_secret");

                        return respond({
                            access_token: "memory-only",
                            refresh_token: "refresh-only",
                            expires_in: 3600,

                        });
                    }

                    return respond({ mail: "test@example.com" });
                });

                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                const connection = service.connect(account.id);

                await vi.waitFor(() => expect(fixture.host.show_auth_code).toHaveBeenCalledWith(
                    "https://microsoft.com/devicelogin",
                    "ABCD-EFGH",
                ));

                await vi.advanceTimersByTimeAsync(5000);
                await connection;
                expect(fixture.secrets.get(account.secret_id ?? "")).toBe(JSON.stringify({ refresh_token: "refresh-only" }));
                expect(account.account_address).toBe("test@example.com");
            },
        );

        it(
            "imports attachments only through the explicit selected-email action",
            async () => {
                const account = create_account();
                const fixture = create_fixture([account]);

                fixture.secrets.set(
                    account.secret_id ?? "",
                    JSON.stringify({ refresh_token: "refresh" }),
                );

                const capture = await fixture.capture(parse_email_capture(
                    account,
                    gmail_message("message-1"),
                ));

                REQUESTS.request.mockImplementation((options: RequestUrlParam) => {
                    if (options.url.endsWith("/token")) {
                        return respond({
                            access_token: "access",
                            refresh_token: "refresh",
                            expires_in: 3600,

                        });
                    }

                    return respond({
                        payload: {
                            parts: [{
                                filename: "report.txt",
                                mimeType: "text/plain",
                                body: {
                                    data: btoa("attachment"),
                                    size: 10,

                                },

                            }]
                        }
                    });
                });

                const service = new InboxEmailService(fixture.host);
                CLEANUPS.push(() => service.dispose());
                expect(fixture.host.repository.attach_files).not.toHaveBeenCalled();
                await service.import_attachments(capture.item.id);
                expect(fixture.host.repository.attach_files).toHaveBeenCalledOnce();
            },
        );
    },
);

describe(
    "Provider payload boundaries",
    () => {
        it(
            "generates a random S256 PKCE challenge without a client secret",
            async () => {
                vi.stubGlobal(
                    "crypto",
                    webcrypto,
                );

                const first = await create_pkce();
                const second = await create_pkce();
                expect(first.verifier.length).toBeGreaterThanOrEqual(43);
                expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
                expect(first.state).not.toBe(second.state);
            },
        );

        it(
            "removes executable and remote-resource HTML from imported email text",
            () => {
                const body = convert_html_to_text('<p>Hello</p><img src="https://remote.example/pixel"><script>steal()</script><p>World</p>');
                expect(body).toContain("Hello");
                expect(body).toContain("World");
                expect(body).not.toContain("steal");
                expect(body).not.toContain("remote.example");
            },
        );

        it(
            "keeps nested Gmail attachment descriptors separate from message bodies",
            () => {
                const attachments = get_email_attachment_descriptors(
                    "gmail",
                    {
                        payload: {
                            parts: [{
                                mimeType: "multipart/mixed",
                                parts: [{
                                    filename: "file.pdf",
                                    mimeType: "application/pdf",
                                    body: {
                                        attachmentId: "attachment-id",
                                        size: 123,

                                    },

                                }],

                            }]
                        }
                    },
                );

                expect(attachments).toEqual([{
                    id: "attachment-id",
                    name: "file.pdf",
                    size_bytes: 123,
                    content_type: "application/pdf",

                }]);

                expect(parse_email_capture(
                    create_account(),
                    gmail_message("message-1"),
                ).kind).toBe("email");
            },
        );

        it(
            "retries a bounded provider failure without exposing response credentials",
            async () => {
                vi.useFakeTimers();

                REQUESTS.request.mockImplementation(() => respond(
                    {
                        error: "provider_error",
                        detail: "secret-response-body",

                    },
                    503,
                ));

                const operation = request_email_json(
                    { url: "https://gmail.googleapis.com/gmail/v1/users/me/messages" },
                    new AbortController().signal,
                );

                const rejection = expect(operation).rejects.toThrow("Email request failed (503)");
                await vi.runAllTimersAsync();
                await rejection;
                expect(REQUESTS.request).toHaveBeenCalledTimes(4);
            },
        );
    },
);

describe(
    "Capture entrypoints",
    () => {
        function register_fixture() {
            const fixture = create_fixture();
            const cli = new Map<
                string,
                (params: CliData) => string | Promise<string>
            >();
            let uri_handler: ((params: Record<
                string,
                string
            >) => void) | undefined;

            const plugin = {
                addCommand: vi.fn(),
                registerObsidianProtocolHandler: (
                    action: string,
                    callback: typeof uri_handler,
                ) => { void action; uri_handler = callback; },
                registerCliHandler: (
                    name: string,
                    description: string,
                    flags: unknown,
                    callback: (params: CliData) => string | Promise<string>,
                ) => {
                    void description; void flags;

                    cli.set(
                        name,
                        callback,
                    );
                },

            } as unknown as Plugin;

            register_capture_entrypoints(
                plugin,
                fixture.host,
            );

            return {
                ...fixture,
                cli,
                get_uri_handler: () => uri_handler,

            };
        }

        it(
            "opens the URI composer by default and maps bookmarklet text and URL",
            () => {
                const fixture = register_fixture();

                fixture.get_uri_handler()?.({
                    title: "Page",
                    text: "Selection",
                    url: "https://example.com/page",

                });

                expect(fixture.host.open_capture).toHaveBeenCalledWith({
                    title: "Page",
                    body: "Selection",
                    kind: "link",
                    source_url: "https://example.com/page",

                });

                expect(fixture.capture).not.toHaveBeenCalled();
            },
        );

        it(
            "autosaves URI captures only when the user enables the setting",
            async () => {
                const fixture = register_fixture();
                fixture.settings.should_save_uri_automatically = true;
                fixture.get_uri_handler()?.({ text: "Quick thought" });
                await vi.waitFor(() => expect(fixture.capture).toHaveBeenCalledOnce());
                expect(fixture.host.open_capture).not.toHaveBeenCalled();
            },
        );

        it(
            "validates source URLs and source identity pairs",
            () => {
                expect(() => parse_capture_input({ url: "javascript:alert(1)" })).toThrow("HTTP");
                expect(() => parse_capture_input({ source_id: "external" })).toThrow("together");
                expect(() => parse_capture_input({ kind: "unsupported" })).toThrow("supported");
            },
        );

        it(
            "returns bounded typed CLI JSON and rejects invalid cursors",
            async () => {
                const fixture = register_fixture();

                fixture.items.set(
                    "one",
                    create_item("one"),
                );

                const callback = fixture.cli.get("beautiful-inbox:list");
                const valid = JSON.parse(await callback?.({ limit: "1" }) ?? "{}");
                expect(valid.api_version).toBe(1);
                expect(valid.result.items).toHaveLength(1);
                const invalid = JSON.parse(await callback?.({ cursor: "-1" }) ?? "{}");
                expect(invalid.ok).toBe(false);
                expect(invalid.error.message).toContain("pagination");
            },
        );
    },
);

describe(
    "Core recorder ownership and asynchronous save",
    () => {
        it(
            "does not stop or adopt a recording started outside Inbox",
            async () => {
                const fixture = create_fixture();
                fixture.core.recording = true;
                const audio = new CoreAudioCapture(fixture.host);
                CLEANUPS.push(() => audio.dispose());
                await expect(audio.start()).rejects.toThrow("already has an audio recording");
                await expect(audio.stop()).rejects.toThrow("no Inbox-owned");
                expect(fixture.core.onStopRecording).not.toHaveBeenCalled();
            },
        );

        it(
            "does not mistake a settled failed core start for successful recording",
            async () => {
                const fixture = create_fixture();
                const audio = new CoreAudioCapture(fixture.host);
                CLEANUPS.push(() => audio.dispose());
                await expect(audio.start()).rejects.toThrow("did not start");
                expect(audio.get_state().phase).toBe("error");
                expect(fixture.items.size).toBe(1);
            },
        );

        it(
            "waits for an embedded attachment after the core has already stopped",
            async () => {
                const fixture = create_fixture();
                const recorder = new EventTarget() as unknown as MediaRecorder;

                Object.defineProperty(
                    recorder,
                    "state",
                    {
                        value: "recording",
                        configurable: true,

                    },
                );

                fixture.core.onStartRecording.mockImplementation(async () => {
                    fixture.core.recording = true;
                    fixture.core.recorder = recorder;
                });

                fixture.core.onStopRecording.mockImplementation(() => {
                    fixture.core.recording = false;
                    fixture.core.recorder = null;
                    recorder.dispatchEvent(new Event("stop"));
                });

                const audio = new CoreAudioCapture(fixture.host);
                CLEANUPS.push(() => audio.dispose());
                await audio.start();
                const operation = audio.stop();
                await vi.waitFor(() => expect(audio.get_state().phase).toBe("saving"));
                expect(fixture.core.recording).toBe(false);

                fixture.attachments.set(
                    "1",
                    [{
                        path: "Recording.webm",
                        name: "Recording.webm",
                        kind: "audio",
                        resource_url: "app://recording",
                        size_bytes: 100,

                    }],
                );

                for (const listener of fixture.repository_listeners) {
                    listener();
                }

                await operation;
                expect(audio.get_state().phase).toBe("idle");
                expect(fixture.host.open_note).toHaveBeenCalledTimes(2);
            },
        );

        it(
            "removes owned observers on unload without stopping another core session",
            async () => {
                vi.useFakeTimers();
                const fixture = create_fixture();
                const recorder = new EventTarget() as unknown as MediaRecorder;

                Object.defineProperty(
                    recorder,
                    "state",
                    { value: "recording" },
                );

                fixture.core.onStartRecording.mockImplementation(async () => {
                    fixture.core.recording = true;
                    fixture.core.recorder = recorder;
                });

                fixture.core.onStopRecording.mockImplementation(() => {
                    fixture.core.recording = false;
                    fixture.core.recorder = null;
                    recorder.dispatchEvent(new Event("stop"));
                });

                const audio = new CoreAudioCapture(fixture.host);
                await audio.start();
                const operation = audio.stop();
                await vi.waitFor(() => expect(audio.get_state().phase).toBe("saving"));
                audio.dispose();
                await operation;
                expect(vi.getTimerCount()).toBe(0);
                expect(fixture.repository_listeners.size).toBe(0);
                expect(fixture.core.onStopRecording).toHaveBeenCalledOnce();
            },
        );
    },
);
