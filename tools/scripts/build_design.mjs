import { copyFile, mkdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { resolve } from "node:path";

import { context } from "esbuild";

const IS_WATCHING = process.argv.includes("--watch");
const EXTERNAL_MODULES = ["obsidian", "electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

await mkdir(
    "dist/gallery",
    { recursive: true },
);

const BUILD_CONTEXTS = await Promise.all([
    context({
        entryPoints: ["src/index.ts"],
        outfile: "dist/index.js",
        bundle: true,
        format: "esm",
        target: "es2021",
        external: EXTERNAL_MODULES,
        sourcemap: true,
    }),
    context({
        entryPoints: ["../showcase/design/main.ts"],
        outfile: "dist/gallery/main.js",
        bundle: true,
        format: "cjs",
        target: "es2021",
        external: EXTERNAL_MODULES,
        sourcemap: IS_WATCHING ? "inline" : false,
        plugins: [{
            name: "copy-gallery-assets",
            setup(build) {
                build.onLoad(
                    { filter: /showcase[/\\]design[/\\]main\.ts$/ },
                    async (args) => ({
                        contents: await readFile(
                            args.path,
                            "utf8",
                        ),
                        loader: "ts",
                        resolveDir: resolve("../showcase/design"),
                        watchFiles: [resolve("src/styles.css"), resolve("../showcase/design/manifest.json")],
                    }),
                );

                build.onEnd(async () => {
                    await Promise.all([
                        copyFile(
                            "src/styles.css",
                            "dist/styles.css",
                        ),
                        copyFile(
                            "src/styles.css",
                            "dist/gallery/styles.css",
                        ),
                        copyFile(
                            "../showcase/design/manifest.json",
                            "dist/gallery/manifest.json",
                        ),
                    ]);
                });
            },
        }],
    }),
]);

if (IS_WATCHING) {
    await Promise.all(BUILD_CONTEXTS.map((build_context) => build_context.watch()));
    console.log("Watching the design library and gallery. Reload the gallery in Obsidian after changes.");
} else {
    try {
        await Promise.all(BUILD_CONTEXTS.map((build_context) => build_context.rebuild()));
    } finally {
        await Promise.all(BUILD_CONTEXTS.map((build_context) => build_context.dispose()));
    }
}
