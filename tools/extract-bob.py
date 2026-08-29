"""Composite named layer sets out of the Bob character PSD into game sprites.

Every part is composited on the full PSD canvas and then cropped, so the crop
offset recorded in rig.json keeps all the pieces registered to each other.
"""
import json
import os
import sys
from PIL import Image
from psd_tools import PSDImage

DEFAULT_PSD = ("/Users/daschnitz/Desktop/Big Head Bob/Animated Live Stream Bob/"
               "*Adobe Character Creator Files/"
               "BHB Character new with head movements 01 (2).psd")

# override with:  BOB_PSD="/path/to/puppet.psd" python3 tools/extract-bob.py assets/bob 0.25
PSD_PATH = os.environ.get("BOB_PSD", DEFAULT_PSD)

psd = PSDImage.open(PSD_PATH)

_leaves = []
_groups = []


def _collect(layers):
    for layer in layers:
        if layer.is_group():
            _groups.append(layer)
            _collect(layer)
        else:
            _leaves.append(layer)


_collect(psd)


def _path(layer):
    parts = []
    cur = layer
    while cur is not None and getattr(cur, 'name', None) is not None:
        parts.append(cur.name)
        cur = cur.parent
    parts.pop()  # drop 'Root'
    return "/" + "/".join(reversed(parts))


BY_PATH = {}
for _l in _leaves:
    BY_PATH.setdefault(_path(_l), _l)


def render(paths):
    """Composite exactly the given leaf layers (and their ancestor groups)."""
    for layer in _leaves:
        layer.visible = False
    for group in _groups:
        group.visible = False
    for p in paths:
        if p not in BY_PATH:
            raise KeyError("no such layer: " + p)
        layer = BY_PATH[p]
        layer.visible = True
        cur = layer.parent
        while cur is not None and cur is not psd:
            cur.visible = True
            cur = cur.parent
    return psd.composite(force=True)


def _band_centre(alpha, box, top):
    """Horizontal centre of the top (or bottom) tenth of a part.

    A single scanline is a poor anchor on a slanted shape like a leg, where the
    topmost row is a two-pixel sliver at one corner.
    """
    h = box[3] - box[1]
    band = max(1, int(h * 0.1))
    y0 = box[1] if top else box[3] - band
    strip = alpha.crop((box[0], y0, box[2], y0 + band))
    span = strip.getbbox()   # already relative to the crop
    return ((span[0] + span[2]) * 0.5) if span else ((box[2] - box[0]) * 0.5)


def save_part(paths, name, out_dir, scale, manifest, trim_alpha=8, joint_from=None):
    img = render(paths)
    # ignore near-transparent fringe pixels when finding the crop box
    alpha = img.getchannel('A').point(lambda v: 255 if v > trim_alpha else 0)
    box = alpha.getbbox()
    if box is None:
        raise ValueError("empty part: " + name)
    img = img.crop(box)
    w = max(1, round(img.width * scale))
    h = max(1, round(img.height * scale))
    # Joints come from the artwork rather than from constants that rot the moment
    # anything is redrawn: the top anchor is a hip or a shoulder, the bottom one
    # is where the hair curl roots into the scalp.
    if joint_from:
        jbox = render(joint_from).getbbox()
        top_cx = (jbox[0] + jbox[2]) * 0.5 - box[0]   # jbox is canvas-absolute
    else:
        top_cx = _band_centre(alpha, box, True)
    bot_cx = _band_centre(alpha, box, False)

    img = img.resize((w, h), Image.LANCZOS)
    img.save(os.path.join(out_dir, name + ".png"), optimize=True)
    manifest[name] = {
        "x": round(box[0] * scale, 2),
        "y": round(box[1] * scale, 2),
        "w": w,
        "h": h,
        "topCx": round(top_cx * scale, 2),
        "botCx": round(bot_cx * scale, 2),
    }
    print("%-14s psd=%s -> %dx%d" % (name, box, w, h))


if __name__ == "__main__":
    out_dir = sys.argv[1]
    scale = float(sys.argv[2]) if len(sys.argv) > 2 else 0.25
    os.makedirs(out_dir, exist_ok=True)

    SP = "/+BHB/+Standing Profile"
    HEAD = SP + "/Head/+Frontal"
    FACE = "Gray transparent"   # translucent head, picks up the sky and sand behind it
    SKIN = "Gray"          # hand/limb variant

    manifest = {}
    P = lambda *paths: list(paths)

    # ---- head, broken into independently animatable pieces ----
    save_part(P(HEAD + "/Face bg/" + FACE, HEAD + "/Nose/nose"),
              "face", out_dir, scale, manifest)
    save_part(P(HEAD + "/+Hair"), "hair", out_dir, scale, manifest)
    save_part(P(HEAD + "/+Left Eye/Left Eyeball"), "eyeL", out_dir, scale, manifest)
    save_part(P(HEAD + "/+Right Eye/Right Eyeball"), "eyeR", out_dir, scale, manifest)
    save_part(P(HEAD + "/+Left Eye/+Left Pupil/eye ball",
                HEAD + "/+Left Eye/+Left Pupil/highlight"), "pupilL", out_dir, scale, manifest)
    save_part(P(HEAD + "/+Right Eye/+Right Pupil/eye ball",
                HEAD + "/+Right Eye/+Right Pupil/highlight"), "pupilR", out_dir, scale, manifest)
    save_part(P(HEAD + "/+Left Eye/Left Blink"), "blinkL", out_dir, scale, manifest)
    save_part(P(HEAD + "/+Right Eye/Right Blink"), "blinkR", out_dir, scale, manifest)
    save_part(P(HEAD + "/+Left Eyebrow"), "browL", out_dir, scale, manifest)
    save_part(P(HEAD + "/+Right Eyebrow"), "browR", out_dir, scale, manifest)

    save_part(P(HEAD + "/Mouth/Mouth neutral/Smile"), "mouthSmile", out_dir, scale, manifest)
    save_part(P(HEAD + "/Mouth/Mouth neutral/Neutral"), "mouthNeutral", out_dir, scale, manifest)
    save_part(P(HEAD + "/Mouth/Mouth neutral/Oh"), "mouthOh", out_dir, scale, manifest)
    save_part(P(HEAD + "/Mouth/Mouth neutral/Surprised"), "mouthWow", out_dir, scale, manifest)
    save_part(P(HEAD + "/Mouth/Mouth sad/Neutral"), "mouthSad", out_dir, scale, manifest)

    # ---- body ----
    save_part(P(SP + "/body/Body bg/neck/" + SKIN,
                SP + "/body/Body bg/jacket back",
                SP + "/body/Body bg/shirt",
                SP + "/body/Body bg/Torso",
                SP + "/body/Body bg/Jacket/jacket"), "torso", out_dir, scale, manifest)
    save_part(P(SP + "/body/+Left Leg/Pent", SP + "/body/+Left Leg/L Shoe"),
              "legL", out_dir, scale, manifest,
              joint_from=[SP + "/body/+Left Leg/Pent"])
    save_part(P(SP + "/body/+Right Leg/Pent", SP + "/body/+Right Leg/R Shoe"),
              "legR", out_dir, scale, manifest,
              joint_from=[SP + "/body/+Right Leg/Pent"])

    # ---- arms: four raise steps per side, from hanging down to straight out ----
    arms_r = [
        ("armR0", [SP + "/Arm R/+Right arm/1/Arm", SP + "/Arm R/+Right arm/1/Hands/RDefault/" + SKIN]),
        ("armR1", [SP + "/Arm R/+Right Arm 1/2/Arm", SP + "/Arm R/+Right Arm 1/2/Hands/RDefault/" + SKIN]),
        ("armR2", [SP + "/Arm R/+Right Arm 2/2/Arm", SP + "/Arm R/+Right Arm 2/2/Hands/RWave/" + SKIN]),
        ("armR3", [SP + "/Arm R/+Right Arm 3/2/Arm", SP + "/Arm R/+Right Arm 3/2/Hands/RWave/" + SKIN]),
    ]
    arms_l = [
        ("armL0", [SP + "/Arm L/+Left arm/1/Arm", SP + "/Arm L/+Left arm/1/Hands/RDefault/" + SKIN]),
        ("armL1", [SP + "/Arm L/+Left Arm 1/2/Arm", SP + "/Arm L/+Left Arm 1/2/Hands/RDefault /" + SKIN]),
        ("armL2", [SP + "/Arm L/+Left Arm 2/2/Arm", SP + "/Arm L/+Left Arm 2/2/Hands/RWave/" + SKIN]),
        ("armL3", [SP + "/Arm L/+Left Arm 3/2/Arm", SP + "/Arm L/+Left Arm 3/2/Hands/RWave/" + SKIN]),
    ]
    for name, paths in arms_r + arms_l:
        save_part(paths, name, out_dir, scale, manifest)

    manifest["_scale"] = scale
    manifest["_psdSize"] = [round(psd.width * scale), round(psd.height * scale)]
    with open(os.path.join(out_dir, "rig.json"), "w") as fh:
        json.dump(manifest, fh, indent=1, sort_keys=True)
    print("\nwrote", len(manifest) - 2, "parts to", out_dir)
