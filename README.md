# Balance Big Head Bob

Bob's head is enormous. Keep him upright as he walks the beach, and see how far
he gets. Works on phones (portrait or landscape), tablets and desktop, installs
as an app, and plays offline once it has loaded.

**Balance. Breathe. Be your best.**

---

## Putting it on GitHub Pages

There is nothing to build. The folder is the site.

1. On GitHub, create a new empty **public** repository called `bhb-game`. Do not
   add a README or a licence, or the first push will be rejected.
2. From inside this folder:

```bash
git remote add origin https://github.com/schnitz3/bhb-game.git && git push -u origin main
```

3. In the new repository go to **Settings > Pages**, set **Source** to
   *Deploy from a branch*, choose branch `main` and folder `/ (root)`, and save.
4. Give it a minute. The game is then live at:

```
https://balance.bigheadbob.com/
```

The paths are all relative and this has been checked from a subfolder, so the
project-site URL works as-is.

### Putting it on the Shopify site

The game answers on its own domain at https://balance.bigheadbob.com/ (a CNAME
onto GitHub Pages), and is embedded on the Shopify site at
https://bigheadbob.com/pages/balance-bob-game.

The embed does **not** go through a theme section. The Default page template has
no "Add section" slot, so Custom Liquid is not available. It goes in the page's
own HTML instead: **Online Store > Pages > the page**, then the `<>` button in
the content toolbar. Shopify keeps `<iframe>` there, contrary to what is often
claimed, but it does strip `<style>` blocks, so all the sizing has to be inline
on the element:

```html
<div style="max-width:1100px;margin:0 auto;">
  <iframe src="https://balance.bigheadbob.com/"
          title="Balance Big Head Bob"
          allow="fullscreen; accelerometer; autoplay; web-share; clipboard-write"
          allowfullscreen
          style="display:block;width:100%;height:75vh;min-height:500px;border:0;border-radius:16px;background:#38b6ff;"></iframe>
</div>
```

Each permission in `allow` buys one feature, and the game degrades quietly
without any of them: `accelerometer` for tilt, `allowfullscreen` for the
full-screen button, `web-share` for the native share sheet, `clipboard-write`
for copying a score.

Note that scores are stored per origin, so a best set on the GitHub Pages address
does not follow the player to balance.bigheadbob.com, or into the embed.

### Shipping a change

Edit, commit, push. One thing to remember: the service worker caches the art and
audio, so if you **rename, add or delete** a file in `assets/`, bump the version
string at the top of `sw.js` (`bhb-game-v7` becomes `bhb-game-v8`, and so on)
in the same commit. Changes to HTML, CSS and JS reach players without that,
because those are fetched from the network first.

If you ever move the game to a different URL, update `og:url` and `og:image` in
`index.html` as well, since a share card needs an absolute address.

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
| `SHOUT_MIN` / `SHOUT_MAX` | the window the Evil Blob pops up in |
| `SHOUTS` | what he yells |

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
assets/img/     palm tree, dolphin, the Evil Blob
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

## Running it locally

```bash
python3 tools/serve.py 8815
```

Use that rather than `python3 -m http.server`. The stdlib server sends no cache
headers at all, so browsers fall back to heuristic caching and quietly keep
serving an old copy of the game: edits then look like they did nothing, and
clearing the service worker does not help because the stale copy is in the
browser's HTTP cache, a different layer. `tools/serve.py` serves the same files
with caching switched off.

## Browser support

Any current browser: Safari (iOS 13+), Chrome, Firefox, Edge, Samsung Internet.
No build step, no dependencies, no framework. About 80 KB of code.
