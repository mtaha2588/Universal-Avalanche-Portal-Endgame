"""
record_demo.py - record the REAL running portal as the interview demo video (demo/assets/demo.mp4)
=================================================================================================
Chrome is driven through the DevTools protocol along a fixed script (SCENES below). Each scene's page is loaded and
left to settle BEFORE recording starts (so the film has no loading screens), then the scene's actions run while the
screen is recorded. Default: a full-screen Chrome window on a second monitor (--screen X,Y, default 1920,0) recorded
by ffmpeg's desktop grabber at a true 30 fps with the real GPU (Chrome's own screencast gave only ~10 fps).
--screencast keeps the older DevTools-screencast method (headless, no monitor needed, choppier). The scenes are joined
with short crossfades. Nothing is drawn or edited: every
frame is the portal rendering its own data. demo/data/chapters.json gets the chapter start times for the player.

Needs: the portal running (start.cmd), Google Chrome, and a Python with websocket-client + imageio-ffmpeg
(not in the portal's requirements; e.g. a scratch venv:  python -m venv rec && rec\\Scripts\\pip install websocket-client imageio-ffmpeg)

    rec\\Scripts\\python scripts/record_demo.py                 record every scene and build demo.mp4
    rec\\Scripts\\python scripts/record_demo.py --probe         only measure the frame rate Chrome achieves
    rec\\Scripts\\python scripts/record_demo.py --only alert    re-record some scenes (the rest are reused) and rebuild
    rec\\Scripts\\python scripts/record_demo.py --screen 0,0    record on the primary monitor instead (keep that monitor uncovered)
"""
import argparse
import base64
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import imageio_ffmpeg
import websocket

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "demo" / ".record"            # frames + per-scene clips (git-ignored)
OUT = ROOT / "demo" / "assets" / "demo.mp4"
CHAPTERS = ROOT / "demo" / "data" / "chapters.json"
W, H, FPS, XFADE = 1920, 1080, 30, 0.7
CHROME = next((p for p in [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                           r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"] if Path(p).exists()), "chrome")

# ------------------------------------------------------------------------------------------------ the film script
# Each scene: id, chapter title, page to load, seconds to settle, optional "pre" actions run off-camera (to warm a view),
# then the actions while recording:
#   ("wait", s) | ("js", expr) | ("js_wait", expr, s)   (the recording length is the sum of the waits)
SCENES = [
    # owner: "short time for every thing but show all the marvels of the portal": many short scenes (~4-8 s each)
    dict(id="intro", title="Opening: Earth to Pakistan", url="/", settle=0.0, actions=[("wait", 9.0)]),
    dict(id="mapping", title="Northern Pakistan: terrain mapping", url="/", settle=0.0, pre=[("wait", 21.0)], actions=[("wait", 5.5)]),
    dict(id="home", title="Command portal: three glacier systems", url="/#home", settle=13, actions=[
        ("wait", 0.8), ("js", "document.querySelector('.tile.grp').click()"), ("wait", 1.4),
        ("js", "bgMap.focus('Karakoram')"), ("wait", 3.6), ("js", "bgMap.focus('Hindu Kush')"), ("wait", 2.6)]),
    dict(id="screening", title="Hotspots and avalanche simulation", url="/portal#hindukush", settle=15, actions=[
        ("wait", 1.0), ("js", "document.querySelector('#hk-tour').click()"), ("wait", 6.5)]),
    dict(id="karakoram", title="Karakoram: the Batura model", url="/portal#karakoram", settle=7, actions=[("wait", 5.0)]),
    dict(id="alert", title="15-day Avalanche Alert Forecast", url="/#alertforecast", settle=17, actions=[
        ("wait", 3.5), ("js", "document.querySelector('.ad-fab').click()"), ("wait", 3.8)]),
    dict(id="history", title="Historical avalanches replayed in 3D", url="/#history", settle=6,
         pre=[("js", "HistTour.open({ tour: true })"), ("wait", 15.0)], actions=[("wait", 8.0)]),
    dict(id="tour3d", title="3D cinematic tour (CesiumJS)", url="/tour3d", settle=20, actions=[("wait", 7.0)]),
    dict(id="climate", title="Climate 1970-2010 and projections to 2100", url="/#climate", settle=12,
         pre=[("js", "document.querySelector('[data-view=proj]').click()"), ("wait", 9.0),
              ("js", "document.querySelector('[data-view=forecast]').click()"), ("wait", 4.0)], actions=[
        ("wait", 3.5), ("js", "document.querySelector('[data-view=proj]').click()"), ("wait", 4.5)]),
    dict(id="models", title="Model framework", url="/models", settle=12, actions=[("wait", 4.5)]),
    dict(id="kkh", title="Karakoram Highway safety tour", url="/kkh", settle=16, actions=[
        ("js", "document.querySelector('[data-tour]').click()"), ("wait", 7.5)]),
]


class Tab:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, max_size=None, enable_multithread=True)
        self.n, self.lock, self.waiters, self.frames, self.rec = 0, threading.Lock(), {}, [], None
        self.errors = []
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while True:
            try:
                m = json.loads(self.ws.recv())
            except Exception:
                return
            if "id" in m and m["id"] in self.waiters:
                self.waiters[m["id"]]["r"] = m
                self.waiters[m["id"]]["e"].set()
            elif m.get("method") == "Page.screencastFrame":
                p = m["params"]
                self.send("Page.screencastFrameAck", sessionId=p["sessionId"], wait=False)
                if self.rec is not None:
                    i = len(self.frames)
                    f = self.rec / f"f{i:05d}.jpg"
                    f.write_bytes(base64.b64decode(p["data"]))
                    self.frames.append((p["metadata"]["timestamp"], f.name))
            elif m.get("method") == "Runtime.exceptionThrown":
                self.errors.append(m["params"]["exceptionDetails"].get("exception", {}).get("description", "?")[:200])

    def send(self, method, wait=True, timeout=30, **params):
        with self.lock:
            self.n += 1
            i = self.n
        ev = {"e": threading.Event()}
        if wait:
            self.waiters[i] = ev
        self.ws.send(json.dumps({"id": i, "method": method, "params": params}))
        if wait:
            ev["e"].wait(timeout)
            return self.waiters.pop(i).get("r", {})

    def js(self, expr):
        r = self.send("Runtime.evaluate", expression=f"(async () => {{ {expr}; return 1 }})()", awaitPromise=True, returnByValue=True)
        return r.get("result", {}).get("result", {}).get("value")

    def value(self, expr):
        r = self.send("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
        return r.get("result", {}).get("result", {}).get("value")


def chrome(headed, base, screen=None):
    prof = Path(tempfile.mkdtemp(prefix="demo-rec-"))
    args = [CHROME, f"--remote-debugging-port=9351", f"--user-data-dir={prof}", f"--window-size={W},{H}", "--window-position=0,0",
            "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
            "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
            "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--force-device-scale-factor=1"]
    if screen:
        args = [x for x in args if not x.startswith(("--window-position", "--window-size"))]
        args += [f"--window-position={screen[0]},{screen[1]}", f"--window-size={W},{H}", "--kiosk", "--disable-infobars",
                 "--disable-session-crashed-bubble", "--noerrdialogs", "--disable-features=Translate,TranslateUI"]
    elif not headed:
        args.insert(1, "--headless=new")
    args.append("about:blank")
    proc = subprocess.Popen(args)
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9351/json"))
            page = next(t for t in tabs if t["type"] == "page")
            break
        except Exception:
            time.sleep(0.2)
    tab = Tab(page["webSocketDebuggerUrl"])
    for m in ("Page.enable", "Runtime.enable", "Network.enable"):
        tab.send(m)
    tab.send("Network.setCacheDisabled", cacheDisabled=False)
    if not screen:
        tab.send("Emulation.setDeviceMetricsOverride", width=W, height=H, deviceScaleFactor=1, mobile=False)
    return proc, tab, prof


def goto(tab, base, path):
    tab.send("Page.navigate", url="about:blank")
    time.sleep(0.4)
    tab.send("Page.navigate", url=base + path)


def fps_probe(tab):
    return tab.value("new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(Math.round(n / 3)); }; requestAnimationFrame(f); })")


def record_scene(tab, base, sc):
    d = WORK / sc["id"]
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True, exist_ok=True)
    goto(tab, base, sc["url"])
    time.sleep(sc["settle"])
    tab.frames, tab.rec = [], d
    tab.send("Page.startScreencast", format="jpeg", quality=88, maxWidth=W, maxHeight=H, everyNthFrame=1)
    t0 = time.time()
    for a in sc["actions"]:
        if a[0] == "wait":
            time.sleep(a[1])
        elif a[0] == "js":
            tab.js(a[1])
    length = time.time() - t0
    tab.send("Page.stopScreencast")
    time.sleep(0.3)
    tab.rec = None
    frames = list(tab.frames)
    (d / "frames.json").write_text(json.dumps({"length": length, "frames": frames}), encoding="utf-8")
    fps = len(frames) / length if length else 0
    print(f"  {sc['id']:<10} {length:5.1f} s  {len(frames):4d} frames  ~{fps:4.1f} painted fps")
    return length


def record_screen(tab, base, sc, ff, screen):
    d = WORK / sc["id"]
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True, exist_ok=True)
    goto(tab, base, sc["url"])
    time.sleep(sc["settle"])
    for a in sc.get("pre", []):
        time.sleep(a[1]) if a[0] == "wait" else tab.js(a[1])
    grab = subprocess.Popen([ff, "-y", "-loglevel", "error", "-f", "gdigrab", "-framerate", str(FPS), "-draw_mouse", "0",
                             "-offset_x", str(screen[0]), "-offset_y", str(screen[1]), "-video_size", f"{W}x{H}", "-i", "desktop",
                             "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p", "raw.mp4"],
                            cwd=d, stdin=subprocess.PIPE)
    time.sleep(0.6)                                    # grabber running before the scene's first action
    t0 = time.time()
    for a in sc["actions"]:
        if a[0] == "wait":
            time.sleep(a[1])
        elif a[0] == "js":
            tab.js(a[1])
    length = time.time() - t0
    grab.communicate(b"q", timeout=60)
    (d / "frames.json").write_text(json.dumps({"length": length, "screen": True, "lead": 0.6}), encoding="utf-8")
    print(f"  {sc['id']:<10} {length:5.1f} s")
    return length


def encode_scene(ff, sc):
    d = WORK / sc["id"]
    meta = json.loads((d / "frames.json").read_text(encoding="utf-8"))
    if meta.get("screen"):
        clip = d / "clip.mp4"
        subprocess.run([ff, "-y", "-loglevel", "error", "-ss", f"{meta['lead']:.2f}", "-i", "raw.mp4", "-t", f"{meta['length']:.3f}",
                        "-vf", f"fps={FPS},format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-an", "clip.mp4"], cwd=d, check=True)
        return clip, meta["length"]
    fr, length = meta["frames"], meta["length"]
    if not fr:
        raise SystemExit(f"scene {sc['id']}: no frames captured")
    t_first = fr[0][0]
    lines = []
    for k, (t, name) in enumerate(fr):
        nxt = fr[k + 1][0] if k + 1 < len(fr) else t_first + length
        lines += [f"file '{name}'", f"duration {max(0.001, nxt - t):.4f}"]
    lines.append(f"file '{fr[-1][1]}'")
    (d / "list.txt").write_text("\n".join(lines), encoding="utf-8")
    clip = d / "clip.mp4"
    subprocess.run([ff, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "list.txt",
                    "-vf", f"fps={FPS},scale={W}:{H}:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
                    "-t", f"{length:.3f}", "clip.mp4"], cwd=d, check=True)
    return clip, length


def join(ff, clips):
    """crossfade the scene clips into one film; returns chapter start times"""
    inputs, starts, t = [], [], 0.0
    for i, (clip, length) in enumerate(clips):
        inputs += ["-i", str(clip)]
        starts.append(round(t, 2))
        t += length - XFADE
    if len(clips) == 1:
        shutil.copy(clips[0][0], OUT)
        return starts, clips[0][1]
    chain, prev, off = [], "[0:v]", 0.0
    for i in range(1, len(clips)):
        off += clips[i - 1][1] - XFADE
        out = f"[v{i}]"
        chain.append(f"{prev}[{i}:v]xfade=transition=fade:duration={XFADE}:offset={off:.3f}{out}")
        prev = out
    OUT.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([ff, "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(chain), "-map", prev,
                    "-c:v", "libx264", "-preset", "slower", "-crf", "29", "-tune", "film", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                    "-r", str(FPS), str(OUT)], check=True)
    return starts, t + XFADE


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:5000")
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--encode-only", action="store_true")
    ap.add_argument("--screen", default="1920,0", help="top-left of the monitor to record on")
    ap.add_argument("--screencast", action="store_true", help="headless DevTools screencast instead of screen recording")
    a = ap.parse_args()
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    only = [s for s in a.only.split(",") if s]
    if not a.encode_only:
        screen = None if a.screencast else [int(v) for v in a.screen.split(",")]
        proc, tab, prof = chrome(a.headed, a.base, screen)
        try:
            if a.probe:
                goto(tab, a.base, "/#home")
                time.sleep(14)
                print("home map rAF fps:", fps_probe(tab))
                tab.js("bgMap.focus('Karakoram')")
                print("while flying:", fps_probe(tab))
                return
            print("recording:")
            for sc in SCENES:
                if not only or sc["id"] in only:
                    record_screen(tab, a.base, sc, ff, screen) if screen else record_scene(tab, a.base, sc)
            if tab.errors:
                print("page exceptions:", *sorted(set(tab.errors)), sep="\n  ")
        finally:
            proc.kill()
            time.sleep(1)
            shutil.rmtree(prof, ignore_errors=True)
    print("encoding:")
    clips = []
    for sc in SCENES:
        clip, length = encode_scene(ff, sc)
        clips.append((clip, length))
    starts, total = join(ff, clips)
    CHAPTERS.parent.mkdir(parents=True, exist_ok=True)
    CHAPTERS.write_text(json.dumps({"duration": round(total, 2), "recorded": time.strftime("%Y-%m-%d"), "chapters": [{"id": sc["id"], "title": sc["title"], "start": s}
                                                                              for sc, s in zip(SCENES, starts)]}, indent=1), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}  {total:.1f} s  {OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
