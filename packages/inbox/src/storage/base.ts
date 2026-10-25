import { parseYaml, stringifyYaml, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";

import type { InboxSettings } from "../contracts";

import { normalize_vault_path, sanitize_filename } from "./schema";

interface BaseConfiguration {
    views: Record<
        string,
        unknown
    >[];
    [key: string]: unknown;
}

export async function ensure_folder(
    app: App,
    path: string,
): Promise<void> {
    const normalized = normalize_vault_path(
        path,
        true,
    );

    if (!normalized) return;

    let current = "";

    for (const segment of normalized.split("/")) {
        current = current ? `${current}/${segment}` : segment;
        const existing = app.vault.getAbstractFileByPath(current);

        if (existing && !(existing instanceof TFolder)) {
            throw new Error(`A file already occupies the folder path ${current}.`);
        }

        if (!existing) {
            try {
                await app.vault.createFolder(current);
            } catch (error) {
                if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error;
            }
        }
    }
}

function parse_configuration(content: string): BaseConfiguration {
    let value: unknown;

    try {
        value = parseYaml(content);
    } catch (error) {
        throw Object.assign(
            new Error("The Inbox Base contains invalid YAML. Repair it or choose another Base location; its contents were preserved."),
            { cause: error },
        );
    }

    if (!value || typeof value !== "object" || !("views" in value) || !Array.isArray(value.views) || value.views.some((view) => !view || typeof view !== "object" || Array.isArray(view))) {
        throw new Error("The Inbox Base has no valid views. Add Beautiful Inbox Cards in Obsidian or choose another Base; its contents were preserved.");
    }

    const configuration = value as BaseConfiguration;

    if (!configuration.views.some((view) => view.type === "beautiful_inbox_list" || view.type === "beautiful_inbox_cards")) {
        throw new Error("The selected Base has no Beautiful Inbox layout. Add Beautiful Inbox Cards from the Base view menu, or choose another Base location.");
    }

    return configuration;
}

function is_generated_fallback(
    configuration: BaseConfiguration,
    view: Record<
        string,
        unknown
    >,
): boolean {
    return configuration.filters === "note.beautiful_inbox == true" && view.type === "table" && view.name === "Table" && JSON.stringify(view.order) === JSON.stringify(["file.name", "note.inbox_status", "note.inbox_kind", "note.captured_at", "note.tags"]) && Object.keys(view).every((key) => ["type", "name", "order"].includes(key));
}

export async function upgrade_inbox_base(
    app: App,
    file: TFile,
): Promise<Map<
    string,
    string
>> {
    const before = await app.vault.read(file);
    const configuration = parse_configuration(before);
    const renamed_views = new Map<
        string,
        string
    >();
    const has_legacy = configuration.views.some((view) => view.type === "beautiful_inbox_list" || is_generated_fallback(
        configuration,
        view,
    ));

    if (!has_legacy) return renamed_views;

    const views: Record<
        string,
        unknown
    >[] = [];
    const existing_names = new Set(configuration.views.filter((view) => view.type !== "beautiful_inbox_list").map((view) => String(view.name)));

    for (const view of configuration.views) {
        if (view.type === "beautiful_inbox_list") {
            const migrated: Record<
                string,
                unknown
            > = {
                ...view,
                type: "beautiful_inbox_cards",

            };
            const generated_name = view.name === "List";
            const comparable = (candidate: Record<
                string,
                unknown
            >): string => {
                const { type, name, ...remaining } = candidate;
                void type;
                void name;

                return JSON.stringify(remaining);
            };
            const equivalent = generated_name ? configuration.views.find((candidate) => candidate.type === "beautiful_inbox_cards" && comparable(candidate) === comparable(view)) : undefined;

            if (equivalent) {
                renamed_views.set(
                    String(view.name),
                    String(equivalent.name),
                );
                continue;
            }

            if (generated_name) {
                let name = "Cards";
                let suffix = 2;

                while (existing_names.has(name)) {
                    name = `Cards ${suffix++}`;
                }

                migrated.name = name;
                existing_names.add(name);
                renamed_views.set(
                    "List",
                    name,
                );
            }

            views.push(migrated);
        } else {
            if (!is_generated_fallback(
                configuration,
                view,
            )) views.push(view);
        }
    }

    const parent = file.path.split("/").slice(
        0,
        -1,
    ).join("/");
    const backup_folder = parent ? `${parent}/Backups` : "Backups";
    await ensure_folder(
        app,
        backup_folder,
    );
    const backup_name = `${backup_folder}/${sanitize_filename(file.basename)} pre-canvas ${Date.now()} ${crypto.randomUUID().slice(
        0,
        8,
    )}.base.bak`;
    await app.vault.create(
        backup_name,
        before,
    );

    await app.vault.process(
        file,
        (current) => {
            if (current !== before) {
                throw new Error("The Inbox Base changed during migration. Its original contents were backed up; reopen Inbox to retry.");
            }

            return stringifyYaml({
                ...configuration,
                views,

            });
        },
    );

    return renamed_views;
}

export async function ensure_inbox_base(
    app: App,
    settings: InboxSettings,
): Promise<TFile> {
    const folder = normalize_vault_path(
        settings.base_folder,
        true,
    );
    const requested_name = settings.base_name.replace(
        /\.base$/i,
        "",
    ).trim();
    const name = sanitize_filename(requested_name);

    if (name !== requested_name) throw new Error("The Inbox Base name contains invalid filename characters.");

    const path = folder ? `${folder}/${name}.base` : `${name}.base`;
    const existing = app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
        await upgrade_inbox_base(
            app,
            existing,
        );

        return existing;
    }

    if (existing) throw new Error("The Inbox Base path is occupied by a folder.");

    await ensure_folder(
        app,
        folder,
    );

    const configuration = {
        filters: "note.beautiful_inbox == true",
        views: [{
            type: "beautiful_inbox_cards",
            name: "Cards",
            column_count: settings.card_columns,
            should_snap_cards: settings.should_snap_cards,
            snap_grid_size: settings.snap_grid_size,
            should_show_grid: settings.should_show_grid,
            sort: [{
                property: "note.captured_at",
                direction: "DESC",

            }],
            order: ["file.name", "note.inbox_status", "note.captured_at"],

        }],

    };

    try {
        return await app.vault.create(
            path,
            stringifyYaml(configuration),
        );
    } catch (error) {
        const created = app.vault.getAbstractFileByPath(path);

        if (created instanceof TFile) return created;

        throw error;
    }
}
