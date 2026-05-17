"""
masker.py
Hair region mask generation — runs entirely on CPU.

Strategy (two complementary methods):
  Method A (preferred): MediaPipe Face Mesh (478 landmarks)
    → Uses forehead/hairline landmarks to define a precise polygon mask.

  Method B (fallback): MediaPipe Face Detection + Selfie Segmentation
    → Uses the face bounding box and person segmentation for a robust
       approximate mask when Face Mesh fails (sunglasses, angle, etc.).

Output: a binary PIL Image (mode 'L'):
  WHITE (255) = hair region  →  AI will regenerate this area
  BLACK  (0)  = keep intact  →  face, background, clothes preserved
"""

import cv2
import mediapipe as mp
import numpy as np
from PIL import Image


class MaskError(Exception):
    """Raised when we cannot produce a valid mask."""


# ── MediaPipe Face Mesh hairline landmark indices ────────────────
# These 36 points trace the outer silhouette of the face/head in order.
# The top portion (indices 0–10 in this list) define the hairline.
FACE_OVAL_IDS = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323,
    361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
    176, 149, 150, 136, 172,  58, 132,  93, 234, 127,
    162,  21,  54, 103,  67, 109,
]

# The "top half" of the oval (from left-side of head → forehead → right-side)
# We use these to clip the hair region at roughly eye level.
HAIRLINE_IDS = [
    10, 338, 297, 332, 284, 251, 389, 356, 454,  # right side → top → left side
    323, 361, 288, 397, 365, 379, 378, 400,       # continuing down left
    234, 127, 162,  21,  54, 103,  67, 109,        # up right side back to top
]


def _to_cv2(pil_img: Image.Image) -> np.ndarray:
    """PIL RGB → OpenCV BGR uint8."""
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def _to_pil_gray(arr: np.ndarray) -> Image.Image:
    """Single-channel uint8 array → PIL 'L' image."""
    return Image.fromarray(arr.astype(np.uint8), mode='L')


def _smooth_mask(mask: np.ndarray, ksize: int = 21) -> np.ndarray:
    """Apply Gaussian blur + re-threshold to soften mask edges."""
    blurred = cv2.GaussianBlur(mask, (ksize, ksize), 0)
    _, out = cv2.threshold(blurred, 127, 255, cv2.THRESH_BINARY)
    return out


def _morphology(mask: np.ndarray, close_k: int = 25, dilate_k: int = 10) -> np.ndarray:
    """Close small holes and dilate slightly for full coverage."""
    k_close  = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_k, close_k))
    k_dilate = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_k, dilate_k))
    closed   = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_close)
    dilated  = cv2.dilate(closed, k_dilate, iterations=1)
    return dilated


# ══════════════════════════════════════════════════════════════════
# METHOD A — Face Mesh (precise)
# ══════════════════════════════════════════════════════════════════
def _mask_via_face_mesh(img_rgb: np.ndarray) -> np.ndarray | None:
    """
    Returns a uint8 (0/255) mask or None if Face Mesh cannot detect a face.

    The mask covers the region ABOVE the face oval (i.e., the hair zone)
    by:
      1. Drawing the face oval polygon and filling it (= face area).
      2. Using the TOP half of the oval to define the hairline boundary.
      3. Painting everything from image top down to the hairline as hair.
      4. Subtracting the lower face area.
    """
    h, w = img_rgb.shape[:2]

    mp_mesh = mp.solutions.face_mesh
    with mp_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.4,
    ) as mesh:
        result = mesh.process(img_rgb)

    if not result.multi_face_landmarks:
        return None

    lms = result.multi_face_landmarks[0].landmark

    def lm_px(idx: int) -> tuple[int, int]:
        l = lms[idx]
        return (int(l.x * w), int(l.y * h))

    # ── Full face oval polygon ──────────────────────────────────
    oval_pts = np.array([lm_px(i) for i in FACE_OVAL_IDS], dtype=np.int32)

    face_mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(face_mask, [oval_pts], 255)

    # ── Hairline boundary: top portion of oval ──────────────────
    # Find the topmost landmark in the oval (usually index 10, crown of head).
    crown_pt   = lm_px(10)      # very top of head
    crown_y    = crown_pt[1]

    # The "eye level" is approximately landmark 168 (nose bridge area)
    # or we can compute ~30% down from the crown to the chin.
    chin_y = lm_px(152)[1]      # chin
    eye_y  = crown_y + int((chin_y - crown_y) * 0.35)  # ~35% = eye/brow level

    # Hair zone: everything above eye level AND inside a slightly expanded oval
    hair_zone = np.zeros((h, w), dtype=np.uint8)
    hair_zone[0:eye_y, :] = 255  # full strip above eye level

    # Expand oval horizontally for temple/side hair
    expanded_oval = oval_pts.copy()
    center_x = int(np.mean(expanded_oval[:, 0]))
    expanded_oval[:, 0] = np.clip(
        center_x + (expanded_oval[:, 0] - center_x) * 1.3, 0, w - 1
    ).astype(np.int32)
    expanded_face_mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(expanded_face_mask, [expanded_oval], 255)

    # Hair = (strip above eyes) ∩ (expanded oval)
    hair_mask = cv2.bitwise_and(hair_zone, expanded_face_mask)

    # ── Refine ─────────────────────────────────────────────────
    hair_mask = _morphology(hair_mask, close_k=20, dilate_k=8)
    hair_mask = _smooth_mask(hair_mask, ksize=19)

    return hair_mask


# ══════════════════════════════════════════════════════════════════
# METHOD B — Face Detection + Selfie Segmentation (fallback)
# ══════════════════════════════════════════════════════════════════
def _mask_via_detection(img_rgb: np.ndarray) -> np.ndarray | None:
    """
    Returns a uint8 (0/255) mask or None if no face is detected.

    Uses bounding box from Face Detection to locate the hair zone,
    refined by Selfie Segmentation to exclude background pixels.
    """
    h, w = img_rgb.shape[:2]

    # ── Face Detection ─────────────────────────────────────────
    mp_face = mp.solutions.face_detection
    bbox = None

    with mp_face.FaceDetection(
        model_selection=1,
        min_detection_confidence=0.35,
    ) as detector:
        result = detector.process(img_rgb)
        if result.detections:
            bb = result.detections[0].location_data.relative_bounding_box
            bbox = (
                int(max(0, bb.xmin * w)),
                int(max(0, bb.ymin * h)),
                int(bb.width * w),
                int(bb.height * h),
            )

    if bbox is None:
        return None

    fx, fy, fw, fh = bbox

    # ── Selfie Segmentation ─────────────────────────────────────
    mp_seg = mp.solutions.selfie_segmentation
    with mp_seg.SelfieSegmentation(model_selection=1) as segmenter:
        seg = segmenter.process(img_rgb)

    person_mask = (seg.segmentation_mask > 0.55).astype(np.uint8) * 255

    # ── Define hair zone ─────────────────────────────────────────
    # Hair sits above the face bounding box top, ±40% wider on each side.
    eye_y      = fy + int(fh * 0.30)          # ~30% into face = brow/eye level
    hair_top   = max(0, fy - int(fh * 1.1))   # well above the head
    hair_left  = max(0, fx - int(fw * 0.40))
    hair_right = min(w, fx + fw + int(fw * 0.40))

    hair_zone = np.zeros((h, w), dtype=np.uint8)
    hair_zone[hair_top:eye_y, hair_left:hair_right] = 255

    # Intersect with person segmentation
    hair_mask = cv2.bitwise_and(hair_zone, person_mask)

    # ── Refine ─────────────────────────────────────────────────
    hair_mask = _morphology(hair_mask, close_k=30, dilate_k=12)
    hair_mask = _smooth_mask(hair_mask, ksize=21)

    return hair_mask


# ══════════════════════════════════════════════════════════════════
# METHOD C — OpenCV Haar Cascades (Robust Fallback)
# ══════════════════════════════════════════════════════════════════
def _mask_via_opencv(img_rgb: np.ndarray) -> np.ndarray | None:
    """
    Returns a uint8 (0/255) mask using basic OpenCV face detection.
    This is a fallback for when MediaPipe fails to load on certain systems.
    """
    h, w = img_rgb.shape[:2]
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    
    # Load the built-in OpenCV face detector
    cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    face_cascade = cv2.CascadeClassifier(cascade_path)
    
    faces = face_cascade.detectMultiScale(gray, 1.1, 4)
    if len(faces) == 0:
        return None
    
    # Use the largest detected face
    faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
    fx, fy, fw, fh = faces[0]
    
    # Define a simple hair zone: a box above the face
    # We take the top 40% of the face box and extend it upwards
    eye_y      = fy + int(fh * 0.35)
    hair_top   = max(0, fy - int(fh * 0.7))
    hair_left  = max(0, fx - int(fw * 0.2))
    hair_right = min(w, fx + fw + int(fw * 0.2))
    
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.rectangle(mask, (hair_left, hair_top), (hair_right, eye_y), 255, -1)
    
    # Soften the edges
    mask = _smooth_mask(mask, ksize=31)
    return mask


# ══════════════════════════════════════════════════════════════════
# PUBLIC API
# ══════════════════════════════════════════════════════════════════
def generate_hair_mask(pil_image: Image.Image) -> Image.Image:
    """
    Generate a binary hair mask for a portrait image.
    """
    img_rgb = np.array(pil_image.convert('RGB'))

    # Try Method A (Face Mesh)
    try:
        mask = _mask_via_face_mesh(img_rgb)
    except Exception as e:
        print(f"Method A failed: {e}")
        mask = None

    # Try Method B (Detection + Segmentation)
    if mask is None:
        try:
            mask = _mask_via_detection(img_rgb)
        except Exception as e:
            print(f"Method B failed: {e}")
            mask = None

    # Try Method C (OpenCV Fallback)
    if mask is None:
        try:
            mask = _mask_via_opencv(img_rgb)
        except Exception as e:
            print(f"Method C failed: {e}")
            mask = None

    if mask is None:
        raise MaskError(
            "No face detected in the image. "
            "Please upload a clear frontal photo with your face well-lit."
        )

    return _to_pil_gray(mask)


def overlay_mask_on_image(pil_image: Image.Image, mask: Image.Image) -> Image.Image:
    """
    Debug helper: returns the original image with the hair mask
    overlaid in semi-transparent red.
    """
    img   = pil_image.convert('RGBA')
    arr   = np.array(img)
    m     = np.array(mask.convert('L'))

    overlay = arr.copy()
    overlay[m > 127, 0] = 220   # Red channel
    overlay[m > 127, 1] = 50
    overlay[m > 127, 2] = 50
    overlay[m > 127, 3] = 180   # Semi-transparent

    return Image.fromarray(overlay, mode='RGBA')