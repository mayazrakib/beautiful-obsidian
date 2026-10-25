import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { resolve } from "node:path";

import { context } from "esbuild";

const IS_WATCHING = process.argv.includes("--watch");
const EXTERNAL_MODULES = ["obsidian", "electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

await mkdir(
    "dist",
    { recursive: true },
);

const BUILD_CONTEXT = await context({
    entryPoints: ["src/main.ts"],
    outfile: "dist/main.js",
    bundle: true,
    format: "cjs",
    target: "es2021",
    platform: "browser",
    external: EXTERNAL_MODULES,
    sourcemap: IS_WATCHING ? "inline" : false,
    plugins: [{
        name: "inbox-assets",
        setup(build) {
            build.onLoad(
                { filter: /src[/\\]main\.ts$/ },
                async (args) => ({
                    contents: await readFile(
                        args.path,
                        "utf8",
                    ),
                    loader: "ts",
                    resolveDir: resolve("src"),
                    watchFiles: [resolve("../../design/dist/styles.css"), resolve("src/styles.css"), resolve("manifest.json")],
                }),
            );

            build.onEnd(async (result) => {
                if (result.errors.length) {
                    return;
                }

                const styles = await Promise.all([
                    readFile(
                        "../../design/dist/styles.css",
                        "utf8",
                    ),
                    readFile(
                        "src/styles.css",
                        "utf8",
                    ),
                ]);

                await Promise.all([
                    writeFile(
                        "dist/styles.css",
                        styles.join("\n"),
                    ),
                    copyFile(
                        "manifest.json",
                        "dist/manifest.json",
                    ),
                ]);
            });
        },
    }],
});

if (IS_WATCHING) {
    await BUILD_CONTEXT.watch();
    console.log("Watching Beautiful Inbox. Reload the plugin in the development vault after changes.");
} else {
    try {
        await BUILD_CONTEXT.rebuild();
    } finally {
        await BUILD_CONTEXT.dispose();
    }
}
