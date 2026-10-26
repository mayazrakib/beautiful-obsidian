# `beautiful-obsidian`

![Version](https://img.shields.io/badge/Version-0.1.0-737373?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-737373?style=flat-square)
![Languages](https://img.shields.io/badge/Languages-TypeScript%20and%20Python-737373?style=flat-square)
![Frameworks](https://img.shields.io/badge/Frameworks-Obsidian-737373?style=flat-square)
![Compatibility](https://img.shields.io/badge/Compatibility-Unknown-737373?style=flat-square)
![Build](https://img.shields.io/badge/Build-Not%20verified-737373?style=flat-square)
![Tests](https://img.shields.io/badge/Tests-Not%20measured-737373?style=flat-square)
![Vulnerabilities](https://img.shields.io/badge/Vulnerabilities-Unknown-737373?style=flat-square)

## 1. Introduction

A collection of beautiful Obsidian plugins.

The monorepo contains a shared native design library and Beautiful Inbox, a Markdown capture system with native Bases layouts.

## 2. Usage

Use Node.js 24.22.0, npm 11.19.1, and Task 3.54.0. Run `task init`, `task test`, and `task build`. `npm run dev` watches the library and plugins. Copy plugin outputs from `packages/inbox/dist/` into an isolated Obsidian development vault; no development command deploys automatically.

## 3. Features

Beautiful Inbox captures Markdown, links, files, audio, and email. Native Bases layouts support processing, searching, filtering, and arranging captures. The shared design library provides native controls, lifecycle ownership, and theme-aware layouts.

## 4. Architecture

`design/` owns shared presentation; `packages/` owns plugin behavior. Keep Obsidian external in bundles. Use native components and documented CSS variables, retain native defaults, and scope custom CSS to Beautiful-owned elements. Public exports are explicit in `design/src/index.ts`; CSS is exposed through `@beautiful/design/styles.css`. Register lifetimes with an Obsidian Component and dispose replaced surfaces. Keep gallery code out of library exports, avoid global state and import-time DOM changes, and preserve cross-plugin styles.

Use the exact project description, "A collection of beautiful Obsidian plugins.", in metadata and retain Mayaz Rakib's MIT attribution. Preserve required external names such as `onOpen` and `setValue`. Mocked DOM tests do not prove native Obsidian behavior; native evidence must identify the Obsidian version, theme, and platform. Avoid placeholder assets, empty plugin directories, and productivity features in design examples.

## 5. Dependencies

| Dependency | Version | Use |
|---|---|---|
| Obsidian | 1.14.4 development SDK; Inbox requires 1.12.2+ | Native plugin APIs and Bases. |
| TypeScript, esbuild, and Vitest | See `package-lock.json` | Compilation, bundling, and mocked tests. |
| jsdom and ESLint | See `package-lock.json` | DOM test environment and explicitly invoked static checks. |

## 6. Roadmap

The design library, gallery, and Inbox are implemented. Native platform acceptance remains separate from mocked tests. See the package READMEs for usage.

## 7. Contributing

Read `AGENTS.md` and the applicable skills in `.ai/skills/` before contributing. Set up the development environment with `task init`. Follow the repository conventions, preserve supported behavior, and add relevant tests for behavior changes. Run `task test` and `task build` before opening a pull request. Describe the change, its purpose, and the validation results in the pull request.

## 8. License

`beautiful-obsidian` is licensed under the MIT license. See LICENSE for the complete license text.

See `ACKNOWLEDGEMENTS.md` for third-party notices and attributions.
