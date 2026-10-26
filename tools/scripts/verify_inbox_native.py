"""Measure Beautiful Inbox inside the isolated Obsidian_Tests native renderer."""

import argparse
import datetime
import json
from pathlib import Path
import shutil
import subprocess
import sys
import uuid


RESULT_MARKER = "BEAUTIFUL_INBOX_BENCHMARK_RESULT:"
TEST_VAULT_NAME = "Obsidian_Tests"
DEFAULT_WINDOWS_CLI = "/mnt/c/Users/Mayaz/AppData/Local/Programs/Obsidian/Obsidian.com"
MAX_SOURCE_CHUNK_CHARACTERS = 2500
MAX_EVAL_ARGUMENT_CHARACTERS = 3500

RENDERER_SOURCE = r"""
(async () => {
    const options = __OPTIONS__;
    const state = window[options.state_key];
    const report = {
        kind: "native Electron renderer benchmark", vault: options.vault,
        run_id: options.run_id, layout: "cards canvas", started_at: new Date().toISOString(),
        thresholds_ms: { warm_open: 250, metadata_search: 150, capture_to_visible: 300 },
        sample_count: options.samples, required_items: options.minimum_items,
        acceptance_target_items: 10000, captures_are_retained: true,
        groups: {}, capture_ids: [], search_states: [], failed_samples: [], errors: [],
        maximum_mounted_items: 0, overview_samples: 0, overview_dom_checks: 0, interactive_dom_checks: 0, passed: false,
    };
    const check_running = () => {
        if (options.vault !== "Obsidian_Tests" || app.vault.getName() !== "Obsidian_Tests") {
            throw new Error("Benchmark writes are permitted only in Obsidian_Tests.");
        }
        if (!state || state.run_id !== options.run_id || state.cancelled || window[options.state_key] !== state) {
            throw new Error("Benchmark cancelled; no further synthetic captures are permitted.");
        }
    };
    const render_document = () => app.workspace.activeLeaf?.view?.containerEl?.ownerDocument ?? document;
    const wait_frames = async (count = 2) => {
        for (let index = 0; index < count; index++) {
            check_running();
            const doc = render_document();
            const win = doc.defaultView ?? window;
            report.last_frame_environment = {
                visibility: doc.visibilityState, has_focus: doc.hasFocus(), title: doc.title,
                is_main_document: doc === document,
            };
            if (doc.visibilityState !== "visible" || !doc.hasFocus()) {
                throw new Error(`Native test-vault renderer is not foreground: visibility=${doc.visibilityState}, focus=${doc.hasFocus()}. Environmental failure.`);
            }
            await new Promise((resolve, reject) => {
                let frame_id;
                let timer;
                const cancel = () => {
                    win.cancelAnimationFrame(frame_id);
                    win.clearTimeout(timer);
                    state.cancel_waiters.delete(cancel);
                    reject(new Error("Benchmark cancelled while awaiting a renderer frame."));
                };
                state.cancel_waiters.add(cancel);
                timer = win.setTimeout(() => {
                    state.cancel_waiters.delete(cancel);
                    win.cancelAnimationFrame(frame_id);
                    reject(new Error(`Renderer frame exceeded 1500ms; visibility=${doc.visibilityState}, focus=${doc.hasFocus()}.`));
                }, 1500);
                frame_id = win.requestAnimationFrame(() => {
                    win.clearTimeout(timer);
                    state.cancel_waiters.delete(cancel);
                    try { check_running(); resolve(); } catch (error) { reject(error); }
                });
            });
        }
    };
    const wait_until = async (predicate, description, timeout_ms = 4000) => {
        const started = performance.now();
        while (true) {
            check_running();
            if (predicate()) return;
            if (performance.now() - started > timeout_ms) throw new Error(`Timed out waiting for ${description}.`);
            await wait_frames(1);
        }
    };
    const find_root = () => app.workspace.activeLeaf?.view?.containerEl.querySelector(".beautiful_inbox");
    const get_root = () => {
        const root = find_root();
        if (!root) throw new Error("The active tab does not contain Beautiful Inbox.");
        return root;
    };
    const get_canvas = () => {
        const canvas = get_root().querySelector(".beautiful_inbox_canvas");
        if (!canvas) throw new Error("Cards canvas is unavailable; this harness does not accept legacy layouts.");
        return canvas;
    };
    const is_overview = () => {
        const overview = get_canvas().querySelector(".beautiful_inbox_overview");
        return Boolean(overview && !overview.hidden);
    };
    const collect_dom_bound = () => {
        const count = get_root().querySelectorAll(".beautiful_inbox_item").length;
        report.maximum_mounted_items = Math.max(report.maximum_mounted_items, count);
        if (count > 200) throw new Error(`Inbox mounted ${count} interactive cards; maximum is 200.`);
        const overview = is_overview();
        if (!count && !overview) throw new Error("Canvas rendered neither interactive cards nor an explicit overview.");
        if (overview) report.overview_dom_checks++; else report.interactive_dom_checks++;
        return count;
    };
    const get_search = () => {
        const input = get_root().querySelector('input[aria-label="Search Inbox"]');
        if (!input) throw new Error("Inbox search is unavailable.");
        return input;
    };
    const set_search = (query) => {
        check_running();
        const input = get_search();
        input.value = query;
        input.dispatchEvent(new (input.ownerDocument.defaultView.Event)("input", { bubbles: true }));
    };
    const summarize = (samples, threshold_ms) => {
        const ordered = [...samples].sort((first, second) => first - second);
        const p95_ms = ordered[Math.ceil(ordered.length * 0.95) - 1] ?? null;
        return {
            samples_ms: [...samples], p95_ms, minimum_ms: ordered[0] ?? null,
            maximum_ms: ordered[ordered.length - 1] ?? null, threshold_ms,
            slow_samples: samples.map((duration_ms, index) => ({ index, duration_ms })).filter((sample) => sample.duration_ms > threshold_ms),
            passed: samples.length >= 30 && p95_ms !== null && p95_ms <= threshold_ms,
        };
    };
    const focus_render_window = async (scenario) => {
        check_running();
        const doc = render_document();
        const owner_window = doc.defaultView ?? window;
        if (owner_window !== window) throw new Error("Native benchmark requires the active Inbox in the CLI renderer window; move the popout tab back before retrying.");
        const native_window = owner_window.electron?.remote?.getCurrentWindow?.();
        if (!native_window || native_window.isDestroyed()) throw new Error("The native test-vault window bridge is unavailable.");
        const before = { visibility: doc.visibilityState, has_focus: doc.hasFocus(), was_minimized: native_window.isMinimized() };
        if (before.was_minimized) native_window.restore();
        native_window.show();
        native_window.focus();
        const started = performance.now();
        await new Promise((resolve, reject) => {
            let timer;
            const cancel = () => {
                owner_window.clearTimeout(timer);
                state.cancel_waiters.delete(cancel);
                reject(new Error("Benchmark cancelled while awaiting native focus."));
            };
            const poll = () => {
                try {
                    check_running();
                    if (doc.visibilityState === "visible" && doc.hasFocus()) {
                        state.cancel_waiters.delete(cancel);
                        resolve();
                    } else if (performance.now() - started >= 2000) {
                        state.cancel_waiters.delete(cancel);
                        reject(new Error(`Native focus did not settle within 2000ms: visibility=${doc.visibilityState}, focus=${doc.hasFocus()}.`));
                    } else timer = owner_window.setTimeout(poll, 25);
                } catch (error) {
                    state.cancel_waiters.delete(cancel);
                    reject(error);
                }
            };
            state.cancel_waiters.add(cancel);
            poll();
        });
        (report.native_focus_interventions ??= []).push({ scenario, before, after: { visibility: doc.visibilityState, has_focus: doc.hasFocus() }, settled_ms: performance.now() - started });
    };
    const on_error = (event) => report.errors.push({ type: "renderer error", message: event.message || "Unknown renderer error" });
    const on_rejection = (event) => report.errors.push({ type: "unhandled rejection", message: String(event.reason?.message ?? event.reason) });
    let current_sample;
    try {
        check_running();
        state.phase = "running";
        state.started_at = new Date().toISOString();
        window.addEventListener("error", on_error);
        window.addEventListener("unhandledrejection", on_rejection);
        await focus_render_window("initial setup");
        const plugin = app.plugins.plugins["beautiful-inbox"];
        if (!plugin?.api?.capture || !plugin.repository || typeof plugin.open_inbox !== "function") throw new Error("Beautiful Inbox public API is unavailable.");
        await wait_until(() => plugin.api.list({ limit: 1 }).total >= options.minimum_items, "the required indexed fixture");
        report.initial_item_count = plugin.api.list({ limit: 1 }).total;
        report.qualifies_for_10k_acceptance = report.initial_item_count >= 10000;
        check_running();
        await plugin.open_inbox();
        await wait_until(() => find_root()?.querySelector(".beautiful_inbox_canvas"), "the cards canvas");
        await wait_frames();
        report.view_state = app.workspace.activeLeaf.getViewState();
        const root = get_root();
        const doc = root.ownerDocument;
        const win = doc.defaultView ?? window;
        report.environment = {
            obsidian_version: typeof app.version === "string" ? app.version : null,
            electron_version: win.process?.versions?.electron ?? null,
            chromium_version: win.process?.versions?.chrome ?? null,
            platform: win.navigator.platform, user_agent: win.navigator.userAgent,
            theme: doc.body.classList.contains("theme-dark") ? "dark" : "light",
            community_theme: app.customCss?.theme ?? null,
            document_visibility: doc.visibilityState, document_has_focus: doc.hasFocus(),
            main_document_visibility: document.visibilityState, main_document_has_focus: document.hasFocus(),
            owner_is_main_document: doc === document,
            viewport: { width: win.innerWidth, height: win.innerHeight, device_pixel_ratio: win.devicePixelRatio },
            inbox_size: { width: root.clientWidth, height: root.clientHeight },
        };
        for (const [label, value] of [["Inbox status", "unprocessed"], ["Capture kind", "all"]]) {
            const select = root.querySelector(`select[aria-label="${label}"]`);
            if (select) {
                check_running(); select.value = value;
                select.dispatchEvent(new win.Event("change", { bubbles: true }));
            }
        }
        set_search("");
        await wait_frames();
        collect_dom_bound();
        const welcome = app.vault.getAbstractFileByPath("Welcome.md");
        if (!welcome) throw new Error("Fixture requires Welcome.md for warm Base reopen measurements.");
        const initial_inbox_leaf = app.workspace.activeLeaf;
        const inbox_base_path = initial_inbox_leaf?.getViewState().state?.file;
        if (initial_inbox_leaf?.getViewState().type !== "bases" || typeof inbox_base_path !== "string") throw new Error("Warm reopen requires the native Inbox Base leaf.");
        const focus_leaf = app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.getViewState().state?.file === "Welcome.md") ?? app.workspace.getLeaf("tab");
        await focus_leaf.openFile(welcome);
        await app.workspace.revealLeaf(initial_inbox_leaf);
        await wait_frames();
        const get_inbox_leaves = () => app.workspace.getLeavesOfType("bases").filter((leaf) => leaf.getViewState().state?.file === inbox_base_path);
        await focus_render_window("warm Base reopen");
        const warm = [];
        report.warm_open_method = "Detach only the active Inbox Base leaf, reveal preserved Welcome.md, then time a new native Base leaf open, populated cards/overview readiness, and two rendered frames.";
        report.warm_open_leaf_ids = [];
        report.groups.warm_open = summarize(warm, 250);
        for (let index = 0; index < options.samples; index++) {
            check_running();
            await focus_render_window(`warm reopen sample ${index + 1} setup`);
            const inbox_leaves = get_inbox_leaves();
            const previous_leaf = app.workspace.activeLeaf;
            if (inbox_leaves.length !== 1 || inbox_leaves[0] !== previous_leaf) throw new Error("Warm reopen requires exactly one active Inbox Base tab. Close duplicate Inbox tabs before retrying; other tabs are preserved.");
            const preserved_leaves = [];
            app.workspace.iterateAllLeaves((leaf) => { if (leaf !== previous_leaf) preserved_leaves.push(leaf); });
            const previous_leaf_id = previous_leaf.id;
            check_running();
            previous_leaf.detach();
            await focus_leaf.openFile(welcome);
            await app.workspace.revealLeaf(focus_leaf);
            await wait_frames();
            check_running();
            const started = performance.now();
            current_sample = { group: "warm_open", index, started };
            await plugin.open_inbox();
            await wait_until(() => {
                const inbox = find_root();
                const overview = inbox?.querySelector(".beautiful_inbox_overview");
                return Boolean(inbox?.querySelector(".beautiful_inbox_item") || (overview && !overview.hidden));
            }, "new native Base cards or overview readiness");
            await wait_frames();
            warm.push(performance.now() - started);
            const reopened_leaf = app.workspace.activeLeaf;
            if (get_inbox_leaves().length !== 1 || get_inbox_leaves()[0] !== reopened_leaf || reopened_leaf === previous_leaf) throw new Error("Warm open reused a cached leaf instead of constructing a new native Inbox Base view.");
            const remaining_leaves = new Set();
            app.workspace.iterateAllLeaves((leaf) => { remaining_leaves.add(leaf); });
            if (preserved_leaves.some((leaf) => !remaining_leaves.has(leaf))) throw new Error("A non-Inbox leaf changed during warm reopen verification.");
            report.warm_open_leaf_ids.push({ previous: previous_leaf_id, reopened: reopened_leaf.id });
            report.groups.warm_open = summarize(warm, 250);
            collect_dom_bound();
            current_sample = undefined;
        }
        const queries = ["design review", "useful idea"];
        const expected = new Map(queries.map((query) => {
            const terms = query.split(/\s+/);
            const matches = plugin.repository.list_items().filter((item) => item.status === "unprocessed" && terms.every((term) => [item.title, item.preview, item.source_url, item.source_note, ...item.tags].join(" ").toLocaleLowerCase().includes(term)));
            return [query, new Set(matches.map((item) => item.id))];
        }));
        await focus_render_window("metadata search");
        const search = [];
        report.groups.metadata_search = summarize(search, 150);
        get_search().focus();
        for (let index = 0; index < options.samples; index++) {
            check_running();
            const query = queries[index % queries.length];
            const started = performance.now();
            current_sample = { group: "metadata_search", index, started };
            set_search(query);
            await wait_frames();
            search.push(performance.now() - started);
            report.groups.metadata_search = summarize(search, 150);
            const mounted = [...get_root().querySelectorAll(".beautiful_inbox_item")];
            const matching_ids = expected.get(query);
            const overview = is_overview();
            const overview_label = get_canvas().querySelector(".beautiful_inbox_overview_label")?.textContent ?? "";
            report.search_states.push({ query, overview, interactive_cards: mounted.length, expected_matches: matching_ids.size, overview_label });
            if (!matching_ids.size) throw new Error(`Fixture has no results for '${query}'.`);
            if (mounted.some((card) => !matching_ids.has(card.dataset.itemId))) throw new Error(`Search rendered a card outside '${query}' results.`);
            if (overview) {
                report.overview_samples++;
                const visible_count = Number(overview_label.split(" captures")[0].replace(/[^0-9]/g, ""));
                if (visible_count !== matching_ids.size) throw new Error(`Overview result count differs for '${query}'.`);
            } else if (!mounted.length) throw new Error(`Search rendered no interactive results for '${query}'.`);
            collect_dom_bound();
            current_sample = undefined;
        }
        set_search("");
        await wait_frames();
        const canvas = get_canvas();
        canvas.focus();
        canvas.dispatchEvent(new (canvas.ownerDocument.defaultView.KeyboardEvent)("keydown", { key: "Home", bubbles: true }));
        await wait_frames();
        if (is_overview()) throw new Error("Home keyboard action did not restore an interactive origin view before capture measurements.");
        await focus_render_window("capture to visible");
        const capture = [];
        report.groups.capture_to_visible = summarize(capture, 300);
        for (let index = 0; index < options.samples; index++) {
            check_running();
            const started = performance.now();
            current_sample = { group: "capture_to_visible", index, started };
            const captured = await plugin.api.capture({
                title: `Native benchmark ${options.run_id} ${index + 1}`,
                body: "Synthetic capture created by the native Inbox performance harness.",
                kind: "text", tags: ["native-benchmark"], source_id: "native-benchmark",
                external_id: `${options.run_id}:${index + 1}`,
            });
            report.capture_ids.push(captured.item.id);
            await wait_until(() => [...get_root().querySelectorAll(".beautiful_inbox_item")].some((card) => card.dataset.itemId === captured.item.id && (() => { const card_rect = card.getBoundingClientRect(); const viewport_rect = get_canvas().getBoundingClientRect(); return card_rect.width > 0 && card_rect.left < viewport_rect.right && card_rect.right > viewport_rect.left && card_rect.top < viewport_rect.bottom && card_rect.bottom > viewport_rect.top; })()), `capture ${index + 1} visible in the canvas`);
            await wait_frames();
            capture.push(performance.now() - started);
            report.groups.capture_to_visible = summarize(capture, 300);
            current_sample = undefined;
            collect_dom_bound();
        }
        report.final_item_count = plugin.api.list({ limit: 1 }).total;
        report.passed = report.qualifies_for_10k_acceptance && Object.values(report.groups).length === 3 && Object.values(report.groups).every((group) => group.passed) && report.maximum_mounted_items <= 200 && report.errors.length === 0;
    } catch (error) {
        if (current_sample) report.failed_samples.push({ group: current_sample.group, index: current_sample.index, duration_ms: performance.now() - current_sample.started, message: String(error.message ?? error) });
        report.errors.push({ type: "benchmark failure", message: String(error.message ?? error) });
    } finally {
        window.removeEventListener("error", on_error);
        window.removeEventListener("unhandledrejection", on_rejection);
        report.cancelled = Boolean(state?.cancelled);
        report.completed_at = new Date().toISOString();
        if (state) { state.phase = "finished"; state.finished_at = report.completed_at; }
    }
    return "BEAUTIFUL_INBOX_BENCHMARK_RESULT:" + JSON.stringify(report);
})()
"""


def resolve_cli(configured_path):
    if configured_path:
        executable = Path(configured_path)

        if not executable.is_file():
            raise ValueError("The configured Obsidian CLI executable does not exist.")

        return str(executable)

    if Path(DEFAULT_WINDOWS_CLI).is_file():
        return DEFAULT_WINDOWS_CLI

    executable = shutil.which("Obsidian.com") or shutil.which("obsidian")

    if not executable:
        raise ValueError("Obsidian CLI was not found. Pass --cli with the native Obsidian.com path.")

    return executable


def parse_report(output):
    for original_line in reversed(output.splitlines()):
        line = original_line.strip()

        if line.startswith("=> "):
            line = line[3:].strip()

        try:
            decoded = json.loads(line)

            if isinstance(decoded, str):
                line = decoded
        except json.JSONDecodeError:
            pass

        marker_index = line.find(RESULT_MARKER)

        if marker_index < 0:
            continue

        try:
            report = json.loads(line[marker_index + len(RESULT_MARKER):])
        except json.JSONDecodeError:
            continue

        if isinstance(report, dict) and report.get("vault") == TEST_VAULT_NAME:
            return report

    raise ValueError("Obsidian did not return a structured benchmark result.")


def create_eval_guard():
    return 'if(app.vault.getName()!=="Obsidian_Tests"){throw new Error("Wrong benchmark vault.");}'


def create_chunk_command(
    source_chunk,
    index,
    state_key,
    run_id,
):
    acknowledgement = f"BEAUTIFUL_CHUNK:{run_id}:{index}"
    code = (
        "(()=>{"
        + create_eval_guard()
        + f"const state=window[{json.dumps(state_key)}];"
        + f"if(!state||state.run_id!=={json.dumps(run_id)}){{throw new Error('Benchmark transport state missing.');}}"
        + f"state.chunks[{index}]={json.dumps(source_chunk, ensure_ascii=True)};"
        + f"return {json.dumps(acknowledgement)};"
        + "})()"
    )

    return code, acknowledgement


def create_source_chunks(
    source,
    state_key,
    run_id,
):
    commands = []
    offset = 0

    while offset < len(source):
        length = min(MAX_SOURCE_CHUNK_CHARACTERS, len(source) - offset)

        while True:
            code, acknowledgement = create_chunk_command(
                source[offset:offset + length],
                len(commands),
                state_key,
                run_id,
            )

            if len("code=" + code) <= MAX_EVAL_ARGUMENT_CHARACTERS:
                break

            length = max(1, length * 3 // 4)

            if length == 1 and len("code=" + code) > MAX_EVAL_ARGUMENT_CHARACTERS:
                raise ValueError("A benchmark source character cannot fit the native CLI transport.")

        commands.append((code, acknowledgement))
        offset += length

    return commands


def execute_cli(
    executable,
    vault,
    command,
    timeout_seconds,
    code=None,
):
    if vault != TEST_VAULT_NAME:
        raise ValueError("Native benchmark transport is restricted to Obsidian_Tests.")

    arguments = [executable, f"vault={vault}", command]

    if code is not None:
        if len("code=" + code) > MAX_EVAL_ARGUMENT_CHARACTERS:
            raise ValueError("The native eval argument exceeds the benchmark transport bound.")

        arguments.append(f"code={code}")

    return subprocess.run(
        arguments,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout_seconds,
        check=False,
    )


def has_acknowledgement(
    output,
    expected,
):
    for original_line in output.splitlines():
        line = original_line.strip()

        if line.startswith("=> "):
            line = line[3:].strip()

        try:
            decoded = json.loads(line)

            if isinstance(decoded, str):
                line = decoded
        except json.JSONDecodeError:
            pass

        if line == expected:
            return True

    return False


def send_idempotent_step(
    executable,
    vault,
    code,
    acknowledgement,
):
    for attempt in range(2):
        process = execute_cli(
            executable,
            vault,
            "eval",
            30,
            code,
        )

        if process.returncode == 0 and has_acknowledgement(process.stdout, acknowledgement):
            return

        if attempt == 1:
            raise ValueError("The native CLI did not acknowledge an indexed benchmark source chunk.")


def run_benchmark(arguments):
    if arguments.vault != TEST_VAULT_NAME:
        raise ValueError("This harness is restricted to the Obsidian_Tests vault.")

    options = {
        "vault": arguments.vault,
        "samples": arguments.samples,
        "minimum_items": arguments.minimum_items,
        "run_id": arguments.run_id,
    }
    executable = resolve_cli(arguments.cli)
    state_key = "__beautiful_inbox_benchmark_" + arguments.run_id.replace("-", "_")
    options["state_key"] = state_key
    source = RENDERER_SOURCE.replace("__OPTIONS__", json.dumps(options, ensure_ascii=True))
    state_key_json = json.dumps(state_key)
    run_id_json = json.dumps(arguments.run_id)
    chunk_commands = create_source_chunks(source, state_key, arguments.run_id)
    initialization_ack = f"BEAUTIFUL_INIT:{arguments.run_id}"
    cleanup_ack = f"BEAUTIFUL_CLEAN:{arguments.run_id}"
    initialization_code = (
        "(()=>{"
        + create_eval_guard()
        + f"const key={state_key_json};const existing=window[key];"
        + f"if(existing&&(existing.run_id!=={run_id_json}||existing.chunks.length!=={len(chunk_commands)})){{throw new Error('Benchmark transport conflict.');}}"
        + f"window[key]??={{run_id:{run_id_json},chunks:new Array({len(chunk_commands)}),cancelled:false,phase:'loading',cancel_waiters:new Set()}};"
        + f"return {json.dumps(initialization_ack)};"
        + "})()"
    )
    cleanup_code = (
        "(()=>{"
        + create_eval_guard()
        + f"const key={state_key_json};"
        + f"const state=window[key];if(state?.run_id==={run_id_json}){{state.cancelled=true;for(const cancel of state.cancel_waiters??[]){{cancel();}}state.chunks=[];if(state.phase!=='running'){{delete window[key];}}}}"
        + f"return {json.dumps(cleanup_ack)};"
        + "})()"
    )
    final_code = (
        "(async()=>{"
        + create_eval_guard()
        + f"const key={state_key_json};"
        + "try{const state=window[key];"
        + f"if(!state||state.run_id!=={run_id_json}||state.chunks.length!=={len(chunk_commands)}||state.chunks.filter(value=>typeof value==='string').length!=={len(chunk_commands)}){{throw new Error('Incomplete benchmark source.');}}"
        + "const source=state.chunks.join('');"
        + f"if(source.length!=={len(source.encode('utf-16-le')) // 2}){{throw new Error('Benchmark source length mismatch.');}}"
        + "return await (0,eval)(source);"
        + "}finally{delete window[key];}})()"
    )
    report = None
    cleanup_failure = None
    version = execute_cli(executable, arguments.vault, "version", 30)

    try:
        send_idempotent_step(executable, arguments.vault, initialization_code, initialization_ack)

        for code, acknowledgement in chunk_commands:
            send_idempotent_step(executable, arguments.vault, code, acknowledgement)

        from native_windows import focus_test_vault

        focus_result = focus_test_vault()
        process = execute_cli(
            executable,
            arguments.vault,
            "eval",
            arguments.timeout_seconds,
            final_code,
        )
        report = parse_report(process.stdout)
        report["foreground_intervention"] = focus_result
        report["cli_exit_code"] = process.returncode
        report["transport_wall_time_excluded"] = True
        report["transport"] = {
            "source_chunks": len(chunk_commands),
            "maximum_eval_argument_characters": max(len("code=" + code) for code, _ in chunk_commands),
            "source_characters": len(source),
            "source_delivery": "guarded indexed assignments with acknowledgements",
        }
        report["cli_version"] = version.stdout.strip() if version.returncode == 0 else None

        if not report.get("environment", {}).get("obsidian_version") and version.returncode == 0:
            report.setdefault("environment", {})["obsidian_version"] = version.stdout.strip()

        if process.returncode:
            report["passed"] = False
            report["errors"].append({"type": "CLI transport", "message": "Obsidian CLI returned a nonzero exit code."})
    except (ValueError, OSError, subprocess.TimeoutExpired, RuntimeError) as error:
        report = {
            "kind": "native Electron renderer benchmark",
            "vault": arguments.vault,
            "run_id": arguments.run_id,
            "layout": "cards canvas",
            "passed": False,
            "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "errors": [{"type": "harness failure", "message": "Native CLI timed out; an already-started capture may finish." if isinstance(error, subprocess.TimeoutExpired) else str(error)}],
            "transport": {"source_chunks": len(chunk_commands)},
        }
    finally:
        try:
            send_idempotent_step(executable, arguments.vault, cleanup_code, cleanup_ack)
        except (ValueError, OSError, subprocess.TimeoutExpired) as error:
            cleanup_failure = type(error).__name__

        if report is not None:
            report["transport"]["cancellation_requested"] = True
            report["transport"]["cancellation_acknowledged"] = cleanup_failure is None
            report["transport"]["temporary_source_removed"] = cleanup_failure is None
            report["transport"]["cancellation_scope"] = "Stops pending frame waits and future capture iterations; an already-started capture may finish."

            if cleanup_failure:
                report["passed"] = False
                report["errors"].append({"type": "transport cleanup", "message": "The temporary benchmark source could not be confirmed removed."})

    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", default=TEST_VAULT_NAME)
    parser.add_argument("--cli", help="Path to the official native Obsidian CLI executable.")
    parser.add_argument("--output", type=Path, help="Create a new JSON report file without overwriting an existing file.")
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--minimum-items", type=int, default=10000)
    parser.add_argument("--timeout-seconds", type=int, default=30)
    arguments = parser.parse_args()
    arguments.run_id = str(uuid.uuid4())

    if arguments.vault != TEST_VAULT_NAME:
        parser.error("Only --vault Obsidian_Tests is permitted.")

    if arguments.samples < 30:
        parser.error("At least 30 samples are required for each measurement group.")

    if arguments.timeout_seconds < 1 or arguments.timeout_seconds > 30:
        parser.error("--timeout-seconds must be between 1 and 30.")

    if arguments.minimum_items < 1:
        parser.error("--minimum-items must be positive.")

    if arguments.output and arguments.output.exists():
        parser.error("The output file already exists. Choose a new report filename.")

    if arguments.output and not arguments.output.parent.is_dir():
        parser.error("The output directory does not exist.")

    try:
        report = run_benchmark(arguments)
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        message = str(error)

        if isinstance(error, subprocess.TimeoutExpired):
            message = "The CLI transport timed out. Scoped cancellation was attempted; inspect this run ID before retrying. An already-started capture may finish."

        report = {
            "kind": "native Electron renderer benchmark",
            "vault": arguments.vault,
            "run_id": arguments.run_id,
            "layout": "cards canvas",
            "passed": False,
            "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "errors": [{"type": "harness failure", "message": message}],
        }

    serialized = json.dumps(report, indent=4, ensure_ascii=False) + "\n"

    if arguments.output:
        try:
            with arguments.output.open("x", encoding="utf-8") as output_file:
                output_file.write(serialized)
        except OSError as error:
            report["passed"] = False
            report["errors"].append({"type": "report output", "message": str(error)})
            serialized = json.dumps(report, indent=4, ensure_ascii=False) + "\n"

    sys.stdout.write(serialized)

    return 0 if report.get("passed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
