import { Platform } from "obsidian";

import type { EmailAccount, InboxHost } from "../contracts";

import { assert_not_cancelled, EmailRequestError, read_string, request_email_json, wait_for_delay } from "./email_http";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const MICROSOFT_SCOPE = "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read";
const AUTH_TIMEOUT_MS = 5 * 60_000;

export interface EmailTokens {
    access_token: string;
    refresh_token?: string;
    expires_at: number;
}

function encode_base64_url(bytes: Uint8Array): string {
    let binary = "";

    for (const value of bytes) {
        binary += String.fromCharCode(value);
    }

    return btoa(binary).replaceAll(
        "+",
        "-",
    ).replaceAll(
        "/",
        "_",
    ).replace(
        /=+$/,
        "",
    );
}

export async function create_pkce(): Promise<{ verifier: string; challenge: string; state: string; }> {
    const verifier = encode_base64_url(crypto.getRandomValues(new Uint8Array(48)));

    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
    );

    return {
        verifier,
        challenge: encode_base64_url(new Uint8Array(digest)),
        state: encode_base64_url(crypto.getRandomValues(new Uint8Array(32))),
    };
}

export function read_tokens(
    response: Record<string, unknown>,
    previous_refresh_token?: string,
): EmailTokens {
    const access_token = read_string(response.access_token);

    const refresh_token = read_string(
        response.refresh_token,
        previous_refresh_token ?? "",
    );

    const expiry_seconds = Number(response.expires_in);

    if (!access_token || !Number.isFinite(expiry_seconds) || expiry_seconds <= 0) {
        throw new Error("The email provider did not return a usable sign-in token.");
    }

    return {
        access_token,
        expires_at: Date.now() + (expiry_seconds * 1000),
        ...(refresh_token ? { refresh_token } : {}),
    };
}

export function get_token_endpoint(account: EmailAccount): string {
    return account.provider === "gmail" ? "https://oauth2.googleapis.com/token" : `https://login.microsoftonline.com/${encodeURIComponent(account.tenant || "common")}/oauth2/v2.0/token`;
}

export async function refresh_tokens(
    account: EmailAccount,
    tokens: EmailTokens,
    signal: AbortSignal,
): Promise<EmailTokens> {
    if (!tokens.refresh_token) {
        throw new Error("Reconnect this email account to continue importing.");
    }

    const response = await request_email_json(
        {
            url: get_token_endpoint(account),
            method: "POST",
            contentType: "application/x-www-form-urlencoded",
            body: new URLSearchParams({
                client_id: account.client_id,
                grant_type: "refresh_token",
                refresh_token: tokens.refresh_token,
                ...(account.provider === "outlook" ? { scope: MICROSOFT_SCOPE } : {}),
            }).toString(),
        },
        signal,
    );

    return read_tokens(
        response,
        tokens.refresh_token,
    );
}

async function connect_google(
    account: EmailAccount,
    host: InboxHost,
    signal: AbortSignal,
): Promise<EmailTokens> {
    if (!Platform.isDesktopApp) {
        throw new Error("Google sign-in requires Obsidian desktop. Imported notes remain available on mobile.");
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron cannot import node: URLs; defer native loading until after the desktop guard.
    const { createServer } = require("node:http") as typeof import("node:http");
    const pkce = await create_pkce();
    const callback_path = `/beautiful-inbox/${pkce.state}`;
    let resolve_code: ((value: string) => void) | undefined;
    let reject_code: ((reason: Error) => void) | undefined;

    const code_promise = new Promise<string>((
        resolve,
        reject,
    ) => {
        resolve_code = resolve;
        reject_code = reject;
    });
    // A listener is installed before opening the browser so early aborts cannot leak a rejection.
    void code_promise.catch(() => { });

    const server = createServer((
        request,
        response,
    ) => {
        const callback = new URL(
            request.url ?? "/",
            "http://127.0.0.1",
        );

        if (request.method !== "GET" || callback.pathname !== callback_path || callback.searchParams.get("state") !== pkce.state) {
            response.writeHead(
                400,
                {
                    "Content-Type": "text/plain",
                    "Cache-Control": "no-store",
                },
            );

            response.end("This sign-in response could not be verified.");

            return;
        }

        response.writeHead(
            200,
            {
                "Content-Type": "text/plain",
                "Cache-Control": "no-store",
                "Content-Security-Policy": "default-src 'none'",
            },
        );

        response.end("Return to Obsidian to finish connecting Beautiful Inbox.");

        const code = callback.searchParams.get("code");

        if (code && !callback.searchParams.has("error")) {
            resolve_code?.(code);
        } else {
            reject_code?.(new Error("Google sign-in was not completed."));
        }
    });

    const on_abort = (): void => reject_code?.(new Error("Email operation cancelled."));

    const timer = setTimeout(
        () => reject_code?.(new Error("Email sign-in timed out. Try connecting again.")),
        AUTH_TIMEOUT_MS,
    );

    signal.addEventListener(
        "abort",
        on_abort,
        { once: true },
    );

    try {
        assert_not_cancelled(signal);

        await new Promise<void>((
            resolve,
            reject,
        ) => {
            server.once(
                "error",
                () => reject(new Error("Could not open the local sign-in callback. Try again.")),
            );

            server.listen(
                0,
                "127.0.0.1",
                () => resolve(),
            );
        });

        const address = server.address();

        if (!address || typeof address === "string") {
            throw new Error("The local sign-in callback is unavailable.");
        }

        assert_not_cancelled(signal);

        const redirect_uri = `http://127.0.0.1:${address.port}${callback_path}`;
        const authorization_url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

        authorization_url.search = new URLSearchParams({
            client_id: account.client_id,
            response_type: "code",
            redirect_uri,
            scope: GOOGLE_SCOPE,
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
            state: pkce.state,
            access_type: "offline",
            prompt: "consent",
        }).toString();

        host.show_auth_code(
            authorization_url.toString(),
            "Continue in your browser",
        );

        window.open(
            authorization_url.toString(),
            "_blank",
            "noopener",
        );

        const code = await code_promise;

        const response = await request_email_json(
            {
                url: get_token_endpoint(account),
                method: "POST",
                contentType: "application/x-www-form-urlencoded",
                body: new URLSearchParams({
                    client_id: account.client_id,
                    grant_type: "authorization_code",
                    code,
                    code_verifier: pkce.verifier,
                    redirect_uri,
                }).toString(),
            },
            signal,
        );

        return read_tokens(response);
    } finally {
        clearTimeout(timer);

        signal.removeEventListener(
            "abort",
            on_abort,
        );

        server.close();
        server.closeAllConnections();
    }
}

async function connect_microsoft(
    account: EmailAccount,
    host: InboxHost,
    signal: AbortSignal,
): Promise<EmailTokens> {
    const endpoint = get_token_endpoint(account);

    const response = await request_email_json(
        {
            url: endpoint.replace(
                /\/token$/,
                "/devicecode",
            ),
            method: "POST",
            contentType: "application/x-www-form-urlencoded",
            body: new URLSearchParams({
                client_id: account.client_id,
                scope: MICROSOFT_SCOPE,
            }).toString(),
        },
        signal,
    );

    const device_code = read_string(response.device_code);
    const user_code = read_string(response.user_code);
    const verification_uri = read_string(response.verification_uri);

    if (!device_code || !user_code || !/^https:\/\/(?:microsoft\.com|www\.microsoft\.com|login\.microsoftonline\.com)\//.test(verification_uri)) {
        throw new Error("Microsoft did not return usable device sign-in instructions.");
    }

    host.show_auth_code(
        verification_uri,
        user_code,
    );

    let interval_ms = Math.max(
        5,
        Number(response.interval) || 5,
    ) * 1000;

    const expires_at = Date.now() + Math.min(
        Number(response.expires_in) || 900,
        900,
    ) * 1000;

    while (Date.now() < expires_at) {
        await wait_for_delay(
            interval_ms,
            signal,
        );

        try {
            const token_response = await request_email_json(
                {
                    url: endpoint,
                    method: "POST",
                    contentType: "application/x-www-form-urlencoded",
                    body: new URLSearchParams({
                        client_id: account.client_id,
                        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                        device_code,
                    }).toString(),
                },
                signal,
            );

            return read_tokens(token_response);
        } catch (error) {
            if (error instanceof EmailRequestError && error.error_code === "authorization_pending") {
                continue;
            }

            if (error instanceof EmailRequestError && error.error_code === "slow_down") {
                interval_ms += 5000;
                continue;
            }

            throw error;
        }
    }

    throw new Error("Microsoft sign-in expired. Try connecting again.");
}

export async function connect_email_account(
    account: EmailAccount,
    host: InboxHost,
    signal: AbortSignal,
): Promise<EmailTokens> {
    if (!account.client_id.trim()) {
        throw new Error("Enter your provider's public OAuth client ID before connecting.");
    }

    return account.provider === "gmail" ? connect_google(
        account,
        host,
        signal,
    ) : connect_microsoft(
        account,
        host,
        signal,
    );
}
