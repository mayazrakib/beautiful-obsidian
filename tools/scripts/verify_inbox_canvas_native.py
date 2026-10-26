"""Exercise real canvas input in the authorized Obsidian_Tests native vault.

Run after deploying the current plugin: python tools/scripts/verify_inbox_canvas_native.py.
This retains fixture card layout changes and evidence in the isolated vault.
No OAuth, microphone, community-theme installation, or user vault is accessed.
"""

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import time
import unittest

from native_windows import MOUNTED_VAULT, NativeVault, WINDOWS_VAULT, parse_result, validate_vault_path

SNAPSHOT_SOURCE = r"""
const root=app.workspace.activeLeaf?.view?.containerEl;
const doc=root?.ownerDocument;
if(root&&doc!==document)throw Error('Active leaf uses another WebContents; transport refused');
const canvas=root?.querySelector('.beautiful_inbox_canvas');
if(!canvas)return null;
const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
const cards=[...canvas.querySelectorAll('.beautiful_inbox_item[data-item-id]')].map(e=>({
id:e.dataset.itemId,title:e.querySelector('.beautiful_inbox_item_title')?.textContent,frame:{x:parseFloat(e.style.left),y:parseFloat(e.style.top),width:parseFloat(e.style.width),height:parseFloat(e.style.height)},
rect:rect(e),move:rect(e.querySelector('[data-canvas-handle=move]')),resize:rect(e.querySelector('[data-canvas-handle=resize]'))}));
return {cards,viewport:rect(canvas),transform:canvas.querySelector('.beautiful_inbox_canvas_world').style.transform,
guides:canvas.querySelectorAll('.beautiful_inbox_alignment_guide').length,visible:doc.visibilityState,focused:doc.hasFocus()};
"""


def center(rectangle):
    return (rectangle["x"] + rectangle["width"] / 2, rectangle["y"] + rectangle["height"] / 2)


def frame_matches(first, second, tolerance=0.2):
    return all(math.isclose(first[key], second[key], abs_tol=tolerance) for key in ("x", "y", "width", "height"))


def is_snapped(frame, others, grid):
    for position, size in (("x", "width"), ("y", "height")):
        if math.isclose(frame[position] / grid, round(frame[position] / grid), abs_tol=0.02):
            continue
        anchors = [frame[position] + frame[size] * ratio for ratio in (0, 0.5, 1)]
        targets = [other[position] + other[size] * ratio for other in others for ratio in (0, 0.5, 1)]
        if not any(math.isclose(anchor, target, abs_tol=0.2) for anchor in anchors for target in targets):
            return False
    return True


def parse_persisted_frame(content, item_id):
    """Read only the four numeric properties in stringifyYaml's UUID card map."""
    pattern = r"(?m)^(\s*)[\"']?" + re.escape(item_id) + r"[\"']?:\s*$"
    match = re.search(pattern, content)
    if not match:
        raise ValueError("The persisted Base has no layout entry for the card UUID.")
    indentation = len(match.group(1))
    result = {}
    for line in content[match.end():].splitlines():
        if not line.strip():
            continue
        if len(line) - len(line.lstrip()) <= indentation:
            break
        field = re.fullmatch(r"\s+(x|y|width|height):\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*", line, re.I)
        if field:
            result[field.group(1)] = float(field.group(2))
    if set(result) != {"x", "y", "width", "height"}:
        raise ValueError("The persisted card geometry is incomplete or not numeric.")
    return result


def parse_camera_transform(transform):
    match = re.fullmatch(r"translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\) scale\(([\d.]+)\)", transform)
    if not match:
        raise ValueError("Unexpected canvas camera transform.")
    return dict(zip(("x", "y", "zoom"), map(float, match.groups())))


def has_persisted_camera(content, camera):
    match = re.search(r"(?m)^(\s*)beautiful_canvas_camera:\s*$", content)
    if not match:
        return False
    indentation = len(match.group(1))
    fields = {}
    for line in content[match.end():].splitlines():
        if not line.strip():
            continue
        if len(line) - len(line.lstrip()) <= indentation:
            break
        field = re.fullmatch(r"\s+(x|y|zoom):\s+(-?[\d.eE+-]+)\s*", line)
        if field:
            fields[field.group(1)] = float(field.group(2))
    return all(key in fields and math.isclose(value, fields[key], abs_tol=0.001) for key, value in camera.items())


def summarize_timings(values):
    ordered = sorted(values)
    if not ordered:
        return {"count": 0}
    return {
        "count": len(ordered),
        "median_ms": ordered[len(ordered) // 2],
        "p95_ms": ordered[min(len(ordered) - 1, math.ceil(len(ordered) * 0.95) - 1)],
        "maximum_ms": ordered[-1],
    }


def classify_long_tasks(tasks, phases):
    result = []
    for task in tasks:
        start, end = task["start"], task["start"] + task["duration"]
        if "up" in phases and start >= phases["up"]:
            phase = "drop_commit_or_post_drop"
        elif "up" in phases and end > phases["up"]:
            phase = "drag_to_drop_boundary"
        elif start >= phases.get("drag", math.inf):
            phase = "drag"
        else:
            phase = "gesture_start"
        result.append({**task, "phase": phase})
    return result


class CanvasVerification:
    def __init__(self, native):
        self.native = native
        self.report = {
            "kind": "native Electron canvas interaction verification",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "vault": WINDOWS_VAULT,
            "passed": False,
            "checks": [],
            "retained_fixture_layout_changes": True,
            "pointer_transport": "Native CDP touch pointer input; mouse motion is not blocked.",
            "limits": ["No physical microphone or live OAuth test.", "Community themes and mobile require separate acceptance."],
        }
        self.last_pointer = (0, 0)

    def check(self, name, condition, evidence=None):
        self.report["checks"].append({"name": name, "passed": bool(condition), "evidence": evidence})
        print(("PASS " if condition else "FAIL ") + name, flush=True)
        if not condition:
            raise AssertionError(name)

    def snapshot(self):
        return self.wait_for(lambda: self.native.evaluate(SNAPSHOT_SOURCE), "active Inbox canvas")

    def wait_for(self, predicate, description, timeout=8):
        deadline = time.monotonic() + timeout
        latest = None
        while time.monotonic() < deadline:
            try:
                latest = predicate()
            except StopIteration:
                latest = None
            if latest:
                return latest
            time.sleep(0.08)
        raise TimeoutError(f"Timed out waiting for {description}.")

    def card(self, item_id):
        return self.wait_for(lambda: next((card for card in self.snapshot()["cards"] if card["id"] == item_id), None), "mounted card " + item_id)

    def drag(self, start, delta, cancel=False, modifiers=0):
        return self.native.pointer_gesture(start, delta, modifiers=modifiers, cancel=cancel)

    def bounded_delta(self, start, preferred):
        viewport = self.snapshot()["viewport"]
        for delta in (preferred, (-preferred[0], -preferred[1])):
            x, y = start[0] + delta[0], start[1] + delta[1]
            if viewport["x"] + 2 < x < viewport["x"] + viewport["width"] - 2 and viewport["y"] + 2 < y < viewport["y"] + viewport["height"] - 2:
                return delta
        raise ValueError("Neither test gesture direction fits the active canvas. No input was sent.")

    def persisted(self, item_id):
        content = self.native.evaluate("const p=app.plugins.plugins['beautiful-inbox'];const f=await p.repository.ensure_base();return await app.vault.read(f);")
        return parse_persisted_frame(content, item_id)

    def wait_saved(self, item_id, frame):
        def attempt():
            try:
                value = self.persisted(item_id)
                return value if frame_matches(value, frame) else None
            except ValueError:
                return None
        return self.wait_for(attempt, "Base UUID geometry persistence")

    def click(self, point):
        valid = self.native.evaluate(f"return {point[0]}>=0&&{point[1]}>=0&&{point[0]}<innerWidth&&{point[1]}<innerHeight&&Boolean(document.elementFromPoint({point[0]},{point[1]}));")
        if not valid:
            raise ValueError("A native click target is outside the visible renderer. No pointer input was sent.")
        self.native.pointer_tap(point)

    def numeric_dialog(self, item_id, frame):
        selector = f'.beautiful_inbox_item[data-item-id="{item_id}"]'
        rectangle = self.native.evaluate(f"const e=app.workspace.activeLeaf.view.containerEl.querySelector({json.dumps(selector)}).querySelector('[aria-label^=\"More actions for\"]');const r=e.getBoundingClientRect();return {{x:r.x,y:r.y,width:r.width,height:r.height}};")
        self.click(center(rectangle))
        menu = self.wait_menu("Position and size")
        self.click(center(menu))
        self.wait_for(lambda: self.native.evaluate("return document.querySelector('.modal input[aria-label=x]')?.getBoundingClientRect().width>0;"), "numeric modal fields")
        entered = self.native.input_fields(frame)
        for key, value in frame.items():
            actual = entered[key]
            if not actual["trusted"] or not math.isclose(float(actual["value"]), value, abs_tol=0.001):
                raise AssertionError("Native numeric editing did not replace the existing field value.")
        button = self.native.evaluate("const e=[...document.querySelectorAll('.modal button')].find(e=>e.textContent==='Apply');if(!e)throw Error('Apply missing');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};")
        self.click(center(button))
        self.wait_for(lambda: self.native.evaluate("return !document.querySelector('.modal input[aria-label=x]');"), "numeric modal close")
        self.wait_for(lambda: frame_matches(self.card(item_id)["frame"], frame), "numeric geometry rendering")

    def wait_menu(self, label):
        return self.wait_for(lambda: self.native.evaluate(f"const e=[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.includes({json.dumps(label)})&&e.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return {{x:r.x,y:r.y,width:r.width,height:r.height}};"), "menu item " + label)

    def menu_action(self, label):
        rectangle = self.native.evaluate("const e=app.workspace.activeLeaf.view.containerEl.querySelector('[aria-label=\"More Inbox actions\"]');if(!e)throw Error('Inbox menu missing');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};")
        self.click(center(rectangle))
        menu = self.wait_menu(label)
        self.click(center(menu))
        self.wait_for(lambda: self.native.evaluate("return ![...document.querySelectorAll('.menu-item')].some(e=>e.getBoundingClientRect().width>0);"), "menu close")

    def stream_metrics(self, name, card, handle, delta, pointer_type="touch", required=True):
        delta = self.bounded_delta(center(card[handle]), delta)
        started = time.perf_counter()
        metrics = self.native.stream_pointer(center(card[handle]), delta, pointer_type=pointer_type)
        metrics["pointer_type"] = pointer_type
        metrics["delta_screen_pixels"] = delta
        metrics["cli_round_trip_ms"] = (time.perf_counter() - started) * 1000
        metrics["summaries"] = {key: summarize_timings(value) for key, value in metrics.items() if key.endswith("_ms") and isinstance(value, list)}
        metrics["interpretation"] = "Trusted native CDP pointer input paced by renderer rAF. Command timing includes debugger transport. First/second-frame callbacks bracket an intervening renderer paint opportunity; neither proves compositor presentation. CLI round trip covers the complete stream, not each move."
        self.report.setdefault("gesture_streams", {})[name] = metrics
        metrics["final_frame"] = self.card(card["id"])["frame"]
        metrics["geometry_changed"] = not frame_matches(card["frame"], metrics["final_frame"])
        metrics["functional_passed"] = not metrics.get("error") and metrics["trusted_moves"] >= 60 and len(metrics["raf_intervals_ms"]) >= 60 and metrics["geometry_changed"]
        budgets = {"raf_intervals_ms": 20, "input_to_next_frame_ms": 25, "input_to_second_frame_ms": 42}
        metrics["smoothness_budgets_p95_ms"] = budgets
        metrics["smoothness_passed"] = metrics["functional_passed"] and all(metrics["summaries"][key].get("p95_ms", math.inf) <= limit for key, limit in budgets.items()) and not any(entry["duration"] > 50 for entry in metrics["long_tasks"])
        metrics["long_tasks_by_phase"] = classify_long_tasks(metrics["long_tasks"], metrics.get("phases", {}))
        motion_budgets = {"raf_intervals_ms": 20, "received_first_ms": 25, "received_second_ms": 42}
        metrics["renderer_motion_budgets_p95_ms"] = motion_budgets
        metrics["renderer_motion_passed"] = metrics["functional_passed"] and all(metrics["summaries"][key].get("p95_ms", math.inf) <= limit for key, limit in motion_budgets.items()) and not any(task["duration"] > 50 and task["phase"] in ("drag", "drag_to_drop_boundary") for task in metrics["long_tasks_by_phase"])
        self.report.setdefault("gesture_streams", {})[name] = metrics
        if required:
            self.check(name + " delivers trusted native pointer moves and geometry changes", metrics["functional_passed"], metrics["summaries"])

    def clear_selection(self):
        rectangle = self.native.evaluate("const e=[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('button')].find(e=>e.textContent==='Clear selection');if(!e||e.closest('[hidden]'))return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};")
        if rectangle:
            self.click(center(rectangle))

    def search(self, text):
        original = self.native.evaluate("const e=app.workspace.activeLeaf.view.containerEl.querySelector('input[aria-label=\"Search Inbox\"]');e.focus();return e.value;")
        self.native.input_text("Search Inbox", text, modal=False)
        return original

    def measure_selection(self):
        self.clear_selection()
        original_search = self.search("Capture 099")
        try:
            self.wait_for(lambda: (snapshot if (snapshot := self.snapshot())["cards"] and all(card["title"].startswith("Capture 099") for card in snapshot["cards"]) else None), "fixture search results")
            self.menu_action("Select all results")
            count = self.native.evaluate("const e=app.workspace.activeLeaf.view.containerEl.querySelector('.beautiful_inbox_selection_toolbar');return Number(e.textContent.match(/(\\d+) selected/)?.[1]??0);")
            self.check("Fixture search selects a meaningful group", count >= 2 and count <= 200, {"selected_count": count, "query": "Capture 099"})
            snapshot = self.snapshot()
            viewport = snapshot["viewport"]
            card = next(card for card in snapshot["cards"] if all(viewport["x"] < x < viewport["x"] + viewport["width"] and viewport["y"] < y < viewport["y"] + viewport["height"] for x, y in (center(card["move"]), (center(card["move"])[0] + 32, center(card["move"])[1] + 16))))
            self.stream_metrics("selected_group_drag", card, "move", (32, 16))
            self.report["gesture_streams"]["selected_group_drag"]["selected_count"] = count
            self.menu_action("Undo canvas layout change")
        finally:
            self.clear_selection()
            self.search(original_search)

    def run(self):
        self.native.guard()
        self.native.cdp("Runtime.enable", {})
        self.native.evaluate("const p=app.plugins.plugins['beautiful-inbox'];if(!p)throw Error('Inbox plugin is not enabled');await p.open_inbox();return true;")
        self.search("")
        self.menu_action("Reset camera")
        has_grid = self.native.evaluate("return app.workspace.activeLeaf.view.containerEl.querySelector('.beautiful_inbox_canvas').classList.contains('has_grid');")
        if not has_grid:
            self.menu_action("Toggle alignment grid")
        fixture_title = "Native canvas fixture " + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        fixture_result = self.native.evaluate(f"return await app.plugins.plugins['beautiful-inbox'].api.capture({{title:{json.dumps(fixture_title)},body:'Synthetic native canvas acceptance fixture.'}});")
        fixture = fixture_result["item"]
        self.report["fixture_created"] = {"id": fixture["id"], "title": fixture_title}
        self.search(fixture_title)
        self.wait_for(lambda: (snapshot if len((snapshot := self.snapshot())["cards"]) == 1 and snapshot["cards"][0]["id"] == fixture["id"] else None), "exact fixture search rendering")
        initial = self.wait_for(lambda: self.snapshot(), "Inbox canvas")
        self.check("Native renderer is visible and focused", initial["visible"] == "visible" and initial["focused"], initial)
        viewport = initial["viewport"]
        visible = [card for card in initial["cards"] if card["move"]["x"] >= viewport["x"] and card["move"]["y"] >= viewport["y"] and card["resize"]["x"] + card["resize"]["width"] < viewport["x"] + viewport["width"] and card["resize"]["y"] + card["resize"]["height"] < viewport["y"] + viewport["height"]]
        self.check("A fully visible fixture card is available", bool(visible))
        target = next(card for card in visible if card["id"] == fixture["id"])
        item_id = target["id"]
        self.report["item_id"] = item_id
        self.report["initial"] = target
        self.report["fixture_setup"] = target
        self.report["screenshots"] = [self.native.screenshot("canvas-before.png")]
        settings = self.native.evaluate("const s=app.plugins.plugins['beautiful-inbox'].get_settings();return {snap:s.should_snap_cards,grid:s.snap_grid_size};")
        self.check("Grid snapping is enabled for this acceptance fixture", settings["snap"] and settings["grid"] > 0, settings)
        self.drag(center(target["move"]), (23.5, 17.25))
        freeform = self.card(item_id)
        zoom = parse_camera_transform(initial["transform"])["zoom"]
        self.check("Unmodified pointer movement preserves freeform precision", math.isclose(freeform["frame"]["x"] - target["frame"]["x"], 23.5 / zoom, abs_tol=0.5) and math.isclose(freeform["frame"]["y"] - target["frame"]["y"], 17.25 / zoom, abs_tol=0.5), freeform)
        during = self.drag(center(freeform["move"]), (77, 43), modifiers=8)
        moved = self.card(item_id)
        self.check("Actual pointer drag changes world coordinates", not frame_matches(target["frame"], moved["frame"]), moved)
        self.check("Moved card snaps to grid or another card anchor", is_snapped(moved["frame"], [card["frame"] for card in initial["cards"] if card["id"] != item_id], settings["grid"]), {"frame": moved["frame"], "guides_during_drag": during["guides"]})
        self.wait_saved(item_id, moved["frame"])
        self.drag(center(moved["move"]), self.bounded_delta(center(moved["move"]), (53, 31)), cancel=True)
        cancelled = self.card(item_id)
        self.check("Escape cancels pointer move", frame_matches(cancelled["frame"], moved["frame"]), cancelled)
        resize_delta = self.bounded_delta(center(cancelled["resize"]), (61, 47))
        self.drag(center(cancelled["resize"]), resize_delta, modifiers=8)
        resized = self.card(item_id)
        self.check("Actual pointer resize changes dimensions", resized["frame"]["width"] != cancelled["frame"]["width"] and resized["frame"]["height"] != cancelled["frame"]["height"], resized)
        self.wait_saved(item_id, resized["frame"])
        self.verify_remaining(item_id, resized, settings)

    def verify_remaining(self, item_id, resized, settings):
        self.drag(center(resized["resize"]), self.bounded_delta(center(resized["resize"]), (27, 21)), cancel=True)
        self.check("Escape cancels pointer resize", frame_matches(self.card(item_id)["frame"], resized["frame"]))
        self.native.evaluate(f"app.workspace.activeLeaf.view.containerEl.querySelector('.beautiful_inbox_item[data-item-id=\"{item_id}\"] [data-canvas-handle=move]').focus();return true;")
        self.native.key("ArrowRight", modifiers=2)
        keyboard_moved = self.card(item_id)
        self.check("Keyboard moves card by one grid unit", math.isclose(keyboard_moved["frame"]["x"] - resized["frame"]["x"], settings["grid"], abs_tol=0.2))
        self.native.key("ArrowDown", modifiers=10)
        keyboard_resized = self.card(item_id)
        self.check("Keyboard resizes card by one grid unit", math.isclose(keyboard_resized["frame"]["height"] - keyboard_moved["frame"]["height"], settings["grid"], abs_tol=0.2))
        self.menu_action("Undo canvas layout change")
        self.check("Canvas undo reverses one keyboard transaction", frame_matches(self.card(item_id)["frame"], keyboard_moved["frame"]))
        desired = {**keyboard_resized["frame"], "width": 352, "height": 240}
        self.numeric_dialog(item_id, desired)
        numeric = self.card(item_id)
        self.check("Numeric dialog applies geometry", frame_matches(numeric["frame"], desired), numeric)
        self.wait_saved(item_id, desired)
        self.menu_action("Fit selected captures")
        blank = self.native.evaluate("const root=app.workspace.activeLeaf.view.containerEl,c=root.querySelector('.beautiful_inbox_canvas'),doc=root.ownerDocument,r=c.getBoundingClientRect();for(let y=r.bottom-25;y>r.top+25;y-=24)for(let x=r.right-25;x>r.left+25;x-=24){const e=doc.elementFromPoint(x,y);if(e===c||e?.classList.contains('beautiful_inbox_canvas_world'))return {x,y};}throw Error('No blank canvas point');")
        before_pan = self.snapshot()["transform"]
        self.drag((blank["x"], blank["y"]), (-28, -19))
        after_pan = self.snapshot()["transform"]
        self.check("Background pointer drag pans camera", before_pan != after_pan, {"before": before_pan, "after": after_pan})
        self.native.wheel((blank["x"], blank["y"]), -80, modifiers=2)
        after_zoom = self.wait_for(lambda: (value if (value := self.snapshot()["transform"]) != after_pan else None), "wheel zoom")
        self.check("Control wheel zoom changes transform", after_zoom != after_pan, after_zoom)
        camera = parse_camera_transform(after_zoom)
        self.wait_for(lambda: has_persisted_camera(self.native.evaluate("const p=app.plugins.plugins['beautiful-inbox'];return await app.vault.read(await p.repository.ensure_base());"), camera), "camera persistence")
        self.native.evaluate("const l=app.workspace.activeLeaf;l.detach();await app.plugins.plugins['beautiful-inbox'].open_inbox();return true;")
        reopened = self.wait_for(lambda: self.card(item_id), "reopened card")
        self.check("Reopened Base preserves UUID geometry", frame_matches(reopened["frame"], desired), reopened)
        self.check("Reopened Base preserves camera", parse_camera_transform(self.snapshot()["transform"]) == camera, camera)
        self.search("")
        self.menu_action("Fit selected captures")
        self.report["items_at_stream_start"] = self.native.evaluate("return app.plugins.plugins['beautiful-inbox'].api.list({limit:1}).total;")
        self.stream_metrics("single_card_drag", self.card(item_id), "move", (48, 24))
        self.stream_metrics("single_card_resize", self.card(item_id), "resize", (24, 16))
        self.measure_selection()
        try:
            self.stream_metrics("optional_single_card_mouse_drag", self.wait_for(lambda: self.card(item_id), "original search restoration"), "move", (24, 12), pointer_type="mouse", required=False)
        except Exception as error:
            self.report.setdefault("gesture_streams", {})["optional_single_card_mouse_drag"] = {"passed": False, "error": str(error)}
        content = self.native.evaluate("const p=app.plugins.plugins['beautiful-inbox'];return await app.vault.read(await p.repository.ensure_base());")
        registered_source = (Path(__file__).resolve().parents[2] / "packages/inbox/src/ui/inbox_view.ts").read_text(encoding="utf-8")
        source_types = re.findall(r'registerBasesView\(\s*"([^"]+)"', registered_source)
        base_types = re.findall(r"(?m)^\s*(?:-\s*)?type:\s*[\"']?([A-Za-z_]+)", content)
        self.check("Source registers only Beautiful Inbox Cards", source_types == ["beautiful_inbox_cards"], source_types)
        self.check("Managed Base uses Cards without legacy List", "beautiful_inbox_cards" in base_types and "beautiful_inbox_list" not in base_types, base_types)
        self.report["limits"].append("Private Base registry was not inspected. Registration is checked in source and the managed Base; native view-picker options require separate visual review.")
        self.report["final"] = self.snapshot()
        self.report["screenshots"].append(self.native.screenshot("canvas-after.png"))
        self.report["functional_passed"] = True
        self.report["smoothness_passed"] = all(self.report["gesture_streams"][name]["smoothness_passed"] for name in ("single_card_drag", "single_card_resize", "selected_group_drag"))
        self.report["passed_scope"] = "Required native functional checks. Smoothness acceptance is reported separately."
        self.report["passed"] = True


class HarnessTests(unittest.TestCase):
    def test_guard_rejects_other_vault(self):
        validate_vault_path(WINDOWS_VAULT)
        with self.assertRaises(ValueError):
            validate_vault_path(r"C:\Users\Mayaz\OneDrive\Notes")

    def test_result_and_geometry(self):
        self.assertEqual(parse_result('=> BEAUTIFUL_CANVAS_RESULT:{"ok":true}'), {"ok": True})
        content = "views:\n  - beautiful_canvas_layout:\n      version: 1\n      cards:\n        abc:\n          x: -16\n          y: 32\n          width: 352\n          height: 240\n        def:\n          x: 999\n"
        self.assertEqual(parse_persisted_frame(content, "abc"), {"x": -16, "y": 32, "width": 352, "height": 240})
        with self.assertRaises(ValueError):
            parse_persisted_frame(content, "missing")

    def test_snap_accepts_grid_and_alignment(self):
        frame = {"x": 32, "y": 48, "width": 352, "height": 240}
        self.assertTrue(is_snapped(frame, [], 16))
        self.assertFalse(is_snapped({**frame, "x": 33}, [], 16))
        self.assertTrue(is_snapped({**frame, "x": 33}, [{**frame, "x": 33}], 16))

    def test_camera_parser(self):
        camera = parse_camera_transform("translate(-12px, 44px) scale(1.25)")
        self.assertTrue(has_persisted_camera("  beautiful_canvas_camera:\n    x: -12\n    y: 44\n    zoom: 1.25\n  other: true\n", camera))
        self.assertFalse(has_persisted_camera("  other: true\n", camera))

    def test_long_task_phase_attribution(self):
        tasks = [{"start": 10, "duration": 60}, {"start": 90, "duration": 60}, {"start": 200, "duration": 70}]
        result = classify_long_tasks(tasks, {"drag": 5, "up": 100})
        self.assertEqual([task["phase"] for task in result], ["drag", "drag_to_drop_boundary", "drop_commit_or_post_drop"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", help="Native Obsidian.com executable path.")
    parser.add_argument("--self-test", action="store_true", help="Run pure transport/geometry tests without executing Obsidian.")
    arguments = parser.parse_args()
    if arguments.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(HarnessTests)
        return 0 if unittest.TextTestRunner().run(suite).wasSuccessful() else 1
    native = NativeVault(arguments.cli)
    verification = CanvasVerification(native)
    evidence_folder = MOUNTED_VAULT / ".obsidian" / "beautiful-inbox-evidence"
    native.guard()
    evidence_folder.mkdir(parents=True, exist_ok=True)
    try:
        verification.run()
    except Exception as error:
        verification.report["error"] = f"{type(error).__name__}: {error}"
    finally:
        try:
            native.key("Escape")
            native.release_inputs()
        except Exception as error:
            verification.report["cleanup_error"] = str(error)
            verification.report["passed"] = False
        verification.report["finished_at"] = datetime.now(timezone.utc).isoformat()
        path = evidence_folder / "canvas.json"
        path.write_text(json.dumps(verification.report, indent=4) + "\n", encoding="utf-8")
    print(json.dumps({"passed": verification.report["passed"], "evidence": str(path), "error": verification.report.get("error")}))
    return 0 if verification.report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
