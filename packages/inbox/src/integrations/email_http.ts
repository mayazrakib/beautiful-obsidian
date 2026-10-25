import { requestUrl } from "obsidian";
import type { RequestUrlParam } from "obsidian";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 30_000;
const ALLOWED_HOSTS = new Set([
    "gmail.googleapis.com",
    "oauth2.googleapis.com",
    "graph.microsoft.com",
    "login.microsoftonline.com",
]);

export class EmailRequestError extends Error {
    constructor(
        readonly status: number,
        readonly error_code: string,
    ) {
        super(`Email request failed (${status}). Reconnect the account or try again.`);
    }
}

export function assert_not_cancelled(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new Error("Email operation cancelled.");
    }
}

export function wait_for_delay(
    duration_ms: number,
    signal: AbortSignal,
): Promise<void> {
    assert_not_cancelled(signal);

    return new Promise((
        resolve,
        reject,
    ) => {
        const on_abort = (): void => {
            clearTimeout(timer);

            signal.removeEventListener(
                "abort",
                on_abort,
            );

            reject(new Error("Email operation cancelled."));
        };

        const timer = setTimeout(
            () => {
                signal.removeEventListener(
                    "abort",
                    on_abort,
                );

                resolve();
            },
            duration_ms,
        );

        signal.addEventListener(
            "abort",
            on_abort,
            { once: true },
        );
    });
}

export function validate_email_url(url: string): URL {
    const parsed_url = new URL(url);

    if (parsed_url.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed_url.hostname) || parsed_url.username || parsed_url.password) {
        throw new Error("The email provider returned an unsupported URL.");
    }

    return parsed_url;
}

function wait_for_request<Result>(
    request: PromiseLike<Result>,
    signal: AbortSignal,
): Promise<Result> {
    assert_not_cancelled(signal);

    return new Promise((
        resolve,
        reject,
    ) => {
        const cleanup = (): void => {
            clearTimeout(timer);

            signal.removeEventListener(
                "abort",
                on_abort,
            );
        };

        const on_abort = (): void => {
            cleanup();
            reject(new Error("Email operation cancelled."));
        };

        const timer = setTimeout(
            () => {
                cleanup();
                reject(new Error("The email request timed out. Try again."));
            },
            REQUEST_TIMEOUT_MS,
        );

        signal.addEventListener(
            "abort",
            on_abort,
            { once: true },
        );

        Promise.resolve(request).then(
            (result) => {
                cleanup();

                if (signal.aborted) {
                    reject(new Error("Email operation cancelled."));
                } else {
                    resolve(result);
                }
            },
            () => {
                cleanup();
                reject(new Error("The email provider could not be reached. Check your connection."));
            },
        );
    });
}

export async function request_email_json(
    options: RequestUrlParam,
    signal: AbortSignal,
): Promise<Record<string, unknown>> {
    validate_email_url(options.url);

    for (let attempt = 0;attempt <= MAX_RETRIES;attempt += 1) {
        assert_not_cancelled(signal);

        const response = await wait_for_request(
            requestUrl({
                ...options,
                throw: false,
            }),
            signal,
        );

        assert_not_cancelled(signal);

        let body: Record<string, unknown> = {};

        try {
            const value: unknown = JSON.parse(response.text);

            if (value && typeof value === "object" && !Array.isArray(value)) {
                body = value as Record<string, unknown>;
            }
        } catch {
            throw new Error("The email provider returned an unreadable response.");
        }

        if (response.status >= 200 && response.status < 300) {
            return body;
        }

        if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
            const retry_header = response.headers["retry-after"] ?? response.headers["Retry-After"];
            const retry_seconds = Number(retry_header);
            const retry_ms = Number.isFinite(retry_seconds) && retry_seconds > 0 ? retry_seconds * 1000 : 1000 * (2 ** attempt);

            await wait_for_delay(
                Math.min(
                    retry_ms,
                    MAX_RETRY_DELAY_MS,
                ),
                signal,
            );

            continue;
        }

        const error_value = body.error;
        const error_code = typeof error_value === "string" ? error_value : "provider_error";

        throw new EmailRequestError(
            response.status,
            error_code,
        );
    }

    throw new Error("The email provider is temporarily unavailable.");
}

export function read_string(
    value: unknown,
    fallback = "",
): string {
    return typeof value === "string" ? value : fallback;
}

export function read_object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function read_objects(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.map(read_object) : [];
}
