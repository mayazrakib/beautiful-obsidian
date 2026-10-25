# Beautiful Inbox verification

Verification date: 26 October 2026, Australia/Sydney. Native checks use Windows Obsidian 1.14.5 and the isolated `C:\Users\Mayaz\OneDrive\Tests\Obsidian_Tests` vault. Existing Notes vault data and configuration remain outside the test scope.

## Automated checks

A clean `npm ci` succeeds with Node.js 24 and npm 11. `npm run check` passes strict TypeScript, ESLint, 121 tests, builds, and output verification. Output checks cover public design exports, Inbox API declarations, CommonJS loading with Obsidian external, manifest requirements, combined stylesheets, exact project descriptions, and MIT attribution to Mayaz Rakib.

The tests use explicit Obsidian and provider fixtures. They cover storage validation, duplicate capture/import, external edits and renames, processing and conflict-aware undo, drafts, accessible names, control cleanup, independent instances, gesture coalescing, fractional movement, Shift snapping, cancellation, viewport queries, email authentication/pagination/cancellation, and recording ownership. Mocked tests do not establish native host behavior.

## Native canvas and performance

Native input verifies free-form movement, Shift snapping, resizing, Escape cancellation, keyboard alternatives, layout undo, numeric position/size editing, pan, zoom, and UUID-based geometry and camera persistence across Base reopening. Only Cards is registered; legacy Beautiful List configuration has a recoverable migration backup.

The complete performance run starts with 10,035 indexed captures and retains 30 synthetic capture samples, finishing with 10,065 captures. Each scenario has 30 measurements. Warm opening constructs a new native Base leaf and waits for visible results and two rendered frames. It does not merely focus an existing tab. Other notes and tabs are checked for preservation.

| Scenario | p95 | Target | Maximum | Samples above target |
|---|---:|---:|---:|---:|
| Warm Base reopening | 234.0 ms | 250 ms | 234.0 ms | 0 |
| Metadata search | 37.9 ms | 150 ms | 39.0 ms | 0 |
| Capture to visible | 198.3 ms | 300 ms | 200.1 ms | 0 |

The final run passes all p95 criteria without slow samples or errors and matches the deployed bundle SHA-256 `2d46914792c62f3341d52490fa711c3986064760a7752153f11fc6e590db7d52`. An earlier run includes a 266.6 ms opening sample; it remains retained. The maximum mounted interactive card count in the final run is 14, below the 200-card limit. Unit tests separately exercise 10,000-card spatial queries and the bounded interactive-card policy. Cold vault indexing was not measured by this warm benchmark.

The final motion profile uses 90 trusted native input moves per mouse drag, mouse resize, touch drag, and 80-card group drag. All streams change geometry, have p95 animation-frame intervals of 16.8 ms, and record no long tasks over 50 ms in the final run. Event-received-to-next-frame callbacks measure 0.1–1.0 ms at p95; second-frame callbacks measure 16.8 ms. Protocol event timestamps include additional native input dispatch delay. These are renderer callback and DOM-change measurements, not compositor presentation or physical touchscreen measurements.

Earlier setup, focus, and input-synthesis failures remain retained separately. Earlier motion reports also retain their longer tasks and protocol-latency failures; they are not silently counted as passing final measurements.

## Native workflows and themes

Actual Inbox ribbon navigation, capture drafts across close/reopen, keyboard capture with the complete body, inspector drafts, saved content, processing, deferral, undo, and native note opening pass. Returning from a note through the ribbon is verified after the explicit leaf-activation fix.

Default Obsidian, Minimal 9.1.4, and Catppuccin 0.4.51 pass light and dark checks. Live light/dark changes repaint the overview bitmap. A 680-pixel desktop window with a 291-pixel canvas passes the narrow-layout check. Original appearance bytes, system/default theme, window bounds, and maximized state are restored. Installed test themes remain only in the test vault.

One workflow automation attempt stopped responding through the CLI and required normally closing and reopening only the isolated test window. Saved capture content persisted, and the existing Notes window remained alive before and after recovery. The failed attempt and recovery record are retained; this incident is not presented as a passed workflow attempt.

## Native audio

A synthetic oscillator passes through the actual core Audio Recorder, produces a nonempty 22,015-byte M4A embed in its Inbox capture, and loads audio metadata with a duration of 1.272729 seconds. Disabled-core guidance and refusal to control an unrelated recording are verified. Temporary recording instrumentation is restored and its tracks are stopped.

This does not verify a physical microphone, device permission prompts, transcription, or recording stopped outside Inbox.

## Evidence and reproduction

Local raw evidence is retained under the test vault's `.obsidian/beautiful-inbox-evidence/` directory, including `canvas.json`, `profile-final.json`, `audio.json`, workflow reports, screenshots, and failed attempts. The complete performance report is `beautiful_inbox_native_cards_final_20261026_0117.json`. Evidence uses synthetic captures rather than live mail.

From the repository root, run:

```sh
npm ci
npm run check
python3 -B scripts/verify_inbox_canvas_native.py --self-test
python3 -B scripts/verify_inbox_canvas_native.py
python3 -B scripts/verify_inbox_native.py --output /tmp/beautiful_inbox_native_new.json
```

Native commands require the Windows test vault and its installed plugin. The harness refuses other vault paths. Run native harnesses sequentially. Each benchmark output path must be new; preserve failed reports.

## Verification limits

Gmail and Outlook use deterministic provider fixtures; live authorization and real mailbox imports require user-supplied client IDs and interactive consent. Actual mobile-device behavior, physical microphone permissions, and screen-reader operation require separate checks. Narrow desktop layouts are not mobile-device testing. Community-theme compatibility is a tested target rather than a guarantee under arbitrary overrides.
