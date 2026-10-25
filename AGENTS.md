# Contributor entrypoint

## Architecture

This repository contains Beautiful's shared Obsidian design foundation and Beautiful Inbox. `design/` owns presentation primitives and patterns; plugins under `packages/` own domain behavior. Read [the design guide](design/README.md) before changing its public interfaces.

## Contracts

Use native Obsidian components and documented CSS variables. Preserve native defaults and scope custom CSS to Beautiful-owned elements. Keep gallery code out of library exports. Keep Obsidian external in plugin bundles. Avoid global runtime state, import-time DOM changes, and cross-plugin style overrides.

Public exports are explicit in `design/src/index.ts`; the CSS entrypoint is `@beautiful/design/styles.css`. Register UI lifetimes with an Obsidian Component. Dispose the owned surface when replacing a rendered view.

## Conventions

Use four spaces, strict TypeScript, PascalCase types, snake_case internal functions and variables, and UPPER_SNAKE_CASE constants. Preserve required external names such as `onOpen` and `setValue`. Format calls with two or more arguments vertically. Keep imports grouped by origin and purpose. Explain behavior through small working examples and typed interfaces.

Use the exact project description, "A collection of beautiful Obsidian plugins.", in project metadata. Attribute MIT copyright to Mayaz Rakib.

## Verification

Use Node.js 24 and npm 11. Run `npm ci` and `npm run check`. The checks execute without task-result caching. Use the gallery for native checks and record its Obsidian version, theme, platform, and results separately. Mocked DOM tests do not prove Obsidian integration.

Do not add placeholder files to `assets/` or empty plugin directories. Do not implement productivity domain features as design-system examples.
