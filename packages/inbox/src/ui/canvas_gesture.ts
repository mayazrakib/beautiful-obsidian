import type { CanvasFrame } from "./canvas_model";

export interface CanvasPointerSample {
    pointer_id: number;
    client_x: number;
    client_y: number;
    should_snap: boolean;
}

export function calculate_gesture_frame(
    origin: CanvasFrame,
    dx_screen: number,
    dy_screen: number,
    start_zoom: number,
    is_resize: boolean,
): CanvasFrame {
    const zoom = Number.isFinite(start_zoom) && start_zoom > 0 ? start_zoom : 1;
    const delta_x = Number.isFinite(dx_screen) ? dx_screen / zoom : 0;
    const delta_y = Number.isFinite(dy_screen) ? dy_screen / zoom : 0;

    if (!is_resize) {
        return {
            ...origin,
            x: origin.x + delta_x,
            y: origin.y + delta_y,
        };
    }

    return {
        ...origin,
        width: Math.max(
            220,
            Math.min(
                1600,
                origin.width + delta_x,
            ),
        ),
        height: Math.max(
            120,
            Math.min(
                1600,
                origin.height + delta_y,
            ),
        ),
    };
}

export function should_snap_pointer(
    shift: boolean,
    is_enabled: boolean,
): boolean {
    return shift && is_enabled;
}
