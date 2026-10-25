import type { CaptureKind, InboxItem, InboxStatus } from "../contracts";

export type StatusFilter = InboxStatus | "all";
export type KindFilter = CaptureKind | "all";

export interface InboxGroup {
    label: string;
    items: InboxItem[];
}

export function filter_groups(
    groups: readonly InboxGroup[],
    query: string,
    status: StatusFilter,
    kind: KindFilter,
    search_cache: Map<
        string,
        {
            revision: string;
            text: string;
        }
    >,
): InboxGroup[] {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);

    return groups.map((group) => ({
        label: group.label,
        items: group.items.filter((item) => {
            if ((status !== "all" && item.status !== status) || (kind !== "all" && item.kind !== kind)) {
                return false;
            }

            let indexed = search_cache.get(item.id);

            if (!indexed || indexed.revision !== item.revision) {
                indexed = {
                    revision: item.revision,
                    text: [item.title, item.preview, item.source_url, item.source_note, ...item.tags].join(" ").toLocaleLowerCase(),
                };

                search_cache.set(
                    item.id,
                    indexed,
                );
            }

            return terms.every((term) => indexed.text.includes(term));
        }),
    })).filter((group) => group.items.length > 0);
}

export function resolve_active_item_id(
    collection: HTMLElement,
    active: Element | null,
    fallback?: string,
): string | undefined {
    if (!active || !collection.contains(active)) return undefined;

    return active.closest<HTMLElement>(".beautiful_inbox_item")?.dataset.itemId ?? fallback;
}

export const MAX_INTERACTIVE_CARDS = 200;

export function should_render_overview(
    zoom: number,
    visible_count: number,
): boolean {
    return zoom < 0.35 || visible_count > MAX_INTERACTIVE_CARDS;
}

export function select_interactive_nodes<Node extends { item: { id: string; }; }>(
    visible: readonly Node[],
    pinned: readonly Node[],
): Node[] {
    const chosen = new Map<string, Node>();

    for (const node of pinned.slice(
        0,
        MAX_INTERACTIVE_CARDS,
    )) chosen.set(
        node.item.id,
        node,
    );

    for (const node of visible) {
        if (chosen.size >= MAX_INTERACTIVE_CARDS) break;

        chosen.set(
            node.item.id,
            node,
        );
    }

    return [...chosen.values()];
}

export function can_start_card_drag(target: Element): boolean {
    if (target.closest('[data-canvas-handle="move"]')) return true;

    return !target.closest('input,button,a,textarea,select,[role="button"],.clickable-icon,[contenteditable="true"]');
}
