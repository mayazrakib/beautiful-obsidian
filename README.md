# `beautiful-obsidian`

![Version](https://img.shields.io/badge/Version-0.1.0-737373?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-737373?style=flat-square)
![Languages](https://img.shields.io/badge/Languages-TypeScript%2C%20Python-737373?style=flat-square)
![Frameworks](https://img.shields.io/badge/Frameworks-Obsidian-737373?style=flat-square)
![Compatibility](https://img.shields.io/badge/Compatibility-Unknown-737373?style=flat-square)
![Build](https://img.shields.io/badge/Build-Not%20verified-737373?style=flat-square)
![Tests](https://img.shields.io/badge/Tests-Not%20measured-737373?style=flat-square)
![Vulnerabilities](https://img.shields.io/badge/Vulnerabilities-Unknown-737373?style=flat-square)

## 1. Introduction

A collection of beautiful Obsidian plugins.

This monorepo holds a shared native design library and Beautiful Inbox, a Markdown capture system built on native Bases layouts. The plugins use Obsidian's own components and theme variables, so they fit the vault they're installed in.

## 2. Usage

Install Node.js 24.22.0, npm 11.19.1, and Task 3.54.0. Then run `task init`, `task test`, and `task build`. `npm run dev` rebuilds the library and plugins as they change.

To try a plugin, copy its build output, such as `packages/inbox/dist/`, into an isolated Obsidian development vault. No development command deploys to a vault automatically. See each package README for package-specific usage.

## 3. Features

- Beautiful Inbox captures Markdown, links, files, audio, and email.
- Native Bases layouts support processing, searching, filtering, and arranging captures.
- The shared design library provides native controls, lifecycle ownership, and theme-aware layouts.
- A development gallery in `showcase/design/` demonstrates the design library.

## 4. Architecture

`design/` owns shared presentation, and `packages/` owns plugin behavior. `design/src/index.ts` declares the library's public exports, and `@beautiful/design/styles.css` exposes its CSS. Plugin bundles keep Obsidian external. Python scripts in `tools/scripts/` support native verification.

### Conventions

- Use native components and documented CSS variables, keep native defaults, and scope custom CSS to Beautiful-owned elements.
- Register lifetimes with an Obsidian `Component` and dispose of replaced surfaces.
- Keep gallery code out of library exports, avoid global state and import-time DOM changes, and preserve cross-plugin styles.
- Use the exact project description, "A collection of beautiful Obsidian plugins.", in metadata, and keep Mayaz Rakib's MIT attribution.
- Preserve required external names such as `onOpen` and `setValue`.
- Don't add placeholder assets, empty plugin directories, or productivity features to design examples.

Mocked DOM tests don't prove native Obsidian behavior. Native evidence must identify the Obsidian version, theme, and platform.

## 5. Dependencies

| Dependency | Version | Use |
|---|---|---|
| `@eslint/js` | 10.0.1 | Development: ESLint recommended rules |
| `@types/node` | 24.19.2 | Development: Node.js type declarations |
| `esbuild` | 0.28.2 | Build: plugin bundling |
| `eslint` | 10.13.0 | Development: explicitly invoked static checks |
| `globals` | 17.13.0 | Development: ESLint global definitions |
| `jsdom` | 30.1.3 | Development: DOM test environment |
| `typescript` | 6.0.3 | Build: compilation and type checks |
| `typescript-eslint` | 8.72.0 | Development: TypeScript lint rules |
| `vitest` | 5.0.5 | Development: mocked tests |
| `obsidian` | 1.14.4 | `@beautiful/design` and `@beautiful/inbox` development: plugin API declarations |

Inbox requires Obsidian 1.12.2 or newer at runtime. Package READMEs list each workspace package's own dependencies.

## 6. Roadmap

- [x] Shared design library and development gallery.
- [x] Beautiful Inbox, with native acceptance on Windows recorded in `packages/inbox/VERIFICATION.md`.

No further release commitments are recorded.

## 7. Contributing

Read `AGENTS.md` and the applicable skills in `.ai/skills/` before contributing. Set up the development environment with `task init`. Follow the repository conventions, preserve supported behavior, and add relevant tests for behavior changes. Run `task test` and `task build` before opening a pull request. Describe the change, its purpose, and the validation results in the pull request.

## 8. License

`beautiful-obsidian` is licensed under the MIT license. See LICENSE for the complete license text.
