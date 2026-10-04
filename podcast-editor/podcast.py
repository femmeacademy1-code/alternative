#!/usr/bin/env python3
"""עורך פודקאסט רב-זוויות: סנכרון, תמלול, בחירת זוויות, הסרת קטעים וצריבת כתוביות.

שלבים:  sync -> transcribe -> shots -> render
קבצים שאפשר לערוך ידנית (בתיקייה הזו):  cuts.txt, shots.txt, subtitles.srt
כל הזמנים בקבצים האלה הם בציר הזמן של ההקלטה המסונכרנת המלאה (לפני הסרת קטעים).
"""
import argparse
import hashlib
import json
import random
import re
import subprocess
import sys
import tomllib
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "work"
SR = 8000          # קצב דגימה לניתוח סנכרון ועוצמות
FADE = 0.015       # שניות של פייד בנקודות חיתוך באודיו


# ---------------------------------------------------------------- כלי עזר
def die(msg):
    sys.exit(f"שגיאה: {msg}")


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, **kw)
    if r.returncode:
        err = r.stderr.decode(errors="replace")[-1500:] if r.stderr else ""
        die(f"הפקודה נכשלה: {' '.join(map(str, cmd[:6]))} ...\n{err}")
    return r


def probe(path):
    r = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format",
             "-show_streams", str(path)])
    info = json.loads(r.stdout)
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    return {
        "duration": float(info["format"]["duration"]),
        "fps": Fraction(v["r_frame_rate"]) if v else None,
    }


def parse_ts(s):
    s = s.strip().replace(",", ".")
    parts = s.split(":")
    if not 1 <= len(parts) <= 3:
        raise ValueError(s)
    t = 0.0
    for p in parts:
        t = t * 60 + float(p)
    return t


def fmt_ts(t, sep="."):
    t = max(t, 0)
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


class Project:
    def __init__(self, cfg_path):
        self.cfg_path = Path(cfg_path).resolve()
        self.dir = self.cfg_path.parent
        with open(self.cfg_path, "rb") as f:
            self.cfg = tomllib.load(f)
        inp = self.cfg["input"]
        self.cams = [("cam%d" % (i + 1), self.dir / p) for i, p in enumerate(inp["cams"])]
        self.external = inp.get("external_audio") or ""
        self.sources = list(self.cams)
        if self.external:
            self.sources.append(("external", self.dir / self.external))
        for n, p in self.sources:
            if not p.exists():
                die(f"הקובץ {p} לא נמצא ({n})")
        self.audio_source = inp.get("audio_source", "cam1")
        if self.audio_source not in dict(self.sources):
            die(f"audio_source={self.audio_source} לא קיים")

    def path(self, name):
        return self.dir / name

    def sync(self):
        f = WORK / "sync.json"
        if not f.exists():
            die("לא נמצא work/sync.json. הרץ קודם: python podcast.py sync")
        return json.loads(f.read_text())

    def fps(self):
        v = self.cfg["output"].get("fps", "auto")
        if v == "auto":
            return probe(self.cams[0][1])["fps"]
        return Fraction(str(v))


def load_audio(path, sr=SR):
    cache = WORK / f"a{sr}_{Path(path).stem}_{int(Path(path).stat().st_mtime)}.npy"
    if cache.exists():
        return np.load(cache)
    r = run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sr),
             "-f", "f32le", "-"])
    a = np.frombuffer(r.stdout, dtype=np.float32).copy()
    np.save(cache, a)
    return a


# ---------------------------------------------------------------- סנכרון
def gcc_phat(a, b, max_shift):
    """b מאוחר ביחס ל-a ב-D דגימות -> מחזיר D (חיובי כש-b מאוחר)."""
    n = 1 << int(np.ceil(np.log2(len(a) + len(b))))
    A, B = np.fft.rfft(a, n), np.fft.rfft(b, n)
    R = B * np.conj(A)
    R /= np.abs(R) + 1e-9
    cc = np.fft.irfft(R, n)
    cc = np.concatenate((cc[-max_shift:], cc[:max_shift + 1]))
    return int(np.argmax(cc)) - max_shift


def cmd_sync(P, args):
    WORK.mkdir(exist_ok=True)
    names = [n for n, _ in P.sources]
    audio = {n: load_audio(p) for n, p in P.sources}
    durs = {n: probe(p)["duration"] for n, p in P.sources}
    ref = names[0]
    D = {ref: 0.0}
    drift = {ref: 0.0}
    for n in names[1:]:
        a, b = audio[ref], audio[n]
        w = min(300 * SR, len(a), len(b))
        d0 = gcc_phat(a[:w], b[:w], min(150 * SR, w - 1)) / SR
        est = []
        L = 60 * SR
        span = min(len(a), len(b)) - L - abs(int(d0 * SR)) - 5 * SR
        points = [0.1, 0.5, 0.9] if span > L else []
        for p in points:
            t0 = int(p * span)
            bs = t0 + int(round(d0 * SR))
            if bs < 0 or bs + L > len(b):
                continue
            r = gcc_phat(a[t0:t0 + L], b[bs:bs + L], 2 * SR) / SR
            est.append(d0 + r)
        D[n] = float(np.median(est)) if est else d0
        drift[n] = (max(est) - min(est)) if est else 0.0
        print(f"{n}: הפרש {D[n]:+.3f}s ביחס ל-{ref}, סחיפה לאורך ההקלטה {drift[n] * 1000:.0f}ms")
        if drift[n] > 0.04:
            print(f"  אזהרה: יש סחיפה של {drift[n] * 1000:.0f}ms ב-{n}. "
                  "ייתכן חוסר סנכרון קל בסוף ההקלטה (בדוק בתצוגה מקדימה).")
    base = min(D.values())
    offsets = {n: D[n] - base for n in names}
    duration = min(durs[n] - offsets[n] for n in names) - 0.2
    out = {"offsets": offsets, "duration": duration, "drift": drift}
    (WORK / "sync.json").write_text(json.dumps(out, indent=2))
    print(f"אורך ההקלטה המסונכרנת: {fmt_ts(duration)}")
    print("נשמר ב-work/sync.json")


# ---------------------------------------------------------------- כתוביות
def read_srt(path):
    text = Path(path).read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    cues = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.split("\n")
        i = next((k for k, l in enumerate(lines) if "-->" in l), None)
        if i is None:
            continue
        a, b = [x.strip() for x in lines[i].split("-->")]
        cues.append((parse_ts(a), parse_ts(b.split()[0]), "\n".join(lines[i + 1:]).strip()))
    return cues


def write_srt(path, cues):
    with open(path, "w", encoding="utf-8") as f:
        for i, (s, e, t) in enumerate(cues, 1):
            f.write(f"{i}\n{fmt_ts(s, ',')} --> {fmt_ts(e, ',')}\n{t}\n\n")


def words_to_cues(words, max_chars, max_dur):
    cues, cur = [], []

    def flush():
        if not cur:
            return
        text = " ".join(w[2] for w in cur)
        if len(text) > max_chars:  # פיצול לשתי שורות קרוב לאמצע
            mid, best = len(text) // 2, None
            for m in re.finditer(" ", text):
                if best is None or abs(m.start() - mid) < abs(best - mid):
                    best = m.start()
            if best:
                text = text[:best] + "\n" + text[best + 1:]
        cues.append((cur[0][0], cur[-1][1], text))
        cur.clear()

    for w in words:
        if cur:
            chars = sum(len(x[2]) + 1 for x in cur) + len(w[2])
            gap = w[0] - cur[-1][1]
            if (chars > max_chars * 2 or w[1] - cur[0][0] > max_dur or gap > 0.8
                    or (re.search(r"[.?!]$", cur[-1][2]) and chars > max_chars * 0.8)):
                flush()
        cur.append(w)
    flush()
    return cues


def cmd_transcribe(P, args):
    srt = P.path("subtitles.srt")
    if srt.exists() and not args.force:
        die("subtitles.srt כבר קיים (ייתכן שערכת אותו). להחלפה הוסף --force")
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        die("חסרה החבילה faster-whisper. התקן: pip install faster-whisper")
    sync = P.sync()
    sc = P.cfg["subtitles"]
    wav = WORK / "master16k.wav"
    off = sync["offsets"][P.audio_source]
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{off:.6f}", "-i",
         str(dict(P.sources)[P.audio_source]), "-t", f"{sync['duration']:.3f}",
         "-vn", "-ac", "1", "-ar", "16000", str(wav)])
    print("טוען מודל (בהרצה הראשונה יורד מהרשת)...")
    model = WhisperModel(sc.get("model", "large-v3"), device=sc.get("device", "auto"),
                         compute_type=sc.get("compute_type", "auto"))
    segments, info = model.transcribe(
        str(wav), language=sc.get("language", "he"), word_timestamps=True,
        vad_filter=True, condition_on_previous_text=False,
        initial_prompt=sc.get("initial_prompt") or None)
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append((w.start, w.end, w.word.strip()))
        print(f"\r{fmt_ts(seg.end)} / {fmt_ts(sync['duration'])}", end="", flush=True)
    print()
    cues = words_to_cues(words, sc.get("max_chars_per_line", 32), sc.get("max_cue_seconds", 5.5))
    write_srt(srt, cues)
    print(f"נוצר {srt.name} עם {len(cues)} כתוביות. פתח וערוך טקסט אם צריך.")


def cmd_find(P, args):
    q = args.text
    for s, e, t in read_srt(P.path("subtitles.srt")):
        if q in t.replace("\n", " "):
            print(f"{fmt_ts(s)} --> {fmt_ts(e)}  {t.replace(chr(10), ' ')}")


# ---------------------------------------------------------------- חיתוכים
CUTS_HEADER = """# קטעים להסרה. שורה לכל קטע:  התחלה סוף  הערה
# זמנים בפורמט דקות:שניות (12:30) או שעות:דקות:שניות (1:02:30.5) או שניות (750.5)
# שורה שמתחילה ב-# מתעלמת. דוגמה:
# 12:30 13:10 קטע שלא רוצים
"""


def read_cuts(P, duration):
    f = P.path("cuts.txt")
    cuts = []
    if f.exists():
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            line = line.split("#")[0].strip()
            if not line:
                continue
            toks = [t for t in line.split() if t not in ("-", "–", "—", "עד")]
            try:
                s, e = parse_ts(toks[0]), parse_ts(toks[1])
            except (ValueError, IndexError):
                die(f"cuts.txt שורה {n}: לא הצלחתי לקרוא '{line}'")
            if e <= s:
                die(f"cuts.txt שורה {n}: הסוף חייב להיות אחרי ההתחלה")
            cuts.append((max(s, 0), min(e, duration)))
    cuts.sort()
    merged = []
    for s, e in cuts:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(e, merged[-1][1]))
        else:
            merged.append((s, e))
    return merged


def cmd_cut(P, args):
    f = P.path("cuts.txt")
    if not f.exists():
        f.write_text(CUTS_HEADER, encoding="utf-8")
    parse_ts(args.start), parse_ts(args.end)
    with open(f, "a", encoding="utf-8") as fh:
        fh.write(f"{args.start} {args.end} {args.note}\n")
    print("נוסף ל-cuts.txt")


# ---------------------------------------------------------------- בחירת זוויות
def cam_index(tok, n):
    m = re.fullmatch(r"(?:cam)?(\d+)", tok.lower())
    if not m or not 1 <= int(m.group(1)) <= n:
        raise ValueError(tok)
    return int(m.group(1)) - 1


def cmd_shots(P, args):
    f = P.path("shots.txt")
    if f.exists() and not args.force:
        die("shots.txt כבר קיים (ייתכן שערכת אותו). להחלפה הוסף --force")
    sync = P.sync()
    sc = P.cfg["shots"]
    n = len(P.cams)
    wide = sc.get("wide_cam", 1) - 1
    min_shot, max_shot = sc.get("min_shot", 3.0), sc.get("max_shot", 20.0)
    dur = sync["duration"]
    shots = [(0.0, wide)]
    if sc.get("mode", "audio") == "rotate":
        rng = random.Random(1)
        t, cur = 0.0, wide
        while True:
            t += rng.uniform(min_shot * 1.5, max_shot * 0.6)
            if t >= dur:
                break
            cur = rng.choice([c for c in range(n) if c != cur])
            shots.append((t, cur))
    else:
        win = 0.5
        lv = []
        for name, p in P.cams:
            a = load_audio(p)
            o = int(sync["offsets"][name] * SR)
            nw = int(dur / win)
            seg = a[o:o + int(nw * win * SR)]
            seg = seg[:len(seg) // int(win * SR) * int(win * SR)].reshape(-1, int(win * SR))
            lv.append(20 * np.log10(np.sqrt((seg ** 2).mean(axis=1)) + 1e-5))
        m = min(len(x) for x in lv)
        lv = np.array([x[:m] for x in lv])
        srt = np.sort(lv, axis=0)
        clear = float(np.mean(srt[-1] - srt[-2] > sc.get("margin_db", 4.0)))
        print(f"בכמה אחוז מהזמן יש דובר ברור לפי עוצמה: {clear * 100:.0f}%")
        if clear < 0.2:
            print("  אזהרה: העוצמות דומות בין המצלמות (כנראה מיקרופון משותף). "
                  "בחירה לפי אודיו לא תהיה מדויקת. שקול mode=\"rotate\" או עריכת shots.txt ידנית.")
        cur, last, cand, cand_t = wide, 0.0, None, 0.0
        margin, react = sc.get("margin_db", 4.0), sc.get("reaction", 0.8)
        for w in range(m):
            t = w * win
            best = int(np.argmax(lv[:, w]))
            if t - last >= max_shot and cur != wide:
                cur, last, cand = wide, t, None
                shots.append((t, cur))
                continue
            if best != cur and lv[best, w] - lv[cur, w] >= margin:
                if cand != best:
                    cand, cand_t = best, t
                if t - cand_t >= react and t - last >= min_shot:
                    ts = max(cand_t, last + min_shot)
                    cur, last, cand = best, ts, None
                    shots.append((ts, cur))
            else:
                cand = None
    with open(f, "w", encoding="utf-8") as fh:
        fh.write("# שורה לכל מעבר זווית:  זמן  מצלמה (cam1/cam2/cam3).  ערוך חופשי.\n"
                 "# הזווית נשארת עד השורה הבאה.\n")
        for t, c in shots:
            fh.write(f"{fmt_ts(t)} cam{c + 1}\n")
    print(f"נוצרו {len(shots)} שוטים ב-shots.txt")


def read_shots(P, n, wide):
    f = P.path("shots.txt")
    shots = []
    if f.exists():
        for k, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            line = line.split("#")[0].strip()
            if not line:
                continue
            try:
                t, c = line.split()[:2]
                shots.append((parse_ts(t), cam_index(c, n)))
            except (ValueError, IndexError):
                die(f"shots.txt שורה {k}: לא הצלחתי לקרוא '{line}'")
    shots.sort()
    if not shots or shots[0][0] > 0:
        shots.insert(0, (0.0, wide))
    return shots


# ---------------------------------------------------------------- רינדור
def cmd_render(P, args):
    sync = P.sync()
    oc = P.cfg["output"]
    n = len(P.cams)
    fps = P.fps()
    W, H = oc.get("width", 1920), oc.get("height", 1080)
    crf, preset = oc.get("crf", 18), oc.get("preset", "medium")
    if args.preview:
        W, H, crf, preset = 960, 540, 30, "ultrafast"
    W, H = W // 2 * 2, H // 2 * 2
    dur = sync["duration"]
    total_frames = int(dur * fps)

    # טווחי שימור וגזירה, בפריימים שלמים (כדי שלא יצטבר סחף בין קטעים)
    cuts = read_cuts(P, dur)
    keeps, pos = [], 0
    for s, e in cuts:
        fs, fe = round(s * fps), round(e * fps)
        if fs > pos:
            keeps.append((pos, fs))
        pos = max(pos, fe)
    if pos < total_frames:
        keeps.append((pos, total_frames))
    if not keeps:
        die("כל ההקלטה הוסרה")

    shots = read_shots(P, n, P.cfg["shots"].get("wide_cam", 1) - 1)
    bounds = [(round(t * fps), c) for t, c in shots] + [(total_frames, None)]
    segs = []  # (cam, frame_start, frame_end)
    for ks, ke in keeps:
        for (bs, c), (be, _) in zip(bounds, bounds[1:]):
            s, e = max(ks, bs), min(ke, be)
            if e > s:
                segs.append((c, s, e))
    out_frames = sum(e - s for _, s, e in segs)
    print(f"{len(cuts)} קטעים הוסרו, {len(segs)} שוטים, אורך סופי {fmt_ts(out_frames / fps)}")

    segdir = WORK / ("segs_preview" if args.preview else "segs")
    segdir.mkdir(parents=True, exist_ok=True)
    vf = (f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
          f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p")

    def seg_file(c, s, e):
        name, path = P.cams[c]
        key = f"{path}|{int(path.stat().st_mtime)}|{sync['offsets'][name]:.6f}|{s}|{e}|{vf}|{crf}|{preset}"
        return segdir / (hashlib.sha1(key.encode()).hexdigest()[:16] + ".mp4")

    def render_seg(item):
        c, s, e = item
        out = seg_file(c, s, e)
        if out.exists():
            return
        name, path = P.cams[c]
        ss = sync["offsets"][name] + s / fps
        tmp = out.with_suffix(".tmp.mp4")
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{ss:.6f}", "-i", str(path),
             "-frames:v", str(e - s), "-an", "-vf", vf, "-c:v", "libx264",
             "-preset", preset, "-crf", str(crf), "-g", "60", str(tmp)])
        tmp.rename(out)

    todo = [x for x in segs if not seg_file(*x).exists()]
    print(f"מרנדר {len(todo)} קטעים חדשים (מתוך {len(segs)}, השאר נלקחים מהמטמון)...")
    done = 0
    with ThreadPoolExecutor(max_workers=oc.get("jobs", 4)) as ex:
        for _ in ex.map(render_seg, todo):
            done += 1
            print(f"\r{done}/{len(todo)}", end="", flush=True)
    print()

    (WORK / "list.txt").write_text(
        "".join(f"file '{seg_file(*x).as_posix()}'\n" for x in segs))

    # אודיו: טווחי השימור בלבד, עם פייד קצר בנקודות חיתוך
    src = P.audio_source
    off = sync["offsets"][src]
    parts, labels = [], []
    for i, (s, e) in enumerate(keeps):
        ss, ee, d = s / fps + off, e / fps + off, (e - s) / fps
        f = f"[0:a]atrim=start={ss:.6f}:end={ee:.6f},asetpts=PTS-STARTPTS"
        if i > 0:
            f += f",afade=t=in:d={FADE}"
        if i < len(keeps) - 1:
            f += f",afade=t=out:st={d - FADE:.6f}:d={FADE}"
        parts.append(f + f"[a{i}]")
        labels.append(f"[a{i}]")
    chain = ";".join(parts) + f";{''.join(labels)}concat=n={len(keeps)}:v=0:a=1[ac]"
    chain += ";[ac]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]" if oc.get("loudnorm", True) \
        else ";[ac]aresample=48000[aout]"
    (WORK / "audio_filter.txt").write_text(chain)
    audio_out = WORK / ("audio_preview.m4a" if args.preview else "audio.m4a")
    print("מעבד אודיו...")
    run(["ffmpeg", "-y", "-v", "error", "-i", str(dict(P.sources)[src]),
         "-filter_complex_script", str(WORK / "audio_filter.txt"), "-map", "[aout]",
         "-c:a", "aac", "-b:a", "192k", str(audio_out)])

    # כתוביות: הזזה לפי החיתוכים
    sc = P.cfg["subtitles"]
    srt_in = P.path("subtitles.srt")
    use_subs = sc.get("enabled", True) and srt_in.exists() and not args.no_subs
    if sc.get("enabled", True) and not srt_in.exists():
        print("אין subtitles.srt - מרנדר בלי כתוביות (הרץ transcribe)")
    outfile = P.path("out/preview.mp4" if args.preview else oc.get("file", "out/podcast.mp4"))
    outfile.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "list.txt",
           "-i", str(audio_out), "-map", "0:v", "-map", "1:a"]
    if use_subs:
        starts, acc = [], 0
        for s, e in keeps:
            starts.append((s / fps, e / fps, acc))
            acc += (e - s) / fps
        new = []
        for cs, ce, text in read_srt(srt_in):
            def mp(t):
                for ks, ke, a in starts:
                    if t < ks:
                        return a
                    if t <= ke:
                        return a + t - ks
                return acc
            ns, ne = mp(cs), mp(ce)
            if ne - ns >= 0.15:
                new.append((ns, ne, text))
        write_srt(WORK / "subs_final.srt", new)
        write_srt(outfile.with_suffix(".srt"), new)
        style = (f"FontName={sc.get('font', 'Arial')},FontSize={sc.get('font_size', 18)},"
                 f"Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,"
                 f"Outline=2,Shadow=0,Alignment=2,MarginV={sc.get('margin_bottom', 20)}")
        cmd += ["-vf", f"subtitles=subs_final.srt:force_style='{style}'",
                "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p"]
    else:
        cmd += ["-c:v", "copy"]
    cmd += ["-c:a", "copy", "-movflags", "+faststart", str(outfile)]
    print("מרכיב קובץ סופי...")
    run(cmd, cwd=WORK)
    print(f"מוכן: {outfile}")


# ---------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(ROOT / "config.toml"))
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("sync", help="סנכרון שלוש הזוויות לפי האודיו")
    t = sp.add_parser("transcribe", help="תמלול וכתוביות")
    t.add_argument("--force", action="store_true")
    s = sp.add_parser("shots", help="יצירת תכנית מעברי זוויות")
    s.add_argument("--force", action="store_true")
    r = sp.add_parser("render", help="רינדור")
    r.add_argument("--preview", action="store_true", help="תצוגה מקדימה מהירה ברזולוציה נמוכה")
    r.add_argument("--no-subs", action="store_true")
    f = sp.add_parser("find", help="חיפוש טקסט בכתוביות והדפסת זמנים")
    f.add_argument("text")
    c = sp.add_parser("cut", help="הוספת קטע להסרה ל-cuts.txt")
    c.add_argument("start")
    c.add_argument("end")
    c.add_argument("note", nargs="?", default="")
    args = ap.parse_args()
    global WORK
    P = Project(args.config)
    WORK = P.dir / "work"
    WORK.mkdir(exist_ok=True)
    {"sync": cmd_sync, "transcribe": cmd_transcribe, "shots": cmd_shots,
     "render": cmd_render, "find": cmd_find, "cut": cmd_cut}[args.cmd](P, args)


if __name__ == "__main__":
    main()
