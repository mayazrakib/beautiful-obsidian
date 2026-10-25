import { describe, expect, it } from "vitest";

import {
    calculate_gesture_frame,
    should_snap_pointer,
} from "../src/ui/canvas_gesture";

const ORIGIN = Object.freeze({
    x: 100.125,
    y: -50.25,
    width: 320,
    height: 200,
});

describe(
    "Fluid canvas gestures",
    () => {
        it(
            "preserves fractional pointer movement in world units without grid rounding",
            () => {
                const frame = calculate_gesture_frame(
                    ORIGIN,
                    0.75,
                    -0.375,
                    1.5,
                    false,
                );

                expect(frame).toEqual({
                    ...ORIGIN,
                    x: 100.625,
                    y: -50.5,
                });

                expect(frame).not.toBe(ORIGIN);
            },
        );

        it(
            "uses the gesture origin for each sample and leaves discarded previews harmless",
            () => {
                const first = calculate_gesture_frame(
                    ORIGIN,
                    10,
                    10,
                    0.5,
                    false,
                );

                const latest = calculate_gesture_frame(
                    ORIGIN,
                    10.25,
                    10.125,
                    0.5,
                    false,
                );

                expect(latest.x - first.x).toBe(0.5);
                expect(latest.y - first.y).toBe(0.25);

                expect(ORIGIN).toEqual({
                    x: 100.125,
                    y: -50.25,
                    width: 320,
                    height: 200,
                });
            },
        );

        it(
            "resizes with zoom-adjusted fractional deltas while keeping the origin fixed",
            () => {
                expect(calculate_gesture_frame(
                    ORIGIN,
                    7.5,
                    -3.25,
                    2,
                    true,
                )).toEqual({
                    ...ORIGIN,
                    width: 323.75,
                    height: 198.375,
                });
            },
        );

        it(
            "bounds resize dimensions and leaves movement dimensions unchanged",
            () => {
                expect(calculate_gesture_frame(
                    ORIGIN,
                    -10000,
                    -10000,
                    1,
                    true,
                )).toEqual({
                    ...ORIGIN,
                    width: 220,
                    height: 120,
                });

                expect(calculate_gesture_frame(
                    ORIGIN,
                    10000,
                    10000,
                    1,
                    true,
                )).toEqual({
                    ...ORIGIN,
                    width: 1600,
                    height: 1600,
                });

                expect(calculate_gesture_frame(
                    { ...ORIGIN, width: 1800 },
                    1,
                    1,
                    1,
                    false,
                ).width).toBe(1800);
            },
        );

        it(
            "uses safe defaults for invalid zoom and pointer values",
            () => {
                for (const zoom of [0, -1, NaN, Infinity]) {
                    expect(calculate_gesture_frame(
                        ORIGIN,
                        NaN,
                        Infinity,
                        zoom,
                        false,
                    )).toEqual(ORIGIN);
                }
            },
        );
    },
);

describe(
    "Shift-only snapping",
    () => {
        it(
            "snaps only while Shift is held and snapping is enabled",
            () => {
                expect(should_snap_pointer(
                    false,
                    false,
                )).toBe(false);

                expect(should_snap_pointer(
                    false,
                    true,
                )).toBe(false);

                expect(should_snap_pointer(
                    true,
                    false,
                )).toBe(false);

                expect(should_snap_pointer(
                    true,
                    true,
                )).toBe(true);
            },
        );
    },
);
