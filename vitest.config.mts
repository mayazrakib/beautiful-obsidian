import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            obsidian: fileURLToPath(new URL(
                "./design/tests/obsidian_mock.ts",
                import.meta.url,
            )),
        },
    },
    test: {
        environment: "jsdom",
        include: ["design/tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
        clearMocks: true,
    },
});
