# Rebuilding Bob from the puppet

`extract-bob.py` composites Bob's parts out of the Character Animator PSD and
writes them, plus `rig.json`, into `assets/bob/`.

Needs Python 3 with `psd-tools` and `Pillow`:

```bash
python3 -m pip install psd-tools Pillow
```

Then, from the repository root:

```bash
python3 tools/extract-bob.py assets/bob 0.25
```

The second argument is the scale factor applied to the 4182 x 4063 PSD. `0.25`
gives a 598 px-wide head, which is sharp on a 3x phone. Raise it for bigger
screens, at the cost of download size.

Inside the script, `FACE` picks the face colour variant (`Blue`, `Purple`,
`Pink`, `Red`, `Gray transparent`) and `SKIN` picks the hand variant. Every part
is listed explicitly by its layer path, so adding an expression means adding one
`save_part(...)` line and one entry in `MOUTHS` in `js/rig.js`.

If you add or rename a file here, bump the cache version in `sw.js`.
