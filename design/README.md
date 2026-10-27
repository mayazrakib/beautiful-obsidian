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

`@beautiful/design` is the shared design library for Beautiful plugins. It provides native Obsidian controls, layouts, lifecycle ownership, and a development gallery.

## 2. Usage

From this directory, run `task init`, `task test`, and `task build`. Import the explicit exports from `@beautiful/design` and the stylesheet from `@beautiful/design/styles.css`. Bundle Obsidian as an external.

## 3. Features

- Controls, inputs, menus, settings rows, and modals.
- Record layouts and feedback surfaces.
- Lifecycle cleanup tied to Obsidian components.

## 4. Architecture

`src/` owns the public design API. `../showcase/design/` owns the gallery, and its emitted files go to `dist/gallery/`. Views register with an Obsidian `Component`, replaced surfaces are disposed of, and CSS stays scoped and uses native theme variables. Shared Meson JSON tokens don't override Obsidian themes.

## 5. Dependencies

| Dependency | Version | Use |
|---|---|---|
| `obsidian` | 1.14.4 | Development: plugin API declarations |
| `obsidian` | Peer range `>=1.12.0 <2`; 1.14.4 resolved | Runtime peer: provided by the host Obsidian app |

## 6. Roadmap

The capabilities above are implemented. No further release commitments are recorded.

## 7. Contributing

Read `AGENTS.md` and the applicable skills in `.ai/skills/` before contributing. Set up the development environment with `task init`. Follow the repository conventions, preserve supported behavior, and add relevant tests for behavior changes. Run `task test` and `task build` before opening a pull request. Describe the change, its purpose, and the validation results in the pull request.

## 8. License

`@beautiful/design` is licensed under the MIT license. See LICENSE for the complete license text.

See `ACKNOWLEDGEMENTS.md` for third-party notices and attributions.
