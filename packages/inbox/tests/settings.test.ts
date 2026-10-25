import { describe, expect, it } from "vitest";

import { load_settings, validate_base_name, validate_vault_folder } from "../src/settings_schema";

describe(
    "Inbox settings",
    () => {
        it(
            "provides independent defaults and rejects filesystem escapes",
            () => {
                const first = load_settings(undefined);
                first.default_tags.push("changed");
                expect(load_settings(undefined).default_tags).toEqual([]);
                expect(() => validate_vault_folder("../outside")).toThrow();
                expect(() => validate_vault_folder("C:\\Users\\Mayaz")).toThrow();
                expect(() => validate_vault_folder(".obsidian/plugins")).toThrow();
                expect(() => validate_vault_folder(".trash/items")).toThrow();
                expect(() => validate_vault_folder("a//b")).toThrow();
                expect(() => validate_vault_folder("CON/items")).toThrow();
                expect(() => validate_vault_folder(".hidden/items")).toThrow();
                expect(load_settings({ default_tags: ["invalid tag"] }).default_tags).toEqual([]);
                expect(validate_vault_folder("Beautiful\\Inbox/")).toBe("Beautiful/Inbox");
                expect(validate_vault_folder("")).toBe("");
            },
        );

        it(
            "normalizes Base names and clamps numeric preferences",
            () => {
                expect(validate_base_name("Capture.base")).toBe("Capture");
                expect(() => validate_base_name("folder/Inbox")).toThrow();
                const settings = load_settings({
                    card_columns: -1,
                    should_snap_cards: false,
                    should_show_grid: true,
                    snap_grid_size: 100,
                    import_limit: NaN,
                    base_folder: "../escape",

                });
                expect(settings.card_columns).toBe(1);
                expect(settings.should_snap_cards).toBe(false);
                expect(settings.should_show_grid).toBe(true);
                expect(settings.snap_grid_size).toBe(64);
                expect(settings.import_limit).toBe(500);
                expect(settings.base_folder).toBe("Beautiful/Inbox");
            },
        );

        it(
            "persists whitelisted account configuration without credentials",
            () => {
                const settings = load_settings({
                    token: "should-never-be-saved",
                    email_accounts: [{
                        id: "account-id",
                        provider: "gmail",
                        client_id: "public-app-id",
                        access_token: "sensitive-access",
                        refresh_token: "sensitive-refresh",
                        secret_id: "beautiful-inbox-account-id",

                    }],

                });
                const serialized = JSON.stringify(settings);
                expect(serialized).not.toContain("sensitive");
                expect(serialized).not.toContain("should-never-be-saved");
                expect(settings.email_accounts[0]?.secret_id).toBe("beautiful-inbox-account-id");
                expect(settings.email_accounts[0]?.initial_days).toBe(7);
            },
        );
    },
);
