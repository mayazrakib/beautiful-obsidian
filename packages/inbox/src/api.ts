import type { CaptureInput, InboxApi, InboxRepository, InboxSettings, InboxStatus, ItemPatch } from "./contracts";

const STATUSES: readonly InboxStatus[] = ["unprocessed", "deferred", "processed", "archived"];
const MAX_PAGE_SIZE = 200;
const MAX_BULK_ITEMS = 500;

function validate_integer(
    value: number,
    minimum: number,
    maximum: number,
): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`Use an integer from ${minimum} to ${maximum}.`);
    }

    return value;
}

export function create_inbox_api(
    repository: InboxRepository,
    get_settings: () => InboxSettings,
    when_ready: () => Promise<void> = async () => { },
): InboxApi {
    return {
        version: 1,
        capture: async (input: CaptureInput) => {
            await when_ready();
            return structuredClone(await repository.capture(input));
        },
        read: async (id: string) => {
            await when_ready();
            const body = await repository.read_body(id);

            return {
                item: structuredClone(repository.get_item(id)),
                body,
            };
        },
        list: (options = {}) => {
            const limit = validate_integer(
                options.limit ?? 50,
                1,
                MAX_PAGE_SIZE,
            );
            const offset = validate_integer(
                options.offset ?? 0,
                0,
                Number.MAX_SAFE_INTEGER,
            );

            if (options.status !== undefined && !STATUSES.includes(options.status)) {
                throw new Error("Choose a valid Inbox status.");
            }

            const items = repository.list_items().filter((item) => !options.status || item.status === options.status);

            return {
                items: structuredClone(items.slice(
                    offset,
                    offset + limit,
                )),
                total: items.length,
                next_offset: offset + limit < items.length ? offset + limit : null,

            };
        },
        update: async (
            id: string,
            patch: ItemPatch,
            expected_revision?: string,
        ) => {
            await when_ready();
            return structuredClone(await repository.update_item(
                id,
                patch,
                expected_revision,
            ));
        },
        process: async (
            ids: string[],
            status: InboxStatus,
            review_at?: string,
        ) => {
            if (!Array.isArray(ids) || ids.length > MAX_BULK_ITEMS || ids.some((id) => typeof id !== "string")) {
                throw new Error("Process at most 500 capture IDs at a time.");
            }

            await when_ready();
            return repository.process_items(
                ids,
                status,
                review_at,
            );
        },
        import: async (captures: CaptureInput[]) => {
            await when_ready();
            if (!Array.isArray(captures) || captures.length > get_settings().import_limit) {
                throw new Error("The import exceeds the configured capture limit.");
            }

            const results = [];

            for (const capture of captures) {
                results.push(structuredClone(await repository.capture(capture)));
            }

            return results;
        },
        get_item: (id: string) => structuredClone(repository.get_item(id)),

    };
}
