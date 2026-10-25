"""Native workflow and appearance acceptance for the isolated Obsidian_Tests vault.

Run only after the coordinator hands over the native window. Workflows retain one
synthetic capture. Appearance mode installs Minimal and Catppuccin in this vault,
then restores the original appearance configuration and active theme.
"""

import argparse
from datetime import datetime, timezone
import json
import time

from native_windows import MOUNTED_VAULT, NativeVault, SETTLE_SOURCE, VISIBLE_SOURCE
from verify_inbox_canvas_native import CanvasVerification, center

DRAFT_KEY = "beautiful_inbox_modal_capture"


class NativeUiVerification(CanvasVerification):
    def __init__(self, native):
        super().__init__(native)
        self.report["kind"] = "native Electron workflow and visual acceptance"

    def open_inbox(self):
        self.native.cdp("Runtime.enable", {})
        rectangle = self.native.evaluate("const e=document.querySelector('.side-dock-ribbon-action[aria-label=Inbox]');if(!e)throw Error('Native Inbox ribbon button missing');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};")
        self.click(center(rectangle))
        self.wait_for(lambda: self.native.evaluate("return app.workspace.activeLeaf.getViewState().type==='bases'&&Boolean(app.workspace.activeLeaf.view.containerEl.querySelector('.beautiful_inbox_canvas'));"), "Inbox ribbon navigation")
        self.check("Native Inbox ribbon opens the dedicated Base tab", True)

    def button(self, label, modal=False):
        root = "document.querySelector('.modal')" if modal else "app.workspace.activeLeaf.view.containerEl"
        rectangle = self.native.evaluate(VISIBLE_SOURCE + f"const root={root};const e=[...root.querySelectorAll('button,[role=button],summary')].find(e=>(e.getAttribute('aria-label')=== {json.dumps(label)}||e.textContent.trim()=== {json.dumps(label)})&&e.getBoundingClientRect().width>0);if(!e)throw Error('Visible button missing');e.scrollIntoView({{block:'nearest',inline:'nearest'}});" + SETTLE_SOURCE + "const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(hit!==e&&!e.contains(hit))throw Error('Button is covered or clipped');return {x:r.x,y:r.y,width:r.width,height:r.height};")
        self.click(center(rectangle))

    def type_field(self, label, value):
        self.report["last_action"] = "fill " + label
        modal = self.native.evaluate("return Boolean(document.querySelector('.modal')); ")
        summary = self.native.evaluate(f"const root=document.querySelector('.modal')??app.workspace.activeLeaf.view.containerEl,e=root.querySelector('[aria-label='+CSS.escape({json.dumps(label)})+']'),d=e?.closest('details:not([open])');return d?.querySelector('summary')?.textContent??null;")
        if summary:
            self.button(summary, modal=modal)
        result = self.native.input_text(label, value, modal=modal)
        if result["value"] != value:
            raise AssertionError("Native input did not replace the field value.")

    def field_value(self, label):
        return self.native.evaluate(f"const root=document.querySelector('.modal')??app.workspace.activeLeaf.view.containerEl;return root.querySelector('[aria-label='+CSS.escape({json.dumps(label)})+']')?.value??null;")

    def find_fixture(self, title):
        return self.native.evaluate(f"return app.plugins.plugins['beautiful-inbox'].api.list({{limit:200,offset:0}}).items.find(e=>e.title==={json.dumps(title)})??null;")

    def fixture(self, item_id):
        return self.native.evaluate(VISIBLE_SOURCE + f"return await Promise.race([app.plugins.plugins['beautiful-inbox'].api.read({json.dumps(item_id)}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Fixture read timed out')),2000))]);")

    def verify_actions(self, item_id, title):
        self.open_inbox()
        self.search(title)
        self.card(item_id)
        if self.native.evaluate("return Boolean(app.workspace.activeLeaf.view.containerEl.querySelector('.beautiful_inbox_inspector.is_open')); "):
            self.button("Close details")
        self.clear_selection()
        rectangle = self.native.evaluate(VISIBLE_SOURCE + f"const e=app.workspace.activeLeaf.view.containerEl.querySelector('.beautiful_inbox_item[data-item-id=\"{item_id}\"] input[type=checkbox]');e.scrollIntoView({{block:'nearest'}});" + SETTLE_SOURCE + "const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};")
        self.click(center(rectangle))
        self.button("Actions for selected captures")
        self.click(center(self.wait_menu("Mark processed")))
        self.wait_for(lambda: self.fixture(item_id)["item"]["status"] == "processed", "processed capture")
        self.check("Native selected action processes capture", True)
        self.menu_action("Undo last Inbox operation")
        self.wait_for(lambda: self.fixture(item_id)["item"]["status"] == "unprocessed", "undo process")
        self.check("Native Undo restores capture status", True)
        self.verify_defer_and_open(item_id, title)

    def verify_defer_and_open(self, item_id, title):
        self.card(item_id)
        rectangle = self.native.evaluate(VISIBLE_SOURCE + f"const e=app.workspace.activeLeaf.view.containerEl.querySelector('.beautiful_inbox_item[data-item-id=\"{item_id}\"] input[type=checkbox]');if(e.checked)return null;e.scrollIntoView({{block:'nearest'}});" + SETTLE_SOURCE + "const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};")
        if rectangle:
            self.click(center(rectangle))
        self.button("Actions for selected captures")
        self.click(center(self.wait_menu("Defer")))
        self.button("Defer", modal=True)
        self.wait_for(lambda: self.fixture(item_id)["item"]["status"] == "deferred", "deferred capture")
        self.check("Native Defer stores a future review time", bool(self.fixture(item_id)["item"].get("review_at")))
        self.menu_action("Undo last Inbox operation")
        self.wait_for(lambda: self.fixture(item_id)["item"]["status"] == "unprocessed", "undo defer")
        self.check("Native Undo reverses deferral", True)
        self.button(title)
        self.button("Open note")
        state = self.native.evaluate("return app.workspace.activeLeaf.getViewState();")
        self.check("Open note navigates to captured Markdown", state.get("type") == "markdown" and state.get("state", {}).get("file") == self.fixture(item_id)["item"]["path"])
        self.open_inbox()
        self.search("")
        self.clear_selection()

    def workflows(self):
        self.native.guard()
        self.native.cdp("Runtime.enable", {})
        self.open_inbox()
        original_draft = self.native.evaluate(f"return app.loadLocalStorage({json.dumps(DRAFT_KEY)})??null;")
        title = "Native UI verification " + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        details = "Synthetic native UI fixture.\n\nCapture draft and inspector verification."
        self.report["fixture_title"] = title
        try:
            self.button("Capture")
            self.type_field("Capture title", title)
            self.type_field("Capture details", details)
            self.type_field("Capture tags", "test native-ui")
            self.native.key("Escape")
            self.button("Capture")
            self.check("Capture draft survives modal close and reopen", self.field_value("Capture title") == title and self.field_value("Capture details") == details)
            self.native.key("Enter", modifiers=2)
            fixture = self.wait_for(lambda: self.find_fixture(title), "captured fixture")
            item_id = fixture["id"]
            self.report["fixture_id"] = item_id
            self.check("Keyboard capture persists the complete body", self.fixture(item_id)["body"].strip() == details)
            self.search(title)
            self.wait_for(lambda: self.card(item_id), "captured fixture card")
            self.button(title)
            self.wait_for(lambda: self.field_value("Item title") == title, "item inspector")
            self.type_field("Item details", details + "\n\nInspector draft.")
            self.button("Close details")
            self.button(title)
            self.check("Inspector draft survives close and reopen", self.field_value("Item details") == details + "\n\nInspector draft.")
            self.button("Save changes")
            self.wait_for(lambda: "Inspector draft." in self.fixture(item_id)["body"], "inspector save")
            self.check("Inspector save persists changes", "Inspector draft." in self.fixture(item_id)["body"])
            self.native.evaluate("const e=app.workspace.activeLeaf.view.containerEl.querySelector('select[aria-label=\"Item status\"]');e.focus();return true;")
            self.native.key("Home")
            self.native.key("ArrowDown")
            self.native.key("ArrowDown")
            self.native.key("Tab")
            self.button("Save changes")
            self.wait_for(lambda: self.fixture(item_id)["item"]["status"] == "processed", "processed status")
            self.check("Native status dropdown processes a capture", self.fixture(item_id)["item"]["status"] == "processed")
            self.menu_action("Undo last Inbox operation")
            self.wait_for(lambda: self.fixture(item_id)["item"]["status"] == "unprocessed", "undo process")
            self.check("Native Undo restores capture status", self.fixture(item_id)["item"]["status"] == "unprocessed")
            self.button("Close details")
            self.wait_for(lambda: self.card(item_id), "restored fixture card")
            checkbox = self.native.evaluate(f"const e=app.workspace.activeLeaf.view.containerEl.querySelector('.beautiful_inbox_item[data-item-id=\"{item_id}\"] input[type=checkbox]');const r=e.getBoundingClientRect();return {{x:r.x,y:r.y,width:r.width,height:r.height}};")
            self.click(center(checkbox))
            self.button("Actions for selected captures")
            menu = self.native.evaluate("const e=[...document.querySelectorAll('.menu-item')].find(e=>/^Defer/.test(e.textContent.trim()));if(!e)throw Error('Defer action missing');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};")
            self.click(center(menu))
            self.button("Defer", modal=True)
            self.wait_for(lambda: self.fixture(item_id)["item"]["status"] == "deferred", "deferred capture")
            self.check("Native Defer stores a future review time", bool(self.fixture(item_id)["item"].get("review_at")))
            self.menu_action("Undo last Inbox operation")
            self.wait_for(lambda: self.fixture(item_id)["item"]["status"] == "unprocessed", "undo defer")
            self.button(title)
            self.button("Open note")
            opened = self.native.evaluate("return app.workspace.activeLeaf.getViewState();")
            self.check("Open note navigates to the captured Markdown file", opened.get("type") == "markdown" and opened.get("state", {}).get("file") == fixture["path"], opened)
            self.open_inbox()
            self.search("")
            self.clear_selection()
            self.report["screenshots"] = [self.native.screenshot("ui-workflows.png")]
            self.report["passed"] = True
        finally:
            try:
                self.native.key("Escape")
                self.native.evaluate(f"app.saveLocalStorage({json.dumps(DRAFT_KEY)},{json.dumps(original_draft)});return true;")
            except Exception as error:
                self.report["draft_cleanup_error"] = str(error)

    def color_scheme(self, scheme):
        value = "moonstone" if scheme == "light" else "obsidian"
        self.native.evaluate(VISIBLE_SOURCE + f"app.changeTheme({json.dumps(value)});" + SETTLE_SOURCE + "return true;")
        self.report["color_scheme_setup"] = "Scoped native app.changeTheme, the installed Appearance control's handler; core Settings UI selectors were not tested."
        self.wait_for(lambda: self.native.evaluate(f"return document.body.classList.contains('theme-{scheme}');"), scheme + " theme")

    def visual_snapshot(self):
        return self.native.evaluate(VISIBLE_SOURCE + "const root=app.workspace.activeLeaf.view.containerEl,owned=root.querySelector('.beautiful_inbox'),c=root.querySelector('.beautiful_inbox_canvas'),card=root.querySelector('.beautiful_inbox_item'),s=getComputedStyle(c),r=c.getBoundingClientRect();return {theme:document.body.className,background:s.backgroundColor,primary:s.getPropertyValue('--background-primary').trim(),font:s.fontFamily,card_background:card?getComputedStyle(card).backgroundColor:null,canvas:{width:r.width,height:r.height},root_width:owned.clientWidth,root_scroll_width:owned.scrollWidth,mounted:root.querySelectorAll('.beautiful_inbox_item').length};")

    def overview_snapshot(self):
        return self.native.evaluate(VISIBLE_SOURCE + "const c=app.workspace.activeLeaf.view.containerEl.querySelector('.beautiful_inbox_overview');if(!c||c.hidden)throw Error('Canvas overview not visible');const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=2166136261,opaque=0;for(let i=0;i<data.length;i+=388){if(data[i+3])opaque++;for(let k=0;k<4;k++)hash=Math.imul(hash^data[i+k],16777619);}return {hash:hash>>>0,opaque_samples:opaque,width:c.width,height:c.height};")

    def narrow(self):
        original = self.native.evaluate("const w=window.electron.remote.getCurrentWindow();return {bounds:w.getBounds(),maximized:w.isMaximized(),fullscreen:w.isFullScreen()};")
        if original["fullscreen"]:
            self.report["narrow_skipped"] = "The test window was fullscreen; its state was preserved."
            return
        try:
            self.native.evaluate(VISIBLE_SOURCE + "const w=window.electron.remote.getCurrentWindow();if(w.isMaximized())w.unmaximize();w.setBounds({...w.getBounds(),width:680,height:900});" + SETTLE_SOURCE + "return true;")
            snapshot = self.visual_snapshot()
            self.report["narrow"] = snapshot
            self.check("Narrow desktop pane contains the Beautiful UI", snapshot["root_scroll_width"] <= snapshot["root_width"] + 2 and snapshot["canvas"]["width"] > 100, snapshot)
            self.report["screenshots"].append(self.native.screenshot("ui-narrow-default-dark.png"))
        finally:
            self.native.evaluate("const w=window.electron.remote.getCurrentWindow();w.setBounds(" + json.dumps(original["bounds"]) + ");" + ("w.maximize();" if original["maximized"] else "") + SETTLE_SOURCE + "return true;")
            restored = self.native.evaluate("const w=window.electron.remote.getCurrentWindow();return {bounds:w.getBounds(),maximized:w.isMaximized()};")
            self.report["window_restore"] = {"original": original, "restored": restored}
            self.check("Original test-window geometry restored", restored["bounds"] == original["bounds"] and restored["maximized"] == original["maximized"])

    def appearance(self):
        self.native.guard()
        self.open_inbox()
        self.native.evaluate("if(typeof app.setting?.close==='function')app.setting.close();return true;")
        appearance_path = MOUNTED_VAULT / ".obsidian" / "appearance.json"
        original_file = appearance_path.read_text(encoding="utf-8")
        self.report["original_appearance_file"] = original_file
        original = self.native.evaluate("return {base:app.vault.getConfig('theme'),community:app.customCss.theme||'',body:document.body.className};")
        self.report["original_appearance"] = original
        self.report["themes"] = []
        self.report["screenshots"] = []
        try:
            installed = self.native.command("themes").splitlines()
            for name in ("Minimal", "Catppuccin"):
                if name not in installed:
                    self.native.command("theme:install", "name=" + name)
            for theme in ("", "Minimal", "Catppuccin"):
                self.native.command("theme:set", "name=" + theme)
                self.wait_for(lambda: self.native.evaluate(f"return app.customCss.theme==={json.dumps(theme)};"), "community theme activation")
                if not theme:
                    self.menu_action("Fit all captures")
                    before_overview = self.overview_snapshot()
                for scheme in ("light", "dark"):
                    self.color_scheme(scheme)
                    if not theme:
                        overview = self.overview_snapshot()
                        self.check("Live " + scheme + " theme repaints the Canvas2D overview", overview["opaque_samples"] > 0 and overview["hash"] != before_overview["hash"], {"before": before_overview, "after": overview})
                        self.report["screenshots"].append(self.native.screenshot("ui-overview-default-" + scheme + ".png"))
                        self.menu_action("Reset camera")
                    snapshot = self.visual_snapshot()
                    self.report["themes"].append({"name": theme or "Default", "scheme": scheme, **snapshot})
                    self.check((theme or "Default") + " " + scheme + " has a usable canvas", snapshot["canvas"]["width"] > 100 and snapshot["canvas"]["height"] > 100 and snapshot["root_scroll_width"] <= snapshot["root_width"] + 2, snapshot)
                    self.report["screenshots"].append(self.native.screenshot("ui-" + (theme.lower() or "default") + "-" + scheme + ".png"))
                    if not theme and scheme == "light":
                        self.menu_action("Fit all captures")
                        before_overview = self.overview_snapshot()
                self.menu_action("Reset camera")
            self.report["retained_test_themes"] = ["Minimal", "Catppuccin"]
            self.native.command("theme:set", "name=")
            self.color_scheme("dark")
            self.narrow()
            self.report["passed"] = True
        finally:
            self.native.key("Escape")
            self.native.command("theme:set", "name=" + original["community"])
            self.native.evaluate(f"app.changeTheme({json.dumps(original['base'])});return true;")
            self.wait_for(lambda: self.native.evaluate(f"return app.vault.getConfig('theme')==={json.dumps(original['base'])}&&app.customCss.theme==={json.dumps(original['community'])};"), "original appearance restoration")
            self.native.evaluate(f"await app.vault.adapter.write('.obsidian/appearance.json',{json.dumps(original_file)});return true;")
            self.report["appearance_file_restored"] = appearance_path.read_text(encoding="utf-8") == original_file
            self.check("Original appearance file restored", self.report["appearance_file_restored"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli")
    parser.add_argument("--mode", choices=("workflows", "appearance"), default="workflows")
    arguments = parser.parse_args()
    native = NativeVault(arguments.cli)
    native.guard()
    verification = NativeUiVerification(native)
    try:
        getattr(verification, arguments.mode)()
    except Exception as error:
        verification.report["passed"] = False
        verification.report["error"] = f"{type(error).__name__}: {error}"
    finally:
        try:
            native.key("Escape")
            native.release_inputs()
        except Exception as error:
            verification.report["cleanup_error"] = str(error)
            verification.report["passed"] = False
        verification.report["finished_at"] = datetime.now(timezone.utc).isoformat()
        folder = MOUNTED_VAULT / ".obsidian" / "beautiful-inbox-evidence"
        folder.mkdir(exist_ok=True)
        path = folder / ("ui-" + arguments.mode + ".json")
        path.write_text(json.dumps(verification.report, indent=4) + "\n", encoding="utf-8")
    print(json.dumps({"passed": verification.report["passed"], "evidence": str(path), "error": verification.report.get("error")}))
    return 0 if verification.report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
