# Beautiful design system

A collection of beautiful Obsidian plugins.

`@beautiful/design` provides shared native controls, layout patterns, and lifecycle management for Beautiful plugins. It is a private workspace package bundled into each plugin, not a separately installed Obsidian plugin.

## Theme contract

Native controls retain Obsidian's fonts, dimensions, borders, radii, colors, focus states, hover states, and disabled treatment. Primary and warning styling is opt-in. Custom layouts use Obsidian spacing and border variables, wrap in narrow panes, and inherit typography.

The stylesheet defines semantic aliases for primary and secondary surfaces, normal and muted text, borders, and layout gaps. Aliases resolve from the active Obsidian theme through CSS. They do not modify the document root or assign hardcoded theme colors. Surface aliases are available for future compositions without forcing a background onto every container.

Every selector targets Beautiful-owned classes. Keep shared selectors stable and additive so independently updated plugins can coexist. Breaking visual contracts need new class names or a coordinated migration. Plugin-specific styles belong in plugin-specific namespaces.

Use [Obsidian's CSS variables](https://docs.obsidian.md/Reference/CSS%20variables/CSS%20variables) and [native UI APIs](https://docs.obsidian.md/Plugins/User%20interface/HTML%20elements). A theme may style core views specially; arbitrary community CSS cannot be guaranteed to match every custom layout.

## Consumption

Add `@beautiful/design` version `0.1.0` as a dependency of a future npm workspace plugin, then run `npm install` at the repository root. npm links the matching local workspace. Build the design workspace before building a consumer.

The package exports JavaScript and TypeScript declarations from `@beautiful/design`, and CSS from `@beautiful/design/styles.css`. Keep `obsidian` external and bundle the design code into each plugin's CommonJS `main.js`. Copy or concatenate the exported stylesheet into the plugin's `styles.css`; an esbuild CSS import alone may produce `main.css`, which Obsidian does not load as the plugin stylesheet.

The following example attaches a button to a host-owned container:

```ts
import { create_button, create_surface } from "@beautiful/design";

const surface = create_surface(
    this,
    container,
);

create_button(
    surface,
    {
        label: "Capture",
        on_click: () => open_capture(),
    },
);
```

Here, `this` is a loaded Obsidian Component, such as a plugin or view. Unloading the owner removes the surface, child regions, registered handlers, and native callbacks. Call `surface.dispose()` before replacing a rendered subtree. A disposed surface is not reusable; create a new one. Do not independently unload and reload the same surface.

Factories return the native Obsidian component, allowing callers to use its documented APIs. Native setting rows can be extended with `addText`, `addToggle`, and other standard methods. Additional subscriptions must be registered with the surface or its owning Component. Register open modals for closure when their host unloads, using `surface.register(() => modal.close())`. Labels must contain non-whitespace text.

## Public API

Typed option interfaces are exported beside the factories. Editor completion and generated declarations document the complete field types. Component factories accept a `DesignSurface` and an options object unless specified below.

| API | Purpose and options | Accessibility and lifecycle |
| --- | --- | --- |
| `create_surface(owner, container)` | Own a presentation subtree; returns `DesignSurface`. | Use the host document. Dispose on replacement; owner unload cleans descendants. |
| `surface.create_region(class_name)` | Create a nested owned region. | Add domain semantics where appropriate; cleanup follows its parent. |
| `create_button` | `label`, `on_click`, optional `is_disabled`, `is_primary`, and `is_warning`. | Visible label; native button behavior. Callback is cleared on disposal. |
| `create_icon_button` | `label`, `icon`, `on_click`, optional `is_disabled`. | Required accessible label and tooltip; Enter/Space activation. Callback and added key listener are cleaned up. |
| `create_text_input` | `label`, `on_change`, optional `value`, `placeholder`, and `is_disabled`. | Required accessible label; add visible context in the containing form. |
| `create_toggle` | `label`, `value`, `on_change`, optional `is_disabled`. | Native toggle with accessible name. |
| `create_dropdown` | `label`, `options`, `value`, `on_change`, optional `is_disabled`. | Named native select; initial value must exist in options. |
| `create_setting_row` | `name`, optional `description` and `is_disabled`. | Native Setting layout; configure accessible child controls through native APIs. |
| `create_menu(surface, actions)` | Each action has `label`, `on_click`, optional `icon` and `is_disabled`. | Native menu navigation; hidden when the surface unloads. |
| `BeautifulModal(app, title, render_content)` | Render into a fresh owned surface on every open. | Native title, close, and focus management; close or render failure cleans content. |
| `create_toolbar(parent, label)` | Returns owned `surface`, `filters`, and `actions` regions. | Named group, ordinary Tab navigation, and wrapping layout. |
| `create_record_row` | `title`, optional `metadata` and `status`; returns `surface`, `content`, and `actions`. | Status is readable text; place explicit buttons in actions. No implicit whole-row click. |
| `create_detail_section(parent, title)` | Returns a content surface below a native `h3` heading. | Place within an appropriate heading hierarchy. |
| `create_empty_state` | `title` and `description`; returns an owned surface for optional actions. | Describes the situation and next step with text. |
| `create_feedback` | `state` of `loading`, `success`, `error`, or `info`, and `message`. | Errors use `alert`; other states use `status`. Provide a message that communicates meaning without color. |

The Inbox workspace also consumes these shared primitives. Each belongs to its parent `DesignSurface`; disposing that surface removes its DOM and listeners. Consumers own validation, persistence, selection, and asynchronous state.

| Factory | Typed options and result | Accessibility and lifecycle |
|---|---|---|
| `create_text_area(surface, options)` | `TextAreaOptions`: required `label` and `on_change`; optional `value`, `placeholder`, `rows`, and `is_disabled`. Returns native `TextAreaComponent`. | Required accessible name, native multiline editing, and callback disposal. Provide visible form context. |
| `create_checkbox(surface, options)` | `CheckboxOptions`: required `label`, `value`, and `on_change`; optional `is_disabled`. Returns `HTMLInputElement`. | Native checkbox semantics and Space operation. Parent disposal removes listeners and owned DOM. |
| `create_card(parent, label)` | Returns `CardRegions` with `surface`, `content`, and `actions`. | Required accessible name. Consumers add appropriate collection semantics, headings, and explicit actions. The card has no implicit click behavior. |

For example, compose a named card and native multiline input:

```ts
const card = create_card(
    surface,
    "Capture draft",
);

create_text_area(
    card.content,
    {
        label: "Capture content",
        rows: 4,
        on_change: (value) => save_draft(value),
    },
);
```

## Interaction conventions

- Give actions explicit buttons and inputs explicit labels. Preserve native focus indicators.
- Use normal Tab order; toolbars use a named group instead of claiming an unimplemented arrow-key toolbar contract.
- Keep completion, selection, and record opening distinct. Domain plugins own those behaviors.
- Let native dialogs handle Escape and focus. Do not introduce a second focus trap.
- Save timing, undo, and asynchronous operations belong to the consumer. Show clear feedback and recovery actions through shared patterns.
- Loading feedback does not disable unrelated controls. Consumers explicitly disable affected controls and set `aria-busy` on the region that is actually loading.
- Prefer explicit actions over drag-only workflows. Preserve native text zoom, touch targets, and reduced-motion preferences. The foundation introduces no animation.

## Development gallery

Run `npm run build` at the repository root. Copy the contents of `design/dist/gallery/` into a separate development vault at `.obsidian/plugins/beautiful-design-gallery/`. Enable Beautiful Design Gallery in Community plugins and run its Open design gallery command.

Use `npm run dev` during development. The watcher rebuilds JavaScript and copies CSS and manifest changes. Copy changed outputs into the development vault and disable/re-enable the gallery to reload it. Restart Obsidian after manifest changes. No command writes into a real vault automatically.

The gallery includes normal, primary, and disabled buttons, a keyboard-accessible icon action, a native menu, text and dropdown controls, toggles, settings rows, a modal, record and empty-state patterns, and loading/success/error/info feedback. Use Tab and Shift+Tab to inspect actual focus states instead of simulating focus with CSS.

## Verification

`npm run check` runs strict type checking, ESLint, Vitest with a deliberately limited Obsidian mock, library and gallery builds, package-export consumption, metadata checks, and stylesheet/output checks. Tests cover callbacks, required labels, disabled behavior, lifecycle cleanup, independent instances, safe text rendering, feedback semantics, and modal reopen/failure behavior.

Native visual acceptance remains a separate check. Record the Obsidian version, theme version, platform, pane size, and result for each scenario:

- Default light and dark themes: compare adjacent native controls for typography, dimensions, borders, focus, hover, and disabled treatment.
- Community themes: check Minimal and Things, in light/dark modes where provided. Record the exact versions tested.
- Change themes with the gallery open; confirm custom layouts follow the new variables immediately.
- Open the gallery in a normal tab, a narrow sidebar, and a pop-out window. Check wrapping, long labels, and absence of horizontal overflow.
- Test on Obsidian mobile and with enlarged text. Check control access and touch operation.
- Navigate using only the keyboard. Open/close menus and dialogs, verify Escape and focus return, and check icon activation fires once.
- Check names, disabled state, and feedback announcements with a screen reader. Check system high-contrast and reduced-motion settings.
- Open multiple instances, then close views, reopen dialogs, and disable the gallery. Confirm no duplicate actions or leftover DOM.

Do not report these scenarios as passed solely from mock tests or a browser preview.
