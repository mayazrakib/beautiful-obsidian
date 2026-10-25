# Beautiful Obsidian

A collection of beautiful Obsidian plugins.

Beautiful is a TypeScript monorepo by Mayaz Rakib. Its shared design system uses native Obsidian controls and theme variables. The initial repository contains the foundation and a development gallery; the productivity plugins are not implemented yet.

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
- `packages/` is reserved for Beautiful Inbox, Calendar, Tasks, Projects, Reminders, Habits, and Focus.
- `assets/` is reserved for shared assets.

`packages/` and `assets/` are intentionally empty. Git does not store empty directories, so a fresh clone needs them recreated with `mkdir -p packages assets`. Neither directory contains a placeholder file.

## Design system

Read the [design system guide](design/README.md) for the public API, integration examples, gallery setup, and visual acceptance checklist. Plugins bundle the library directly and copy its stylesheet into their own `styles.css`; users do not install a separate Core plugin.

The system inherits native control styling. Custom layouts use scoped rules and live Obsidian CSS variables. It does not set a custom palette, replace the user's theme, or override global application styles.

Automated tests use an explicit Obsidian mock. They do not establish native rendering, screen-reader behavior, mobile behavior, or compatibility with community themes. Use the gallery in Obsidian for those checks.

## License

[MIT](LICENSE). Copyright (c) 2026 Mayaz Rakib.
