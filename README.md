# Beautiful Obsidian

A collection of beautiful Obsidian plugins.

`beautiful-obsidian` is a TypeScript monorepo by Mayaz Rakib. Its shared design system uses native Obsidian controls and theme variables. The repository contains the foundation, a development gallery, and [Beautiful Inbox](packages/inbox/README.md), a Markdown-based universal capture system with native Bases layouts.

## Development

Use Node.js 24 and npm 11. The package manager version is recorded in the root manifest.

```sh
npm ci
npm run check
npm run dev
```

`npm run check` runs type checking, linting, mocked component tests, builds, and output verification. `npm run dev` watches the library and gallery; `npm run build` also generates library declarations. Restart the watcher after changing build configuration.

## Structure

- `design/` contains the private `@beautiful/design` workspace, documentation, tests, and development gallery.
- `packages/inbox/` contains Beautiful Inbox. Other Beautiful plugins can be added under `packages/`.
- `assets/` is reserved for shared assets.

`assets/` is intentionally empty and has no placeholder file. Git does not store empty directories; recreate it with `mkdir -p assets` after cloning.

## Design system

Read the [design system guide](design/README.md) for the public API, integration examples, gallery setup, and visual acceptance checklist. Plugins bundle the library directly and copy its stylesheet into their own `styles.css`; users do not install a separate Core plugin.

The system inherits native control styling. Custom layouts use scoped rules and live Obsidian CSS variables. It does not set a custom palette, replace the user's theme, or override global application styles.

Automated tests use an explicit Obsidian mock. They do not establish native rendering, screen-reader behavior, mobile behavior, or compatibility with community themes. Use the gallery in Obsidian for those checks.

## License

[MIT](LICENSE). Copyright (c) 2026 Mayaz Rakib.
