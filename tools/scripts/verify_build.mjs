import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

import { build } from "esbuild";

const DESCRIPTION = "A collection of beautiful Obsidian plugins.";
const PACKAGE_PATHS = ["package.json", "design/package.json", "showcase/design/manifest.json", "packages/inbox/package.json", "packages/inbox/manifest.json"];

for (const package_path of PACKAGE_PATHS) {
    const metadata = JSON.parse(await readFile(
        package_path,
        "utf8",
    ));

    assert.equal(
        metadata.description,
        DESCRIPTION,
    );

    assert.equal(
        metadata.author,
        "Mayaz Rakib",
    );
}

const LICENSE_TEXT = await readFile(
    "LICENSE",
    "utf8",
);
assert.ok(LICENSE_TEXT.includes("Copyright (c) 2026 Mayaz Rakib"));

const DESIGN_PACKAGE = JSON.parse(await readFile(
    "design/package.json",
    "utf8",
));

for (const export_value of Object.values(DESIGN_PACKAGE.exports)) {
    const paths = typeof export_value === "string" ? [export_value] : Object.values(export_value);

    for (const export_path of paths) {
        await readFile(`design/${export_path}`);
    }
}

const CONSUMER_BUILD = await build({
    stdin: {
        contents: 'export * from "@beautiful/design";',
        resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    external: ["obsidian"],
});
const EXPECTED_EXPORTS = [
    "BeautifulModal", "DesignSurface", "create_button", "create_detail_section",
    "create_dropdown", "create_empty_state", "create_feedback", "create_icon_button",
    "create_menu", "create_record_row", "create_setting_row", "create_surface",
    "create_text_input", "create_toggle", "create_toolbar", "create_card", "create_checkbox", "create_text_area",
];

function verify_bundle(
    source,
    expected_exports,
) {
    const module_state = { exports: {} };

    const context = createContext({
        module: module_state,
        exports: module_state.exports,
        require(name) {
            assert.equal(
                name,
                "obsidian",
            );

            return {
                Component: class { },
                ExtraButtonComponent: class { },
                Modal: class { },
                Plugin: class { },
                ItemView: class { },
                BasesView: class { },
                PluginSettingTab: class { },
            };
        },
    });

    runInContext(
        source,
        context,
    );

    for (const export_name of expected_exports) {
        assert.equal(
            typeof module_state.exports[export_name],
            "function",
        );
    }
}

verify_bundle(
    CONSUMER_BUILD.outputFiles[0].text,
    EXPECTED_EXPORTS,
);
verify_bundle(
    await readFile(
        "design/dist/gallery/main.js",
        "utf8",
    ),
    ["default"],
);

const SOURCE_CSS = await readFile(
    "design/src/styles.css",
    "utf8",
);
assert.equal(
    await readFile(
        "design/dist/styles.css",
        "utf8",
    ),
    SOURCE_CSS,
);
assert.equal(
    await readFile(
        "design/dist/gallery/styles.css",
        "utf8",
    ),
    SOURCE_CSS,
);
assert.equal(
    await readFile(
        "design/dist/gallery/manifest.json",
        "utf8",
    ),
    await readFile(
        "showcase/design/manifest.json",
        "utf8",
    ),
);
assert.ok(!/(#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\()/i.test(SOURCE_CSS));
assert.ok(!/(?:^|[},])\s*(?:body|:root|html|\*)\b/m.test(SOURCE_CSS));

console.log("Verified public exports, external Obsidian runtime, import safety, gallery outputs, metadata, license, and theme stylesheet.");

const INBOX_SOURCE = await readFile(
    "packages/inbox/dist/main.js",
    "utf8",
);
verify_bundle(
    INBOX_SOURCE,
    ["default"],
);
const INBOX_STYLES = await readFile(
    "packages/inbox/dist/styles.css",
    "utf8",
);
const INBOX_SOURCE_STYLES = await readFile(
    "packages/inbox/src/styles.css",
    "utf8",
);
assert.equal(
    INBOX_STYLES,
    `${SOURCE_CSS}\n${INBOX_SOURCE_STYLES}`,
);
assert.equal(
    await readFile(
        "packages/inbox/dist/manifest.json",
        "utf8",
    ),
    await readFile(
        "packages/inbox/manifest.json",
        "utf8",
    ),
);
assert.ok((await readFile(
    "packages/inbox/dist/types/contracts.d.ts",
    "utf8",
)).includes("interface InboxApi"));
const INBOX_MANIFEST = JSON.parse(await readFile(
    "packages/inbox/dist/manifest.json",
    "utf8",
));
assert.equal(
    INBOX_MANIFEST.id,
    "beautiful-inbox",
);
assert.equal(
    INBOX_MANIFEST.minAppVersion,
    "1.12.2",
);
assert.equal(
    INBOX_MANIFEST.isDesktopOnly,
    false,
);
assert.ok(!/(#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\()/i.test(INBOX_SOURCE_STYLES));
assert.ok(!/(?:^|[},])\s*(?:body|:root|html|\*)\b/m.test(INBOX_SOURCE_STYLES));
console.log("Verified Inbox CommonJS output, shared stylesheet, manifest, and public API declarations.");
