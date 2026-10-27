# `@beautiful/inbox`

![Version](https://img.shields.io/badge/Version-0.1.0-737373?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-737373?style=flat-square)
![Languages](https://img.shields.io/badge/Languages-TypeScript-737373?style=flat-square)
![Frameworks](https://img.shields.io/badge/Frameworks-%40beautiful%2Fdesign%2C%20Obsidian-737373?style=flat-square)
![Compatibility](https://img.shields.io/badge/Compatibility-Unknown-737373?style=flat-square)
![Build](https://img.shields.io/badge/Build-Not%20verified-737373?style=flat-square)
![Tests](https://img.shields.io/badge/Tests-Not%20measured-737373?style=flat-square)
![Vulnerabilities](https://img.shields.io/badge/Vulnerabilities-Unknown-737373?style=flat-square)

## 1. Introduction

`@beautiful/inbox` is Beautiful Inbox, a universal Markdown capture and processing system for Obsidian.

## 2. Usage

Use Obsidian 1.12.2 or newer with Bases enabled. From this directory, run `task init`, `task test`, and `task build`. Then copy the contents of `dist/` into a plugin directory in an isolated vault. Development commands never deploy automatically.

## 3. Features

- Capture text, links, files, audio, and email.
- Process records through native Bases views.
- Arrange captures on a theme-aware canvas.

## 4. Architecture

`src/storage/` owns Markdown persistence, `src/integrations/` owns import adapters, and `src/ui/` owns native views. Changes must preserve immutable IDs, concurrent-edit checks, recoverable vault trash, unsaved drafts, and external note edits. [VERIFICATION.md](VERIFICATION.md) records native acceptance evidence.

## 5. Dependencies

| Dependency | Version | Use |
|---|---|---|
| `@beautiful/design` | 0.1.0, workspace link | Runtime: shared controls and layouts |
| `obsidian` | 1.14.4 | Development: plugin API declarations |

## 6. Roadmap

The capabilities above are implemented. No further release commitments are recorded.

## 7. Contributing

Read `AGENTS.md` and the applicable skills in `.ai/skills/` before contributing. Set up the development environment with `task init`. Follow the repository conventions, preserve supported behavior, and add relevant tests for behavior changes. Run `task test` and `task build` before opening a pull request. Describe the change, its purpose, and the validation results in the pull request.

## 8. License

`@beautiful/inbox` is licensed under the MIT license. See LICENSE for the complete license text.

See `ACKNOWLEDGEMENTS.md` for third-party notices and attributions.
