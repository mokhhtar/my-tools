"""
hairstyles.py
Catalogue of hairstyle presets and product looks.
Each entry contains:
  - id, name, desc, category
  - prompt: what to ask the AI to generate
  - neg_prompt: what to tell the AI to avoid
"""

# ──────────────────────────────────────────────────────────────
# PROMPT LIBRARY
# Rule: always start with "realistic portrait photo, same person,
#        same face and features preserved," to anchor the identity.
# ──────────────────────────────────────────────────────────────
_PROMPTS: dict[str, tuple[str, str]] = {

    # ── Short cuts ──────────────────────────────────────────────
    "buzz_cut": (
        "realistic portrait photo, same person, same face preserved, "
        "very short buzz cut hairstyle, uniform 3mm clipper length all over, "
        "clean military-style finish, sharp edges, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, extra limbs, low quality, ugly, disfigured",
    ),
    "skin_fade": (
        "realistic portrait photo, same person, same face preserved, "
        "high skin fade barbershop haircut, zero shaved sides blending into "
        "longer styled hair on top, crisp line up, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "crew_cut": (
        "realistic portrait photo, same person, same face preserved, "
        "classic crew cut, short tapered sides with slightly longer textured top, "
        "clean professional finish, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "caesar": (
        "realistic portrait photo, same person, same face preserved, "
        "Caesar cut hairstyle, short horizontal fringe swept forward, "
        "uniform short length all over, structured and clean, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "ivy_league": (
        "realistic portrait photo, same person, same face preserved, "
        "Ivy League Princeton cut, longer crew cut with clean side part, "
        "preppy collegiate style, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),

    # ── Medium length ────────────────────────────────────────────
    "textured_crop": (
        "realistic portrait photo, same person, same face preserved, "
        "modern textured crop haircut, short disconnected sides with messy "
        "textured top, contemporary barbershop style, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "side_part": (
        "realistic portrait photo, same person, same face preserved, "
        "classic gentleman side part hairstyle, clean sharp parting on the left, "
        "hair combed neatly over, elegant traditional look, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "slick_back": (
        "realistic portrait photo, same person, same face preserved, "
        "slick back hairstyle, hair swept straight back from forehead, "
        "polished high-shine finish, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "bob": (
        "realistic portrait photo, same person, same face preserved, "
        "classic bob haircut, jaw-length clean blunt cut all around, "
        "sleek and smooth finish, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),

    # ── Long hair ────────────────────────────────────────────────
    "long_straight": (
        "realistic portrait photo, same person, same face preserved, "
        "long straight flowing hair reaching past shoulders, sleek and smooth, "
        "healthy shiny hair, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "man_bun": (
        "realistic portrait photo, same person, same face preserved, "
        "man bun hairstyle, long hair gathered and tied in a neat bun on top "
        "of the head, with shorter sides, casual stylish look, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "shoulder_length": (
        "realistic portrait photo, same person, same face preserved, "
        "shoulder length hair, medium-long flowing hair with natural movement, "
        "healthy voluminous finish, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),

    # ── Curly & Wavy ─────────────────────────────────────────────
    "natural_afro": (
        "realistic portrait photo, same person, same face preserved, "
        "full round natural afro hairstyle, voluminous beautiful tight curl texture, "
        "proud natural look, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "curly_top_fade": (
        "realistic portrait photo, same person, same face preserved, "
        "high skin fade with natural curly top, tight coily curls on top with "
        "clean fade sides, fresh barbershop finish, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "textured_waves": (
        "realistic portrait photo, same person, same face preserved, "
        "textured wavy hair, medium length with natural defined waves, "
        "effortless beach-wave style, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "loose_curls": (
        "realistic portrait photo, same person, same face preserved, "
        "loose bouncy curly hair, defined large curl pattern, medium length, "
        "natural healthy-looking curls, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),

    # ── Classic & Retro ──────────────────────────────────────────
    "pompadour": (
        "realistic portrait photo, same person, same face preserved, "
        "classic pompadour hairstyle, high voluminous hair swept dramatically "
        "back from the forehead, retro rockabilly barber style, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "undercut": (
        "realistic portrait photo, same person, same face preserved, "
        "disconnected undercut hairstyle, razor-shaved sides and back with "
        "long flowing hair on top, modern edgy look, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "quiff": (
        "realistic portrait photo, same person, same face preserved, "
        "quiff hairstyle, voluminous front hair styled upward and swept back, "
        "tapered sides, modern classic look, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),

    # ── Product looks ─────────────────────────────────────────────
    "matte_clay": (
        "realistic portrait photo, same person, same face preserved, "
        "hair styled with matte clay product, natural matte texture with zero shine, "
        "piece-y separated hair, modern natural finish, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly, shiny wet hair, glossy",
    ),
    "wet_gel": (
        "realistic portrait photo, same person, same face preserved, "
        "hair styled with gel, extremely high shine wet look, perfectly slicked, "
        "glossy polished all-day-hold appearance, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly, dry matte hair",
    ),
    "high_shine_pomade": (
        "realistic portrait photo, same person, same face preserved, "
        "hair styled with high shine pomade, classic polished high-gloss look, "
        "elegant retro barbershop finish, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly",
    ),
    "sea_salt_texture": (
        "realistic portrait photo, same person, same face preserved, "
        "hair styled with sea salt spray, tousled effortless beach wave texture, "
        "natural movement casual look, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly, flat limp hair",
    ),
    "blow_dry_volume": (
        "realistic portrait photo, same person, same face preserved, "
        "hair blow-dried for maximum volume, fluffy full voluminous blowout, "
        "salon fresh finish, photorealistic, 8k",
        "blurry, cartoon, painting, anime, distorted face, changed face, "
        "different person, low quality, ugly, flat hair",
    ),
}

# ──────────────────────────────────────────────────────────────
# CATALOGUE STRUCTURE  (sent to frontend via /api/hairstyles)
# ──────────────────────────────────────────────────────────────
HAIRSTYLES: dict[str, dict] = {
    "short": {
        "label": "Short Cuts",
        "icon":  "ti-cut",
        "styles": [
            {"id": "buzz_cut",      "name": "Buzz Cut",      "desc": "Uniform clipper length all over"},
            {"id": "skin_fade",     "name": "Skin Fade",     "desc": "Zero sides, styled top"},
            {"id": "crew_cut",      "name": "Crew Cut",      "desc": "Short sides, textured top"},
            {"id": "caesar",        "name": "Caesar Cut",    "desc": "Short horizontal fringe"},
            {"id": "ivy_league",    "name": "Ivy League",    "desc": "Longer crew cut with side part"},
        ],
    },
    "medium": {
        "label": "Medium Length",
        "icon":  "ti-line-height",
        "styles": [
            {"id": "textured_crop", "name": "Textured Crop", "desc": "Modern disconnected, messy top"},
            {"id": "side_part",     "name": "Side Part",     "desc": "Classic clean parting"},
            {"id": "slick_back",    "name": "Slick Back",    "desc": "Swept back, polished finish"},
            {"id": "bob",           "name": "Bob Cut",       "desc": "Jaw-length blunt cut"},
        ],
    },
    "long": {
        "label": "Long Hair",
        "icon":  "ti-arrow-down",
        "styles": [
            {"id": "long_straight",   "name": "Long Straight",    "desc": "Flowing, sleek & smooth"},
            {"id": "man_bun",         "name": "Man Bun",          "desc": "Tied up top knot"},
            {"id": "shoulder_length", "name": "Shoulder Length",  "desc": "Natural medium-long flow"},
        ],
    },
    "curly": {
        "label": "Curly & Wavy",
        "icon":  "ti-wave-sine",
        "styles": [
            {"id": "natural_afro",    "name": "Natural Afro",     "desc": "Full round voluminous afro"},
            {"id": "curly_top_fade",  "name": "Curly Top Fade",   "desc": "Fade sides + natural curly top"},
            {"id": "textured_waves",  "name": "Textured Waves",   "desc": "Beach-wave effortless look"},
            {"id": "loose_curls",     "name": "Loose Curls",      "desc": "Defined bouncy curl pattern"},
        ],
    },
    "classic": {
        "label": "Classic & Retro",
        "icon":  "ti-crown",
        "styles": [
            {"id": "pompadour",  "name": "Pompadour",  "desc": "High voluminous swept-back top"},
            {"id": "undercut",   "name": "Undercut",   "desc": "Shaved sides, long flowing top"},
            {"id": "quiff",      "name": "Quiff",      "desc": "Upward swept voluminous front"},
        ],
    },
    "products": {
        "label": "Product Looks",
        "icon":  "ti-droplet",
        "styles": [
            {"id": "matte_clay",       "name": "Matte Clay",        "desc": "Natural texture, zero shine"},
            {"id": "wet_gel",          "name": "Wet Gel Look",      "desc": "High gloss, slicked finish"},
            {"id": "high_shine_pomade","name": "High Shine Pomade", "desc": "Classic polished shine"},
            {"id": "sea_salt_texture", "name": "Sea Salt Spray",    "desc": "Tousled beach waves"},
            {"id": "blow_dry_volume",  "name": "Blow-Dry Volume",   "desc": "Fluffy salon blowout"},
        ],
    },
}


def get_prompt(style_id: str) -> tuple[str, str]:
    """
    Returns (prompt, negative_prompt) for a given style_id.
    Raises KeyError if style_id is not found.
    """
    if style_id not in _PROMPTS:
        raise KeyError(f"Unknown style_id: '{style_id}'")
    return _PROMPTS[style_id]


def all_style_ids() -> set[str]:
    """Returns a flat set of all valid style IDs."""
    ids: set[str] = set()
    for cat in HAIRSTYLES.values():
        for style in cat["styles"]:
            ids.add(style["id"])
    return ids