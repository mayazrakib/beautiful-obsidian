# Beautiful Inbox

A collection of beautiful Obsidian plugins.

Beautiful Inbox is a universal capture and processing system for Obsidian by Mayaz Rakib. It stores captures as ordinary Markdown notes and displays them through custom native Bases layouts. It requires Obsidian 1.12.2 or newer and the Bases core plugin for its Inbox screen.

## Installation and development

From the monorepo root, use Node.js 24 and npm 11:

```sh
npm ci
npm run check
npm run dev:inbox
```

Copy `packages/inbox/dist/main.js`, `manifest.json`, and `styles.css` into your test vault's `.obsidian/plugins/beautiful-inbox/` directory. Enable Beautiful Inbox in Community plugins. The watcher rebuilds code and styles; reload the plugin after copying new outputs. No development command writes into a vault automatically.

## Capture and processing

The Inbox ribbon button opens or focuses your configured Base. Its Cards canvas gives each capture an independent card. Drag a card by its handle, resize its corner, and hold Shift for optional grid and alignment snapping. Movement and resizing remain free-form without Shift. Native Bases controls manage saved configurations, filtering, sorting, and grouping. The initial arrangement uses one to eight columns; manual positions and sizes are saved per Base view.

Capture Markdown, links, selections, references to existing notes, pasted images, dropped files, audio, or imported email. The composer saves text drafts locally. File selections remain in memory until imported and must be reselected after a full application restart. Native notes and attachments remain readable when the plugin is disabled.

Captures have four states:

- Unprocessed items need clarification.
- Deferred items have a review date and can return to the Inbox when due.
- Processed items have been clarified; this does not mean a task is complete.
- Archived items are retained outside the active queue.

Use Process queue or the Process next command to work through captures. The inspector provides content, tags, source links, attachment previews, and processing actions. Selection actions support bulk processing and tags. Undo checks for conflicting edits before restoring content. Trash uses Obsidian's recoverable vault trash and preserves attachments unless an explicit attachment action selects them for removal. Shared attachment checks prevent trashing referenced files.

Capture and search stay visible. More contains filters, imports, recording, processing, layout tools, and keyboard help. Selection actions appear when captures are selected. The optional inline composer is disabled by default.

A subtle dotted background follows the active theme and is enabled by default. Dots use twice the snap spacing, keeping the canvas quiet without reducing Shift-snap precision. Hide it through More or the Base view settings.

Pan by dragging empty canvas space or scrolling. Ctrl/Cmd-wheel zooms around the pointer. Home restores the camera to the origin at 100%. Fit all provides an overview for large collections. At distant zoom levels, counted overview clusters represent captures without mounting thousands of cards. Position and size dialogs provide alternatives to dragging. Escape cancels an active move or resize. Layout undo is separate from note-processing undo.

Arrow keys navigate captures; Enter opens details; Space selects; Shift+Space extends selection; Ctrl/Cmd+A selects current results. Shortcuts are scoped to the collection. Text fields retain normal editing behavior. Use Ctrl/Cmd+Enter to save a capture.

## Storage

Defaults are `Beautiful/Inbox/Inbox.base`, `Beautiful/Inbox/Items/`, and `Beautiful/Inbox/Attachments/`. Settings allow different vault-relative locations and filename templates using `{date}`, `{title}`, and `{id}`. Changes affect future captures and Base selection; they do not silently migrate existing files.

Each record has a `beautiful_inbox: true` marker, immutable `inbox_id`, schema version, title, kind, status, capture timestamp, optional review date, tags, source identifiers, a bounded preview, and system creation/update timestamps. The Base queries the marker rather than only a folder. Duplicate IDs and malformed records appear in storage diagnostics without automatic rewriting.

Legacy Beautiful List configurations are converted to Cards while retaining their filters and settings. An exact backup is saved beside the Base under `Backups/` before migration.

Changing a note externally, renaming it, or moving it remains supported. Content updates preserve unrelated properties and detect stale edits. Bulk operations report individual failures because the vault does not provide atomic transactions across multiple notes.

## External capture

The plugin registers `obsidian://beautiful-inbox`. Parameters include `vault`, `title`, `body` or `text`, `url`, `kind`, comma-separated `tags`, `source_note`, and paired `source_id`/`external_id` identifiers. URI captures open a populated composer by default. Automatic saving is an explicit preference.

An example URI is:

```text
obsidian://beautiful-inbox?vault=Obsidian_Tests&title=Read%20this&url=https%3A%2F%2Fexample.com
```

Run Copy browser capture bookmarklet and save the copied value as a browser bookmark. It captures a page title, URL, and selected text. It does not scrape entire pages or run a background service.

The desktop CLI registers these commands:

```sh
obsidian vault=Obsidian_Tests beautiful-inbox:capture title="An idea" body="Capture details" tags=work
obsidian vault=Obsidian_Tests beautiful-inbox:list limit=50 status=unprocessed
obsidian vault=Obsidian_Tests beautiful-inbox:read id="capture UUID"
obsidian vault=Obsidian_Tests beautiful-inbox:update id="capture UUID" status=processed
obsidian vault=Obsidian_Tests beautiful-inbox:process ids="UUID,UUID" status=archived
```

CLI results use a JSON envelope with `api_version`, `ok`, and either `result` or `error`. List results include a bounded page and `next_cursor`. Read a capture before replacing its body, and pass its `expected_revision` when editing to detect conflicting changes. Capture retries with the same `source_id` and `external_id` return the existing item instead of creating another.

Other installed plugins can discover Beautiful Inbox through Obsidian and use its `api` object. Version 1 exposes `capture`, `read`, `list`, `update`, `process`, and `import`. Types are defined in the plugin contracts. The same repository validates and persists actions from the UI and integrations. The CLI is the machine interface for external tools; no unauthenticated HTTP listener is installed.

JSON/JSONL imports offer parsing feedback and a preview before saving. Input must contain capture objects with a title or body. Imports are bounded by the configured capture limit and can be cancelled between records. Binary attachments use file import rather than URI payloads.

## Email connections

Email imports are read-only copies. They never mark messages read, archive them remotely, or delete them. The default initial window is seven days, with a preview before manual import. Polling is opt-in and runs only while Obsidian is open. Captures are deduplicated by provider, connected account, and message identity. Existing captures survive remote deletion and retain user edits.

Imported messages include sender, subject, date, readable body, and a source link. Raw email HTML and remote images are not rendered. Attachments are downloaded only through an explicit item action and obey the configured size limit.

### Gmail

Create a Google Cloud project, enable the Gmail API, configure its consent screen, and create an OAuth client with application type Desktop app. Enter the public client ID in Inbox settings. Do not use a confidential web-application secret.

Connect opens the system browser and uses PKCE with a temporary loopback callback. This direct Gmail sign-in implementation is desktop-only. Google classifies `gmail.readonly` as a restricted scope; your registration and distribution must satisfy Google's applicable requirements. Testing-mode refresh tokens may expire after seven days, requiring reconnection.

See [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app) and [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

### Outlook and Microsoft 365

Register a Microsoft Entra application with the appropriate supported account types. Enable public-client flows and delegated `Mail.Read` access. Enter its public application ID and a matching tenant selection such as `common`, `consumers`, `organizations`, or your tenant ID.

Connect displays a provider sign-in URL and device code. Complete authorization in your browser. Organizational consent or device-code policies may prevent connection; the plugin reports the failure rather than bypassing the policy.

See [Microsoft device-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) and [public-client configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration).

### Credentials and synchronization

Public client IDs and connection preferences live in plugin settings. Refresh credentials use Obsidian SecretStorage; access tokens remain in memory. Credentials are not stored in capture notes or ordinary settings, and they are not copied into reports. Each device may require its own connection.

Imports use bounded pages, deduplication, retry/backoff, cancellation, and checkpoints. They do not overwrite imported notes. Polling pauses when Obsidian closes and catches up when it runs again. Always-on collection requires a separate service, which this plugin does not provide.

## Audio recording

Enable the Audio Recorder core plugin. Inbox creates a capture note and uses the core recorder through one guarded compatibility adapter because Obsidian does not publish a recording API. Unsupported versions show an unavailable state rather than replacing the recorder.

Inbox activates its capture note before starting and before stopping. Core recording saves into the note active at stop time. Stopping outside Inbox may therefore save elsewhere; Inbox does not guess which unrelated audio file belongs to it. Successful capture is reported only after a new nonempty audio attachment appears in the intended note.

Core audio uses Obsidian's attachment setting, not the Inbox file-import destination. Start failures retain the capture note for recovery. The integration does not provide pause, transcription, or guaranteed background routing.

## Verification

See the [executed verification record](VERIFICATION.md) for native results, timings, and remaining limits.

Run `npm run check` from the repository root. Unit tests use explicit Obsidian/provider fixtures and do not prove native behavior or live OAuth access.

The native fixture generator creates new files without overwriting existing data:

```sh
python3 scripts/create_inbox_test_vault.py --path /mnt/c/Users/Mayaz/OneDrive/Tests/Obsidian_Tests --count 10000
```

Register the folder through Obsidian's vault manager, then scope every native command to `vault=Obsidian_Tests`. Preserve other vaults and unsaved work. Record native version, theme, pane size, item count, mounted DOM count, and measured timings. Distinguish synthetic recording tests from physical microphone validation, and provider fixtures from live account authorization. Actual mobile-device behavior requires separate verification.

## License

MIT. Copyright (c) 2026 Mayaz Rakib.
