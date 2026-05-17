import base64
import io
import time
import requests
from PIL import Image
from huggingface_hub import InferenceClient, InferenceTimeoutError
from huggingface_hub.errors import HfHubHTTPError, OverloadedError


class AIError(Exception):
    """Raised for all AI API failures."""


def _pil_to_bytes(img: Image.Image, fmt: str = "PNG") -> bytes:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _bytes_to_pil(raw: bytes) -> Image.Image:
    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise AIError(f"Cannot decode AI response as image: {exc}") from exc


# ══════════════════════════════════════════════════════════════════
class HuggingFaceClient:
    """
    Sends inpainting requests to HuggingFace using the official InferenceClient.
    """

    MODELS = [
        "runwayml/stable-diffusion-inpainting",
        "stable-diffusion-v1-5/stable-diffusion-inpainting",
        "stabilityai/stable-diffusion-2-inpainting",
    ]
    
    REQUEST_TIMEOUT = 120   # seconds
    MAX_RETRIES     = 3

    def __init__(self, token: str, model_index: int = 0):
        if not token:
            raise AIError(
                "HF_TOKEN is not configured. "
                "Get a free token at https://huggingface.co/settings/tokens "
                "and add it to your .env file."
            )
        self.token = token
        self.model = self.MODELS[min(model_index, len(self.MODELS) - 1)]
        # InferenceClient handles URL management and authentication
        self.client = InferenceClient(model=self.model, token=token, timeout=self.REQUEST_TIMEOUT)

    # ── public ────────────────────────────────────────────────────
    def inpaint(
        self,
        image:           Image.Image,
        mask:            Image.Image,
        prompt:          str,
        negative_prompt: str = "",
        num_steps:       int = 30,
        guidance_scale:  float = 7.5,
        strength:        float = 0.99,
    ) -> Image.Image:
        """
        Run SD inpainting using the InferenceClient.
        """
        parameters = {
            "negative_prompt":     negative_prompt,
            "num_inference_steps": num_steps,
            "guidance_scale":      guidance_scale,
            "strength":            strength,
        }

        # For inpainting, we use the image_to_image task or raw post
        # Standard Inference API expects a specific format for inpainting
        payload = {
            "inputs": prompt,
            "parameters": {
                **parameters,
                "image": base64.b64encode(_pil_to_bytes(image)).decode("utf-8"),
                "mask_image": base64.b64encode(_pil_to_bytes(mask.convert("RGB"))).decode("utf-8"),
            }
        }

        headers = {"Authorization": f"Bearer {self.token}"}
        url = f"https://api-inference.huggingface.co/models/{self.model}"

        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                # Some versions of huggingface_hub (like 1.14.0) may have removed .post()
                if hasattr(self.client, "post"):
                    response_data = self.client.post(json=payload)
                else:
                    # Fallback to direct requests if client.post is missing
                    resp = requests.post(url, headers=headers, json=payload, timeout=self.REQUEST_TIMEOUT)
                    resp.raise_for_status()
                    response_data = resp.content

                return _bytes_to_pil(response_data)

            except InferenceTimeoutError:
                if attempt < self.MAX_RETRIES:
                    time.sleep(5 * attempt)
                    continue
                raise AIError("HuggingFace API timed out. The server might be overloaded.")

            except (HfHubHTTPError, requests.exceptions.RequestException) as e:
                # Extract status code safely from either exception type
                status_code = None
                if hasattr(e, 'response') and e.response is not None:
                    status_code = e.response.status_code

                if status_code == 429:
                    raise AIError("HuggingFace API rate limit reached. Wait a few minutes.")
                
                err_msg = str(e)
                # Handle model loading (503)
                if status_code == 503 or "estimated_time" in err_msg:
                    if attempt < self.MAX_RETRIES:
                        wait = 20
                        print(f"  [HF] Model loading, waiting {wait}s (attempt {attempt}/{self.MAX_RETRIES})…")
                        time.sleep(wait)
                        continue
                
                raise AIError(f"HuggingFace API error: {err_msg}")

            except Exception as e:
                raise AIError(f"Unexpected error: {e}")

        raise AIError("All retry attempts exhausted.")

    def switch_model(self, index: int) -> None:
        """Switch to an alternate model."""
        self.model = self.MODELS[min(index, len(self.MODELS) - 1)]
        self.client = InferenceClient(model=self.model, token=self.token, timeout=self.REQUEST_TIMEOUT)
        print(f"  [HF] Switched to model: {self.model}")