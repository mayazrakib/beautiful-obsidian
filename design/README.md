# `@beautiful/design`

![Version](https://img.shields.io/badge/Version-0.1.0-737373?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-737373?style=flat-square)
![Languages](https://img.shields.io/badge/Languages-TypeScript-737373?style=flat-square)
![Frameworks](https://img.shields.io/badge/Frameworks-Obsidian-737373?style=flat-square)
![Compatibility](https://img.shields.io/badge/Compatibility-Unknown-737373?style=flat-square)
![Build](https://img.shields.io/badge/Build-Not%20verified-737373?style=flat-square)
![Tests](https://img.shields.io/badge/Tests-Not%20measured-737373?style=flat-square)
![Vulnerabilities](https://img.shields.io/badge/Vulnerabilities-Unknown-737373?style=flat-square)

## 1. Introduction

Native Obsidian controls, layouts, lifecycle ownership, and a development gallery.

## 2. Usage

Run `task init`, `task test`, and `task build` here. Import explicit exports from `@beautiful/design` and its stylesheet from `@beautiful/design/styles.css`. Bundle Obsidian externally.

## 3. Features

Controls, menus, settings rows, modals, record layouts, feedback, and lifecycle cleanup.

## 4. Architecture

`src/` owns the public design API. `../showcase/design/` owns the gallery; emitted gallery files remain in `dist/gallery/`. Register views with an Obsidian Component, dispose replaced surfaces, and retain scoped CSS and native theme variables. Shared Meson JSON tokens do not override Obsidian themes.

## 5. Dependencies

| Dependency | Version | Use |
|---|---|---|
| Obsidian | 1.14.4 | Runtime and build integration; complete declarations and resolved versions remain in the workspace manifests and root lockfiles. |

## 6. Roadmap

The capabilities above are implemented. No additional release commitments are recorded here.

## 7. Contributing

Read `AGENTS.md` and the applicable skills in `.ai/skills/` before contributing. Set up the development environment with `task init`. Follow the repository conventions, preserve supported behavior, and add relevant tests for behavior changes. Run `task test` and `task build` before opening a pull request. Describe the change, its purpose, and the validation results in the pull request.

## 8. License

`@beautiful/design` is licensed under the MIT license. See LICENSE for the complete license text.

See `ACKNOWLEDGEMENTS.md` for third-party notices and attributions.
