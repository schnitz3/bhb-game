# Balance Big Head Bob

Bob's head is enormous. Keep him upright as he walks the beach, and see how far
he gets. Works on phones (portrait or landscape), tablets and desktop, installs
as an app, and plays offline once it has loaded.

**Balance. Breathe. Be your best.**

---

## Putting it on GitHub Pages

There is nothing to build. The folder is the site.

1. Create a new, empty repository on GitHub called `bhb-game` (public).
2. In a terminal, from inside this folder:

```bash
git init -b main && git add -A && git commit -m "Balance Big Head Bob" && git remote add origin https://github.com/YOUR-USERNAME/bhb-game.git && git push -u origin main
```

3. On GitHub go to the repository's **Settings > Pages**, set **Source** to
   *Deploy from a branch*, pick branch `main` and folder `/ (root)`, and save.
4. A minute later the game is live at:

```
https://YOUR-USERNAME.github.io/bhb-game/
```

Replace `YOUR-USERNAME` with your GitHub username in both places.

### Putting it on your main site

Once it is live you can drop it into any page (Squarespace, Wix, WordPress,
anything at all) with one embed:

```html
<iframe src="https://YOUR-USERNAME.github.io/bhb-game/"
        style="width:100%;aspect-ratio:9/16;max-height:90vh;border:0"
        allow="fullscreen; accelerometer" title="Balance Big Head Bob"></iframe>
```

`accelerometer` is what lets the tilt controls work inside the frame.

### Shipping a change

Edit, commit, push. One thing to remember: the service worker caches the art and
audio, so if you **rename, add or delete** a file in `assets/`, bump the version
string at the top of `sw.js` (`bhb-game-v2` becomes `bhb-game-v3`, and so on)
in the same commit.
Changes to HTML, CSS and JS reach players without that, because those are fetched
from the network first.

---

## How the game works

Bob is an inverted pendulum. Gravity pushes him further over the more he leans,
and holding a side of the screen pushes back. Skill is reacting in time and
letting go at the right moment, not luck.

All the tuning lives at the top of `js/game.js`:

| Constant | What it does |
|---|---|
| `FALL_ANGLE` | how far he can lean before he goes over |
| `PLAYER_TORQUE` | how hard holding a side pushes |
| `GRAVITY_MIN` / `GRAVITY_MAX` | how hard he tips, at the start and once wound up |
| `DAMPING` | how quickly his lean speed bleeds off |
| `SPEED_MIN` / `SPEED_MAX` | walking pace in feet per second |
| `RAMP_FEET` | distance over which gravity and pace max out |
| `PRESSURE_FEET` | slower ramp so the wind keeps building afterwards |
| `MILESTONES` | the distances that trigger a confetti badge |
| `COUNT_WORDS` / `COUNT_END` | when each countdown sign appears, measured off the voice clip |
| `TORNADO_MIN` / `TORNADO_MAX` | the window, in seconds, that a twister arrives within |

Because damping is heavy, holding a side settles Bob's lean speed at roughly
`PLAYER_TORQUE / DAMPING`. If you raise `PLAYER_TORQUE`, raise `DAMPING` with it
or a single tap will fling him across his whole range before anyone can react.

### The countdown

`assets/audio/ReadySetGo.m4a` is a spoken clip, and the on-screen signs are timed
to it rather than to a fixed beat. The words land at 0.45 s, 1.61 s and 2.54 s,
which is what `COUNT_WORDS` holds; the walk starts at `COUNT_END`, 3.05 s, as
"Go!" finishes. If you replace the recording, re-measure the onsets and update
those numbers or the signs will drift out of sync with the voice.

## Controls

- **Touch**: hold the left or right half of the screen.
- **Keyboard**: `←`/`→` or `A`/`D`. `Space` starts, `P` pauses, `M` mutes.
- **Tilt**: optional, switched on from *How to play*. iOS asks permission first.

## What's in here

```
index.html      shell, menus and HUD (real DOM, so text stays crisp)
styles.css      layout for portrait, landscape, tablet and desktop
js/rig.js       Bob's puppet: draws and poses him from the parts in assets/bob
js/world.js     the beach, drawn in code so it fits any screen shape
js/game.js      physics, input, the practice run and game flow
sw.js           offline cache
assets/bob/     Bob's parts plus rig.json, which holds their positions
assets/img/     palm tree, dolphin
assets/audio/   sound effects, the Ready Set Go voice clip and the music
```

### Where Bob comes from

The pieces in `assets/bob/` were composited out of the Character Animator
puppet (`BHB Character new with head movements 01 (2).psd`): face, hair, eyes,
pupils, eyelids, brows, five mouths, torso, both legs and four arm positions per
side. Each piece was rendered on one shared canvas and then cropped, and
`rig.json` records where each crop sat. Drawing them at those coordinates
reassembles Bob exactly, which is why the joints line up without hand-tuning.

To re-export at a different size or with a different face colour, rerun the
extraction script with a new scale. The rig reads its joints from `rig.json`,
so nothing in the game code needs to change.

## Browser support

Any current browser: Safari (iOS 13+), Chrome, Firefox, Edge, Samsung Internet.
No build step, no dependencies, no framework. About 80 KB of code.
