import type { DesignSurface } from "./surface";

export function bind_callback<Arguments extends unknown[]>(
    surface: DesignSurface,
    callback: (...values: Arguments) => void,
): (...values: Arguments) => void {
    let current_callback: ((...values: Arguments) => void) | undefined = callback;

    surface.register(() => {
        current_callback = undefined;
    });

    return (...values) => {
        current_callback?.(...values);
    };
}
