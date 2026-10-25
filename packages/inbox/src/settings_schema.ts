import type { EmailAccount, InboxSettings } from "./contracts";

import { DEFAULT_SETTINGS } from "./defaults";
import { normalize_tags, normalize_vault_path, sanitize_filename } from "./storage/schema";

export function validate_vault_folder(value: string): string {
    return normalize_vault_path(
        value,
        true,
    );
}

export function validate_base_name(value: string): string {
    const name = value.trim().replace(
        /\.base$/i,
        "",
    );

    if (sanitize_filename(name) !== name || !name) {
        throw new Error("Enter a valid Base filename without a folder path.");
    }

    return name;
}

function read_number(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(
        maximum,
        Math.max(
            minimum,
            Math.round(value),
        ),
    ) : fallback;
}

function read_account(value: unknown): EmailAccount | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }

    const account = value as Record<
        string,
        unknown
    >;

    if ((account.provider !== "gmail" && account.provider !== "outlook") || typeof account.id !== "string" || !/^[a-z0-9-]{1,100}$/.test(account.id)) {
        return undefined;
    }

    const result: EmailAccount = {
        id: account.id,
        provider: account.provider,
        label: typeof account.label === "string" ? account.label : account.provider,
        client_id: typeof account.client_id === "string" ? account.client_id : "",
        tenant: typeof account.tenant === "string" ? account.tenant : "common",
        folder: typeof account.folder === "string" ? account.folder : account.provider === "gmail" ? "INBOX" : "inbox",
        query: typeof account.query === "string" ? account.query : "",
        initial_days: read_number(
            account.initial_days,
            7,
            1,
            36500,
        ),
        is_polling_enabled: account.is_polling_enabled === true,
        poll_interval_minutes: read_number(
            account.poll_interval_minutes,
            15,
            1,
            1440,
        ),

    };

    for (const key of ["secret_id", "account_address", "cursor", "last_sync_at", "sync_scope"] as const) {
        if (typeof account[key] === "string") {
            result[key] = account[key];
        }
    }

    return result;
}

export function load_settings(value: unknown): InboxSettings {
    const settings = structuredClone(DEFAULT_SETTINGS);

    if (!value || typeof value !== "object") {
        return settings;
    }

    const input = value as Record<
        string,
        unknown
    >;

    for (const key of ["base_folder", "capture_folder", "attachment_folder"] as const) {
        if (typeof input[key] === "string") {
            try {
                settings[key] = validate_vault_folder(input[key]);
            } catch {
                settings[key] = DEFAULT_SETTINGS[key];
            }
        }
    }

    if (typeof input.base_name === "string") {
        try {
            settings.base_name = validate_base_name(input.base_name);
        } catch {
            settings.base_name = DEFAULT_SETTINGS.base_name;
        }
    }

    if (typeof input.filename_template === "string" && input.filename_template.trim()) {
        settings.filename_template = input.filename_template;
    }

    if (Array.isArray(input.default_tags)) {
        try {
            settings.default_tags = normalize_tags(input.default_tags);
        } catch {
            settings.default_tags = [];
        }
    }

    for (const key of ["should_show_previews", "should_show_metadata", "should_show_capture", "should_save_uri_automatically", "should_open_after_capture", "should_clear_after_capture", "is_audio_enabled", "should_restore_due", "should_snap_cards", "should_show_grid"] as const) {
        if (typeof input[key] === "boolean") {
            settings[key] = input[key];
        }
    }

    settings.card_columns = read_number(
        input.card_columns,
        3,
        1,
        8,
    );
    settings.snap_grid_size = read_number(
        input.snap_grid_size,
        16,
        8,
        64,
    );
    settings.attachment_limit_mb = read_number(
        input.attachment_limit_mb,
        25,
        1,
        250,
    );
    settings.import_limit = read_number(
        input.import_limit,
        500,
        1,
        10000,
    );

    if (Array.isArray(input.email_accounts)) {
        const accounts = input.email_accounts.map(read_account).filter((account): account is EmailAccount => account !== undefined);
        const seen = new Set<string>();
        settings.email_accounts = accounts.filter((account) => {
            if (seen.has(account.id)) {
                return false;
            }

            seen.add(account.id);

            return true;
        });
    }

    return settings;
}
