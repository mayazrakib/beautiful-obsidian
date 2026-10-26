# `@beautiful/inbox`

![Version](https://img.shields.io/badge/Version-0.1.0-737373?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-737373?style=flat-square)
![Languages](https://img.shields.io/badge/Languages-TypeScript-737373?style=flat-square)
![Frameworks](https://img.shields.io/badge/Frameworks-%40beautiful%2Fdesign%20and%20Obsidian-737373?style=flat-square)
![Compatibility](https://img.shields.io/badge/Compatibility-Unknown-737373?style=flat-square)
![Build](https://img.shields.io/badge/Build-Not%20verified-737373?style=flat-square)
![Tests](https://img.shields.io/badge/Tests-Not%20measured-737373?style=flat-square)
![Vulnerabilities](https://img.shields.io/badge/Vulnerabilities-Unknown-737373?style=flat-square)

## 1. Introduction

A universal Markdown capture and processing system for Obsidian.

## 2. Usage

Use Obsidian 1.12.2 or newer with Bases enabled. Run `task init`, `task test`, and `task build` here. Copy `dist/` contents to an isolated vault plugin directory. Development commands never deploy automatically.

## 3. Features

Capture text, links, files, audio, and email; process records through native Bases views and a theme-aware canvas.

## 4. Architecture

`src/storage/` owns Markdown persistence; `src/integrations/` owns import adapters; `src/ui/` owns native views. Preserve immutable IDs, concurrent-edit checks, recoverable vault trash, unsaved drafts, and external note edits. See [verification](VERIFICATION.md) for native acceptance.

## 5. Dependencies

| Dependency | Version | Use |
|---|---|---|
| @beautiful/design and Obsidian | 0.1.0 and 1.14.4 SDK | Runtime and build integration; complete declarations and resolved versions remain in the workspace manifests and root lockfiles. |

## 6. Roadmap

The capabilities above are implemented. No additional release commitments are recorded here.

## 7. Contributing

Read `AGENTS.md` and the applicable skills in `.ai/skills/` before contributing. Set up the development environment with `task init`. Follow the repository conventions, preserve supported behavior, and add relevant tests for behavior changes. Run `task test` and `task build` before opening a pull request. Describe the change, its purpose, and the validation results in the pull request.

## 8. License

`@beautiful/inbox` is licensed under the MIT license. See LICENSE for the complete license text.

See `ACKNOWLEDGEMENTS.md` for third-party notices and attributions.
