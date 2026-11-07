---
name: repo-maintenance
description: "Maintain the beautiful-obsidian repository and verify its supported development workflows."
---

## 1. Scope

Use when maintaining this repository or its independently configured projects.

## 2. Procedure

- Initialize the root NPM workspace with `npm ci`; `design/` and `packages/inbox/` share the root lockfile.
- Run `npm test`, `npm run typecheck`, and `npm run build` for affected workspace changes.
- Preserve the `design/package.json` exports and the Obsidian plugin's `packages/inbox/dist/main.js`, `styles.css`, and `manifest.json` distribution. These exact output names are consumed by Obsidian and the documented installation workflow. Repository compatibility rules permit these paths instead of a cosmetic output move; verify with `npm run build` and `tools/scripts/verify_build.mjs`.
