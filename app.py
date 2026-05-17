"""
app.py — HairViz AI Backend
Flask server that:
  1. Accepts a portrait photo + hairstyle selection
  2. Generates a CPU-based hair mask (MediaPipe)
  3. Sends both to HuggingFace Inpainting API
  4. Returns original, mask, and result as base64 JSON

Endpoints:
  GET  /health                 → server status
  GET  /api/hairstyles         → full style catalogue
  POST /api/visualize          → main generation (multipart/form-data)
  POST /api/mask-preview       → preview hair mask only (fast, no AI)
"""

import base64
import io
import os
import uuid

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image

from ai_client import AIError, HuggingFaceClient
from hairstyles import HAIRSTYLES, all_style_ids, get_prompt
from masker import MaskError, generate_hair_mask, overlay_mask_on_image

# ── Bootstrap ──────────────────────────────────────────────────────
load_dotenv()

app = Flask(__name__)

# CORS: allow both localhost (dev) and the GitHub Pages domain (prod).
# Add your GitHub Pages URL here when you deploy.
ALLOWED_ORIGINS = [
    "http://localhost:4000",            # Jekyll dev server
    "http://localhost:5500",            # VS Code Live Server
    "http://127.0.0.1:5500",
    "https://mokhhtar.github.io",       # ← your GitHub Pages (change if needed)
    "*",                                # remove this in production!
]
CORS(app, origins=ALLOWED_ORIGINS, supports_credentials=True)

# ── Config ─────────────────────────────────────────────────────────
HF_TOKEN          = os.getenv("HF_TOKEN", "")
PORT              = int(os.getenv("PORT", 5001))
DEBUG             = os.getenv("DEBUG", "true").lower() == "true"
MAX_UPLOAD_BYTES  = 15 * 1024 * 1024   # 15 MB
INPAINT_SIZE      = (512, 512)          # SD works best at this resolution
ALLOWED_MIMETYPES = {"image/jpeg", "image/png", "image/webp"}

# Initialise AI client (will raise if token missing and we try to use it)
_ai: HuggingFaceClient | None = None
if HF_TOKEN:
    try:
        _ai = HuggingFaceClient(token=HF_TOKEN)
    except AIError as e:
        print(f"  [WARN] Cannot initialise AI client: {e}")

VALID_STYLE_IDS = all_style_ids()


# ── Helpers ────────────────────────────────────────────────────────
def _pil_to_b64(img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _load_image_from_request(field: str = "image") -> Image.Image:
    """
    Load and validate an uploaded image file.
    Raises ValueError with a user-friendly message on any problem.
    """
    if field not in request.files:
        raise ValueError(f"No '{field}' file in request.")

    file = request.files[field]
    if file.filename == "":
        raise ValueError("No file selected.")

    # Check MIME type
    if file.mimetype not in ALLOWED_MIMETYPES:
        raise ValueError(
            f"Unsupported file type: {file.mimetype}. "
            "Please upload a JPEG, PNG, or WebP image."
        )

    raw = file.read()

    # Size check
    if len(raw) > MAX_UPLOAD_BYTES:
        mb = len(raw) / 1_048_576
        raise ValueError(
            f"Image is too large ({mb:.1f} MB). "
            "The frontend should have resized it — please refresh and try again."
        )

    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise ValueError(f"Cannot open image: {exc}") from exc

    return img


def _resize_for_inpainting(img: Image.Image, mask: Image.Image) -> tuple[Image.Image, Image.Image]:
    """
    Resize both image and mask to INPAINT_SIZE (512×512).
    Preserves aspect ratio with padding (black) so SD sees a square.
    """
    w, h = img.size
    target_w, target_h = INPAINT_SIZE

    scale = min(target_w / w, target_h / h)
    new_w, new_h = int(w * scale), int(h * scale)

    # Resize proportionally
    img_r  = img.resize((new_w, new_h), Image.LANCZOS)
    mask_r = mask.resize((new_w, new_h), Image.LANCZOS)

    # Pad to square
    def pad(src: Image.Image, mode: str = "RGB", bg: tuple = (0, 0, 0)) -> Image.Image:
        canvas = Image.new(mode, INPAINT_SIZE, bg)
        offset_x = (target_w - new_w) // 2
        offset_y = (target_h - new_h) // 2
        canvas.paste(src, (offset_x, offset_y))
        return canvas

    return pad(img_r, "RGB", (0, 0, 0)), pad(mask_r, "L", 0)


# ── Routes ─────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status":        "ok",
        "tool":          "HairViz AI",
        "version":       "1.0.0",
        "hf_token_set":  bool(HF_TOKEN),
        "ai_ready":      _ai is not None,
    })


@app.route("/api/hairstyles", methods=["GET"])
def get_hairstyles():
    """Return the full style catalogue for the frontend to render."""
    return jsonify(HAIRSTYLES)


@app.route("/api/mask-preview", methods=["POST"])
def mask_preview():
    """
    Generate and return the hair mask WITHOUT running the AI.
    Fast (CPU only, ~1-2 seconds). Useful for debugging bad photos.
    Accepts: multipart/form-data with field 'image'.
    Returns:  JSON { original: b64, mask: b64, overlay: b64 }
    """
    try:
        img = _load_image_from_request("image")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        mask = generate_hair_mask(img)
    except MaskError as e:
        return jsonify({"error": str(e)}), 422

    overlay = overlay_mask_on_image(img, mask)

    return jsonify({
        "original": _pil_to_b64(img),
        "mask":     _pil_to_b64(mask.convert("RGB")),
        "overlay":  _pil_to_b64(overlay.convert("RGB")),
    })


@app.route("/api/visualize", methods=["POST"])
def visualize():
    """
    Main endpoint: upload portrait → get AI-generated result.

    Accepts: multipart/form-data
      - image       (file)     required
      - style_id    (string)   required unless custom_prompt is set
      - custom_prompt (string) optional override

    Returns: JSON {
        job_id, original, mask, overlay, result,
        prompt, style_id, original_size
    }
    """

    # ── 1. Parse inputs ──────────────────────────────────────────
    try:
        img = _load_image_from_request("image")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    style_id      = (request.form.get("style_id") or "").strip()
    custom_prompt = (request.form.get("custom_prompt") or "").strip()

    if not style_id and not custom_prompt:
        return jsonify({"error": "Provide either style_id or custom_prompt."}), 400

    if style_id and style_id not in VALID_STYLE_IDS:
        return jsonify({
            "error": f"Unknown style_id: '{style_id}'. "
                     f"Valid IDs: {sorted(VALID_STYLE_IDS)}"
        }), 400

    # ── 2. Build prompt ──────────────────────────────────────────
    if style_id:
        prompt, neg_prompt = get_prompt(style_id)
    else:
        prompt     = (
            f"realistic portrait photo, same person, same face preserved, "
            f"{custom_prompt}, photorealistic, 8k"
        )
        neg_prompt = (
            "blurry, cartoon, anime, painting, distorted face, "
            "different person, low quality, ugly"
        )

    # ── 3. Generate hair mask (CPU) ──────────────────────────────
    try:
        mask = generate_hair_mask(img)
    except MaskError as e:
        return jsonify({"error": str(e)}), 422

    # ── 4. Prepare overlay for debugging ────────────────────────
    overlay = overlay_mask_on_image(img, mask)
    original_size = img.size  # (W, H) before resize

    # ── 5. Resize to 512×512 for SD ─────────────────────────────
    img_sq, mask_sq = _resize_for_inpainting(img, mask)

    # ── 6. Call AI ───────────────────────────────────────────────
    if _ai is None:
        return jsonify({
            "error": "AI client is not initialised. "
                     "Set HF_TOKEN in your .env file and restart the server."
        }), 503

    try:
        result_sq = _ai.inpaint(img_sq, mask_sq, prompt, neg_prompt)
    except AIError as e:
        return jsonify({"error": f"AI error: {str(e)}"}), 503

    # ── 7. Respond ───────────────────────────────────────────────
    job_id = str(uuid.uuid4())[:8]

    return jsonify({
        "job_id":        job_id,
        "style_id":      style_id or None,
        "prompt":        prompt,
        "original_size": original_size,
        # Images as base64 PNG strings
        "original":      _pil_to_b64(img),
        "mask":          _pil_to_b64(mask.convert("RGB")),
        "overlay":       _pil_to_b64(overlay.convert("RGB")),
        "result":        _pil_to_b64(result_sq),
    })


# ── Entry point ────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n  +------------------------------------------+")
    print(f"  |  HairViz AI Backend -- port {PORT}          |")
    print("  +------------------------------------------+\n")
    print(f"  HF Token : {'[OK] set' if HF_TOKEN else '[!!] NOT SET -- add to .env!'}")
    print(f"  AI Client: {'[OK] ready' if _ai else '[!!] not initialised'}\n")
    print(f"  POST http://localhost:{PORT}/api/visualize")
    print(f"  POST http://localhost:{PORT}/api/mask-preview")
    print(f"  GET  http://localhost:{PORT}/health\n")
    app.run(host="0.0.0.0", port=PORT, debug=DEBUG)