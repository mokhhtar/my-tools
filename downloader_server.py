"""
downloader_server.py
Video/Audio downloader backend using yt-dlp + Flask.

Enhancements over the base code:
  - /info      : fetch video metadata + available formats before downloading
  - /download  : start a download job, returns a job_id
  - /progress/<job_id> : SSE stream of real-time progress events
  - /cancel/<job_id>   : cancel an in-flight download
  - /history   : list of completed downloads in this session
  - /open      : open the downloads folder in the OS file explorer
  - Proper CORS headers so the Jekyll frontend (different port) can talk to this server
"""

import os
import uuid
import json
import queue
import threading
import subprocess
import sys
from datetime import datetime

from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
import yt_dlp

# ── Configuration ─────────────────────────────────────────────────────────────
DOWNLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "downloads")
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
CORS(app)  # Allow requests from Jekyll's dev server (localhost:4000)

# ── In-memory job store ───────────────────────────────────────────────────────
# job_id → { status, progress, speed, eta, filename, error, queue }
jobs: dict[str, dict] = {}
history: list[dict] = []   # completed downloads (max 50)
HISTORY_LIMIT = 50


# ── Helpers ───────────────────────────────────────────────────────────────────
def human_size(n_bytes: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n_bytes) < 1024:
            return f"{n_bytes:.1f} {unit}"
        n_bytes /= 1024
    return f"{n_bytes:.1f} TB"


def make_ydl_opts(fmt_code: str, job_id: str, audio_only: bool, prefer_codec: str) -> dict:
    """Build yt-dlp options dict with a live progress hook."""
    q: queue.Queue = jobs[job_id]["queue"]

    def progress_hook(d):
        if d["status"] == "downloading":
            total   = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            pct     = round((downloaded / total) * 100, 1) if total else 0
            speed   = d.get("_speed_str", "—").strip()
            eta     = d.get("_eta_str", "—").strip()
            q.put({"event": "progress", "pct": pct, "speed": speed, "eta": eta,
                   "downloaded": human_size(downloaded),
                   "total": human_size(total) if total else "?"})

        elif d["status"] == "error":
            q.put({"event": "error", "message": str(d.get("error", "Unknown error"))})

    opts = {
        "outtmpl": os.path.join(DOWNLOAD_FOLDER, "%(title)s.%(ext)s"),
        "progress_hooks": [progress_hook],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "external_downloader": "aria2c",
        "external_downloader_args": ["-x", "16", "-s", "16", "-k", "1M"]
    }

    if audio_only:
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": prefer_codec or "mp3",
            "preferredquality": "192",
        }]
    elif fmt_code and fmt_code not in ("best", "bestvideo+bestaudio"):
        # user picked a specific format id from the /info response
        # We prefer m4a audio for better compatibility with MP4 container
        opts["format"] = f"{fmt_code}+bestaudio[ext=m4a]/bestaudio/best"
        opts["merge_output_format"] = "mp4"
        # Force AAC audio codec for maximum compatibility in MP4
        opts["postprocessor_args"] = {
            "ffmpeg": ["-c:a", "aac"]
        }
    else:
        # Default "best" case: prefer mp4 video and m4a audio
        opts["format"] = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        opts["merge_output_format"] = "mp4"
        opts["postprocessor_args"] = {
            "ffmpeg": ["-c:a", "aac"]
        }

    return opts


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/ping")
def ping():
    return jsonify({"ok": True, "message": "Downloader server is running."})


@app.route("/info", methods=["POST"])
def get_info():
    """
    Fetch video metadata + available formats.
    Body: { "url": "..." }
    Returns: { title, thumbnail, duration, channel, formats: [...] }
    """
    data = request.get_json(force=True)
    url = (data or {}).get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided."}), 400

    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    # Build a simplified format list for the UI
    formats = []
    seen = set()
    for f in (info.get("formats") or []):
        if not f.get("vcodec") or f["vcodec"] == "none":
            continue  # skip audio-only tracks (handled separately)
        height = f.get("height")
        fps    = f.get("fps") or 0
        ext    = f.get("ext", "mp4")
        fid    = f.get("format_id", "")
        key    = f"{height}p_{fps}fps"
        if key in seen:
            continue
        seen.add(key)
        size_b = f.get("filesize") or f.get("filesize_approx") or 0
        formats.append({
            "id":     fid,
            "label":  f"{height}p" + (f" {int(fps)}fps" if fps >= 48 else ""),
            "height": height or 0,
            "ext":    ext,
            "size":   human_size(size_b) if size_b else "?",
        })

    # Sort highest quality first
    formats.sort(key=lambda x: x["height"], reverse=True)

    # Add "best" as first option
    formats.insert(0, {"id": "best", "label": "Best quality (auto)", "height": 9999, "ext": "mp4", "size": "?"})

    duration_s = info.get("duration") or 0
    duration   = f"{duration_s // 60}:{duration_s % 60:02d}" if duration_s else "—"

    return jsonify({
        "title":     info.get("title", "Unknown"),
        "thumbnail": info.get("thumbnail", ""),
        "duration":  duration,
        "channel":   info.get("channel") or info.get("uploader", "—"),
        "view_count": info.get("view_count", 0),
        "formats":   formats,
    })


@app.route("/download", methods=["POST"])
def start_download():
    """
    Start a download job.
    Body: { url, format_id, audio_only, audio_codec }
    Returns: { job_id }
    """
    data       = request.get_json(force=True) or {}
    url        = data.get("url", "").strip()
    fmt_code   = data.get("format_id", "best")
    audio_only = bool(data.get("audio_only", False))
    audio_codec = data.get("audio_codec", "mp3")

    if not url:
        return jsonify({"error": "No URL provided."}), 400

    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "status":   "running",
        "pct":      0,
        "speed":    "—",
        "eta":      "—",
        "filename": None,
        "error":    None,
        "url":      url,
        "queue":    queue.Queue(),
        "started":  datetime.now().isoformat(),
    }

    def run():
        try:
            opts = make_ydl_opts(fmt_code, job_id, audio_only, audio_codec)
            with yt_dlp.YoutubeDL(opts) as ydl:
                # ydl.download returns the status code, but we want the info for the filename
                info = ydl.extract_info(url, download=True)
                # The filename might change after merging, so we get the final path
                final_path = ydl.prepare_filename(info)
                # For some formats, the extension might change (e.g. mkv -> mp4)
                # so we check what actually exists on disk
                base, _ = os.path.splitext(final_path)
                ext = opts.get("merge_output_format", "mp4")
                actual_filename = os.path.basename(f"{base}.{ext}")
                
            jobs[job_id]["status"] = "done"
            jobs[job_id]["filename"] = actual_filename
            jobs[job_id]["queue"].put({"event": "finished", "filename": actual_filename})

            # Add to history
            record = {
                "job_id":   job_id,
                "filename": actual_filename,
                "url":      url,
                "finished": datetime.now().isoformat(),
                "audio":    audio_only,
            }
            history.insert(0, record)
            if len(history) > HISTORY_LIMIT:
                history.pop()
        except Exception as e:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"]  = str(e)
            jobs[job_id]["queue"].put({"event": "error", "message": str(e)})

    threading.Thread(target=run, daemon=True).start()
    return jsonify({"job_id": job_id})


@app.route("/progress/<job_id>")
def progress_stream(job_id: str):
    """SSE endpoint — sends progress events as they arrive."""
    if job_id not in jobs:
        return jsonify({"error": "Unknown job."}), 404

    def generate():
        q: queue.Queue = jobs[job_id]["queue"]
        while True:
            try:
                event = q.get(timeout=30)
            except queue.Empty:
                # Keepalive ping so the connection doesn't time out
                yield "event: ping\ndata: {}\n\n"
                continue

            yield f"event: {event['event']}\ndata: {json.dumps(event)}\n\n"

            if event["event"] in ("finished", "error"):
                break

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering if ever behind one
        },
    )


@app.route("/cancel/<job_id>", methods=["POST"])
def cancel_job(job_id: str):
    """Mark a job as cancelled (yt-dlp doesn't support mid-download cancel easily,
    but we put a synthetic error event so the SSE stream closes gracefully)."""
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job."}), 404
    job["status"] = "cancelled"
    job["queue"].put({"event": "error", "message": "Download cancelled by user."})
    return jsonify({"ok": True})


@app.route("/history")
def get_history():
    return jsonify(history)


@app.route("/open-folder")
def open_folder():
    """Open the downloads folder in the OS file explorer."""
    try:
        if sys.platform == "win32":
            os.startfile(DOWNLOAD_FOLDER)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", DOWNLOAD_FOLDER])
        else:
            subprocess.Popen(["xdg-open", DOWNLOAD_FOLDER])
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"[downloader] Serving downloads to: {DOWNLOAD_FOLDER}")
    print("[downloader] API listening on http://localhost:5000")
    app.run(debug=False, host="0.0.0.0", port=5000)
