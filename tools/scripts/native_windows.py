"""Bounded official Obsidian CLI transport for the isolated Windows test vault."""

import json
import ntpath
from pathlib import Path
import shutil
import subprocess
import uuid

TEST_VAULT = "Obsidian_Tests"
WINDOWS_VAULT = r"C:\Users\Mayaz\OneDrive\Tests\Obsidian_Tests"
MOUNTED_VAULT = Path("/mnt/c/Users/Mayaz/OneDrive/Tests/Obsidian_Tests")
MAX_EVAL_CHARACTERS = 3500
RESULT_MARKER = "BEAUTIFUL_CANVAS_RESULT:"
DEFAULT_CLI = "/mnt/c/Users/Mayaz/AppData/Local/Programs/Obsidian/Obsidian.com"
VISIBLE_SOURCE = "const bw=window.electron.remote.getCurrentWindow();if(bw.isMinimized())bw.restore();bw.show();bw.focus();for(let deadline=Date.now()+1500;document.visibilityState!=='visible'||!document.hasFocus();){if(Date.now()>deadline)throw Error('Renderer hidden or unfocused');await new Promise(r=>setTimeout(r,10));}"
SETTLE_SOURCE = "for(let i=0;i<2;i++)await new Promise((resolve,reject)=>{let id;const timer=setTimeout(()=>{cancelAnimationFrame(id);reject(Error('Native UI frame timed out'));},1500);id=requestAnimationFrame(()=>{clearTimeout(timer);resolve();});});"

FOREGROUND_SOURCE = r"""
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class BeautifulCanvasWindow {
    public delegate bool Callback(IntPtr handle, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr handle, uint flags);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint process);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint first, uint second, bool attach);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
$script:beautiful_matches = [System.Collections.Generic.List[IntPtr]]::new()
$callback = [BeautifulCanvasWindow+Callback]{ param($handle, $parameter)
    $title = [System.Text.StringBuilder]::new(1024)
    [void][BeautifulCanvasWindow]::GetWindowText($handle, $title, 1024)
    if ($title.ToString() -match '(?<![A-Za-z0-9_])Obsidian_Tests(?![A-Za-z0-9_])' -and $title.ToString() -match 'Obsidian') {
        $script:beautiful_matches.Add($handle)
    }
    return $true
}
[void][BeautifulCanvasWindow]::EnumWindows($callback, [IntPtr]::Zero)
if ($script:beautiful_matches.Count -ne 1) { throw 'Expected exactly one Obsidian_Tests native window.' }
$target = $script:beautiful_matches[0]
if ([BeautifulCanvasWindow]::IsIconic($target)) { [void][BeautifulCanvasWindow]::ShowWindow($target, 9) }
$current_thread = [BeautifulCanvasWindow]::GetCurrentThreadId()
[uint32]$process_id = 0
$foreground_thread = [BeautifulCanvasWindow]::GetWindowThreadProcessId([BeautifulCanvasWindow]::GetForegroundWindow(), [ref]$process_id)
$target_thread = [BeautifulCanvasWindow]::GetWindowThreadProcessId($target, [ref]$process_id)
$attached = [System.Collections.Generic.List[uint32]]::new()
try {
    foreach ($thread in @($foreground_thread, $target_thread) | Select-Object -Unique) {
        if ($thread -ne 0 -and $thread -ne $current_thread) {
            if ([BeautifulCanvasWindow]::AttachThreadInput($current_thread, $thread, $true)) { $attached.Add($thread) }
        }
    }
    [void][BeautifulCanvasWindow]::SetForegroundWindow($target)
    $foreground = [BeautifulCanvasWindow]::GetForegroundWindow()
    if ($foreground -ne $target -and [BeautifulCanvasWindow]::GetAncestor($foreground, 3) -ne $target) { throw 'Could not foreground Obsidian_Tests.' }
} finally {
    foreach ($thread in $attached) { [void][BeautifulCanvasWindow]::AttachThreadInput($current_thread, $thread, $false) }
}
$target_title = [System.Text.StringBuilder]::new(1024)
[void][BeautifulCanvasWindow]::GetWindowText($target, $target_title, 1024)
$foreground = [BeautifulCanvasWindow]::GetForegroundWindow()
@{ target_handle=$target.ToInt64(); title=$target_title.ToString(); foreground_handle=$foreground.ToInt64(); foreground=($foreground -eq $target -or [BeautifulCanvasWindow]::GetAncestor($foreground, 3) -eq $target); visible=[BeautifulCanvasWindow]::IsWindowVisible($target) } | ConvertTo-Json -Compress
"""


def focus_test_vault():
    """Focus only the named vault. Call in the same blocking process as input."""
    completed = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", FOREGROUND_SOURCE],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if completed.returncode:
        raise RuntimeError(f"Test window foregrounding failed: {completed.stderr[-800:]}")
    metadata = json.loads(completed.stdout.strip())
    if not metadata.get("foreground"):
        raise RuntimeError("The exact Obsidian_Tests window is not foreground.")
    return metadata


def resolve_cli(configured_path=None):
    executable = configured_path or (DEFAULT_CLI if Path(DEFAULT_CLI).is_file() else shutil.which("Obsidian.com"))
    if not executable or not Path(executable).is_file():
        raise ValueError("Obsidian CLI was not found. Pass --cli with the native Obsidian.com path.")
    return str(executable)


def validate_vault_path(value):
    if ntpath.normcase(ntpath.normpath(value.strip())) != ntpath.normcase(WINDOWS_VAULT):
        raise ValueError("Native verification is restricted to the exact Obsidian_Tests vault path.")


def parse_result(output):
    for line in reversed(output.splitlines()):
        line = line.removeprefix("=> ").strip()
        try:
            decoded = json.loads(line)
            if isinstance(decoded, str):
                line = decoded
        except json.JSONDecodeError:
            pass
        if RESULT_MARKER in line:
            return json.loads(line.split(RESULT_MARKER, 1)[1])
    raise ValueError(f"Native CLI returned no structured result: {output[-600:]}")


class NativeVault:
    def __init__(self, cli=None, timeout_seconds=30):
        self.executable = resolve_cli(cli)
        self.timeout_seconds = timeout_seconds

    def command(self, command, *arguments):
        completed = subprocess.run(
            [self.executable, f"vault={TEST_VAULT}", command, *arguments],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=self.timeout_seconds,
            check=False,
        )
        if completed.returncode:
            raise RuntimeError(f"Obsidian {command} failed: {completed.stderr[-600:]}")
        return completed.stdout

    def guard(self):
        output = self.command("vault", "info=path")
        paths = [line.strip().removeprefix("=> ") for line in output.splitlines() if "Obsidian_Tests" in line]
        if len(paths) != 1:
            raise ValueError("Could not verify the native test vault path.")
        validate_vault_path(paths[0])
        self.evaluate("return {name:app.vault.getName(),path:app.vault.adapter.getBasePath()};")

    def foreground(self):
        return focus_test_vault()

    def evaluate(self, source):
        guard = f"if(app.vault.getName()!=={json.dumps(TEST_VAULT)}||app.vault.adapter.getBasePath().toLowerCase()!=={json.dumps(WINDOWS_VAULT.lower())})throw Error('Wrong test vault');"
        code = f"(async()=>{{{guard}const value=await(async()=>{{{source}}})();return {json.dumps(RESULT_MARKER)}+JSON.stringify(value);}})()"
        if len("code=" + code) > MAX_EVAL_CHARACTERS:
            raise ValueError("The native eval payload exceeds 3500 characters. Split the operation.")
        return parse_result(self.command("eval", "code=" + code))

    def evaluate_script(self, source):
        """Stage bounded source chunks, then run one native evaluation."""
        if len(source) > 20000:
            raise ValueError("Native verification source exceeds its staging bound.")
        key = "__beautiful_native_" + uuid.uuid4().hex
        encoded_key = json.dumps(key)
        self.evaluate(f"if(Object.hasOwn(globalThis,{encoded_key}))throw Error('Temporary key collision');globalThis[{encoded_key}]='';return true;")
        try:
            for offset in range(0, len(source), 1000):
                chunk = json.dumps(source[offset:offset + 1000])
                self.evaluate(f"globalThis[{encoded_key}]+={chunk};return true;")
            return self.evaluate(f"const source=globalThis[{encoded_key}];delete globalThis[{encoded_key}];return await eval('(async()=>{{'+source+'}})()');")
        finally:
            self.evaluate(f"delete globalThis[{encoded_key}];return true;")

    def cdp(self, method, parameters):
        self.command("dev:cdp", "method=" + method, "params=" + json.dumps(parameters, separators=(",", ":")))

    def mouse(self, kind, x, y, button="none", buttons=0, modifiers=0):
        self.cdp("Input.dispatchMouseEvent", {
            "type": kind, "x": x, "y": y, "button": button,
            "buttons": buttons, "clickCount": 1, "modifiers": modifiers,
        })

    def key(self, key, modifiers=0, code=None):
        parameters = {"key": key, "code": code or key, "modifiers": modifiers}
        virtual_codes = {"Enter": 13, "Escape": 27, "Tab": 9, "Backspace": 8, "Home": 36, "End": 35, "ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39, "ArrowDown": 40}
        virtual_code = virtual_codes.get(key, ord(key.upper()) if len(key) == 1 else 0)
        parameters.update({"windowsVirtualKeyCode": virtual_code, "nativeVirtualKeyCode": virtual_code})
        commands = {"commands": ["selectAll"]} if key.lower() == "a" and modifiers & 2 else {}
        source = VISIBLE_SOURCE + "const d=window.electron.remote.getCurrentWebContents().debugger;await d.sendCommand('Input.dispatchKeyEvent'," + json.dumps({"type": "keyDown", **parameters, **commands}) + ");await d.sendCommand('Input.dispatchKeyEvent'," + json.dumps({"type": "keyUp", **parameters}) + ");" + SETTLE_SOURCE + "return true;"
        self.evaluate(source)

    def release_inputs(self):
        self.cdp("Input.dispatchTouchEvent", {"type": "touchCancel", "touchPoints": []})
        self.mouse("mouseReleased", 0, 0, "left")
        for key in ("Control", "Shift", "Alt", "Meta"):
            self.cdp("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "modifiers": 0})

    def screenshot(self, name):
        path = WINDOWS_VAULT + "\\.obsidian\\beautiful-inbox-evidence\\" + name
        self.command("dev:screenshot", "path=" + path)
        return path

    def pointer_gesture(self, start, delta=(0, 0), modifiers=0, cancel=False, steps=6):
        self.validate_segment(start, delta, canvas_only=steps > 0)
        options = json.dumps({"start": start, "delta": delta, "modifiers": modifiers, "cancel": cancel, "steps": steps})
        source = r"""
const o=OPTIONS,remote=window.electron?.remote;
if(app.workspace.activeLeaf.view.containerEl.ownerDocument!==document)throw Error('Active leaf uses another WebContents; transport refused');
VISIBLE
if(!remote?.getCurrentWebContents)throw Error('Native debugger bridge unavailable');
const debug=remote.getCurrentWebContents().debugger;
if(!debug.isAttached())throw Error('Official CLI debugger is not attached');
const bounded=async p=>{let t;try{return await Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('Native pointer acknowledgement timed out')),2000);})]);}finally{clearTimeout(t);}};
const frame=()=>{let id;return bounded(new Promise(resolve=>{id=requestAnimationFrame(resolve);})).finally(()=>cancelAnimationFrame(id));};
const send=(type,x,y)=>bounded(debug.sendCommand('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:77}],modifiers:o.modifiers}));
let result;
try{await send('touchStart',...o.start);for(let i=1;i<=o.steps;i++){await frame();await send('touchMove',o.start[0]+o.delta[0]*i/o.steps,o.start[1]+o.delta[1]*i/o.steps);}await frame();result={guides:app.workspace.activeLeaf.view.containerEl.querySelectorAll('.beautiful_inbox_alignment_guide').length};if(o.cancel){await bounded(debug.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'}));await bounded(debug.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'}));}await send('touchEnd');await frame();return result;}
finally{try{await send('touchCancel');}catch(e){if(!String(e).includes('Must send a TouchStart'))throw e;}}
""".replace("OPTIONS", options).replace("VISIBLE", VISIBLE_SOURCE)
        return self.evaluate(source)

    def pointer_tap(self, point):
        self.validate_segment(point, (0, 0), canvas_only=False)
        source = r"""
VISIBLE
const [x,y]=POINT,debug=window.electron.remote.getCurrentWebContents().debugger;
let down=true;
try{await debug.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});down=false;SETTLE return true;}
finally{if(down)await debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0});}
""".replace("VISIBLE", VISIBLE_SOURCE).replace("POINT", json.dumps(point)).replace("SETTLE", SETTLE_SOURCE)
        return self.evaluate(source)

    def wheel(self, point, delta_y, modifiers=0):
        self.validate_segment(point, (0, 0))
        parameters = {"type": "mouseWheel", "x": point[0], "y": point[1], "deltaX": 0, "deltaY": delta_y, "modifiers": modifiers}
        return self.evaluate(VISIBLE_SOURCE + "await window.electron.remote.getCurrentWebContents().debugger.sendCommand('Input.dispatchMouseEvent'," + json.dumps(parameters) + ");" + SETTLE_SOURCE + "return true;")

    def input_fields(self, values):
        source = r"""
VISIBLE
const values=VALUES,doc=app.workspace.activeLeaf.view.containerEl.ownerDocument;
if(doc!==document)throw Error('Wrong WebContents');
const debug=window.electron.remote.getCurrentWebContents().debugger,result={};
for(const [label,value]of Object.entries(values)){
const e=doc.querySelector('.modal')?.querySelector('[aria-label='+CSS.escape(label)+']');
if(!e||!e.getBoundingClientRect().width)throw Error('Visible numeric input missing: '+label);
let trusted=false;const listen=event=>{trusted=event.isTrusted;};e.addEventListener('input',listen);e.focus();e.select();
try{await debug.sendCommand('Input.insertText',{text:String(value)});if(e.value!==String(value))throw Error('Numeric input was not replaced: '+label);result[label]={value:e.value,trusted};}finally{e.removeEventListener('input',listen);}}
SETTLE return result;
""".replace("VISIBLE", VISIBLE_SOURCE).replace("VALUES", json.dumps(values)).replace("SETTLE", SETTLE_SOURCE)
        return self.evaluate(source)

    def validate_segment(self, start, delta, canvas_only=True):
        options = json.dumps({"start": start, "delta": delta, "canvas_only": canvas_only})
        source = r"""
const o=OPTIONS,root=app.workspace.activeLeaf.view.containerEl,doc=root.ownerDocument;
if(doc!==document)throw Error('Active leaf uses another WebContents; transport refused');
const c=root.querySelector('.beautiful_inbox_canvas'),r=c?.getBoundingClientRect();
for(const [x,y] of [o.start,[o.start[0]+o.delta[0],o.start[1]+o.delta[1]]]){
if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=innerWidth||y>=innerHeight)throw Error('Pointer segment leaves the visible renderer');
if(o.canvas_only&&(!r||x<r.left||x>=r.right||y<r.top||y>=r.bottom))throw Error('Pointer segment leaves the active canvas');
}
const hit=doc.elementFromPoint(...o.start);
if(!hit||(o.canvas_only&&!c.contains(hit)))throw Error('Pointer start is obstructed or outside the active canvas');
return true;
""".replace("OPTIONS", options)
        return self.evaluate(source)

    def input_text(self, label, text, modal=True):
        options = json.dumps({"label": label, "text": str(text), "modal": modal})
        source = r"""
const o=OPTIONS,doc=app.workspace.activeLeaf.view.containerEl.ownerDocument;
if(doc!==document)throw Error('Active leaf uses another WebContents; transport refused');
VISIBLE
const root=o.modal?doc.querySelector('.modal'):app.workspace.activeLeaf.view.containerEl;
const e=root?.querySelector('[aria-label='+CSS.escape(o.label)+']');
if(!e||!e.getBoundingClientRect().width||e.closest('details:not([open])'))throw Error('Input is missing or inside a collapsed section');
const debug=window.electron.remote.getCurrentWebContents().debugger;
let trusted=false;const listen=event=>{trusted=event.isTrusted;};
e.addEventListener('input',listen);e.focus();e.select();if(doc.activeElement!==e){e.removeEventListener('input',listen);throw Error('The requested input did not receive focus');}
try{await debug.sendCommand('Input.insertText',{text:o.text});if(e.value!==o.text)throw Error('Input selection mismatch '+o.label+' expected length '+o.text.length+' actual '+e.value.length);SETTLE return {value:e.value,trusted};}
finally{e.removeEventListener('input',listen);}
""".replace("OPTIONS", options).replace("VISIBLE", VISIBLE_SOURCE).replace("SETTLE", SETTLE_SOURCE)
        return self.evaluate(source)

    def stream_pointer(self, start, delta, steps=90, pointer_type="touch"):
        if pointer_type not in ("touch", "mouse"):
            raise ValueError("Unsupported native pointer transport.")
        self.validate_segment(start, delta)
        options = json.dumps({"start": start, "delta": delta, "steps": steps, "pointer_type": pointer_type})
        source = r"""
const o=OPTIONS,debug=window.electron.remote.getCurrentWebContents().debugger;
const result={raf_intervals_ms:[],pointer_intervals_ms:[],input_to_next_frame_ms:[],input_to_second_frame_ms:[],received_first_ms:[],received_second_ms:[],dispatch_delay_ms:[],cdp_command_ms:[],long_tasks:[],trusted_moves:0,mounted_max:0,phases:{}};
const bounded=async p=>{let t;try{return await Promise.race([p,new Promise((_,r)=>{t=setTimeout(()=>r(Error('Native stream timed out')),2000);})]);}finally{clearTimeout(t);}};
const frame=()=>{let id;return bounded(new Promise(r=>{id=requestAnimationFrame(r);})).finally(()=>cancelAnimationFrame(id));};
const root=app.workspace.activeLeaf.view.containerEl;
if(root.ownerDocument!==document)throw Error('Wrong WebContents');
VISIBLE
let active=true,last_frame,last_pointer,frame_id;
const sample=t=>{if(!active)return;if(last_frame!==undefined)result.raf_intervals_ms.push(t-last_frame);last_frame=t;result.mounted_max=Math.max(result.mounted_max,root.querySelectorAll('.beautiful_inbox_item').length);frame_id=requestAnimationFrame(sample);};
const pending=new Set();
const listener=e=>{if(e.pointerType!==o.pointer_type)return;const received=performance.now();result.dispatch_delay_ms.push(received-e.timeStamp);if(e.isTrusted)result.trusted_moves++;if(last_pointer!==undefined)result.pointer_intervals_ms.push(e.timeStamp-last_pointer);last_pointer=e.timeStamp;const stamp=e.timeStamp;const id=requestAnimationFrame(()=>{pending.delete(id);result.input_to_next_frame_ms.push(performance.now()-stamp);result.received_first_ms.push(performance.now()-received);const next=requestAnimationFrame(()=>{pending.delete(next);result.input_to_second_frame_ms.push(performance.now()-stamp);result.received_second_ms.push(performance.now()-received);});pending.add(next);});pending.add(id);};
const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())result.long_tasks.push({start:e.startTime,duration:e.duration});});
let last=[...o.start];
const send=async(type,x,y)=>{const begin=performance.now();if(x!==undefined)last=[x,y];if(o.pointer_type==='mouse'){const end=type==='touchEnd'||type==='touchCancel';await bounded(debug.sendCommand('Input.dispatchMouseEvent',{type:end?'mouseReleased':type==='touchStart'?'mousePressed':'mouseMoved',x:last[0],y:last[1],button:'left',buttons:end?0:1,clickCount:1}));}else await bounded(debug.sendCommand('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:91}]}));result.cdp_command_ms.push(performance.now()-begin);};
document.addEventListener('pointermove',listener,true);
try{observer.observe({entryTypes:['longtask']});frame_id=requestAnimationFrame(sample);result.phases.down=performance.now();await send('touchStart',...o.start);result.phases.drag=performance.now();for(let i=1;i<=o.steps;i++){await frame();await send('touchMove',o.start[0]+o.delta[0]*i/o.steps,o.start[1]+o.delta[1]*i/o.steps);}result.phases.up=performance.now();await send('touchEnd');result.phases.up_ack=performance.now();await frame();result.phases.end=performance.now();return result;}catch(e){result.error=String(e);return result;}
finally{active=false;cancelAnimationFrame(frame_id);for(const id of pending)cancelAnimationFrame(id);for(const e of observer.takeRecords())result.long_tasks.push({start:e.startTime,duration:e.duration});observer.disconnect();document.removeEventListener('pointermove',listener,true);try{await send('touchCancel');}catch(e){if(!String(e).includes('Must send a TouchStart'))throw e;}}
""".replace("OPTIONS", options).replace("VISIBLE", VISIBLE_SOURCE)
        transport_names = {
            "raf_intervals_ms": "raf",
            "pointer_intervals_ms": "pointer",
            "input_to_next_frame_ms": "first",
            "input_to_second_frame_ms": "second",
            "cdp_command_ms": "commands",
            "trusted_moves": "trusted",
            "mounted_max": "mounted",
        }
        for public_name, transport_name in transport_names.items():
            source = source.replace(public_name, transport_name)
        result = self.evaluate_script(source.replace("\n", ""))
        return {next((public_name for public_name, transport_name in transport_names.items() if key == transport_name), key): value for key, value in result.items()}
