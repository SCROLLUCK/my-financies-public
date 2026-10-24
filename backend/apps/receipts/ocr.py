import pytesseract
from PIL import Image, ImageOps

try:
    import cv2
    import numpy as np
except ImportError:  # pragma: no cover - opencv is in requirements
    cv2 = None

# Phone photos below this width tend to OCR poorly; upscale gently.
TARGET_WIDTH = 1800
MAX_WIDTH = 3000
# 4 = sparse column text (receipts), 6 = uniform block; best is picked by confidence.
PSM_MODES = (4, 6)


def _base(image: Image.Image) -> Image.Image:
    img = ImageOps.exif_transpose(image)
    img = img.convert("L")
    if img.width < TARGET_WIDTH:
        scale = TARGET_WIDTH / img.width
        img = img.resize((TARGET_WIDTH, int(img.height * scale)), Image.LANCZOS)
    elif img.width > MAX_WIDTH:
        scale = MAX_WIDTH / img.width
        img = img.resize((MAX_WIDTH, int(img.height * scale)), Image.LANCZOS)
    return img


def _variants(image: Image.Image) -> list[Image.Image]:
    """Candidate cleanups: global autocontrast plus (when OpenCV is available)
    denoise + adaptive threshold, which isolates text from busy photo backgrounds."""
    base = _base(image)
    variants = [ImageOps.autocontrast(base)]
    if cv2 is not None:
        arr = np.asarray(base)
        denoised = cv2.fastNlMeansDenoising(arr, h=10)
        binary = cv2.adaptiveThreshold(
            denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 15
        )
        variants.append(Image.fromarray(binary))
    return variants


def _read(img: Image.Image, psm: int) -> tuple[float, str]:
    """One Tesseract pass returning (confidence score, reconstructed text)."""
    data = pytesseract.image_to_data(
        img, lang="por", config=f"--psm {psm}", output_type=pytesseract.Output.DICT
    )
    lines: dict[tuple[int, int, int], list[str]] = {}
    score = 0.0
    for i, word in enumerate(data["text"]):
        conf = float(data["conf"][i])
        if not word.strip() or conf <= 0:
            continue
        score += conf / 100.0
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append(word)
    text = "\n".join(" ".join(words) for _, words in sorted(lines.items()))
    return score, text


def run(image: Image.Image) -> str:
    """OCR the photo trying each variant x PSM mode; keep the highest-confidence read."""
    best_score, best_text = 0.0, ""
    for variant in _variants(image):
        for psm in PSM_MODES:
            score, text = _read(variant, psm)
            if score > best_score:
                best_score, best_text = score, text
    return best_text
