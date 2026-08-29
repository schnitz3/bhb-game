/* Offline support.
 *
 * Two strategies on purpose:
 *   - code and markup are fetched from the network first, so shipping a fix
 *     actually reaches players instead of being masked by a stale cache;
 *   - art, fonts and audio never change without changing name, so those are
 *     served from the cache first and the network is only a fallback.
 * Bump CACHE when you rename or remove an asset.
 */
var CACHE = 'bhb-game-v4';

var CORE = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/rig.js', './js/world.js', './js/game.js',
  './favicon.png', './icons/icon-192.png', './icons/icon-512.png',
  './assets/fonts/OpenDyslexic-Regular.woff2',
  './assets/fonts/OpenDyslexic-Bold.woff2',
  './assets/img/palm.png', './assets/img/dolphin.png',
  './assets/bob/rig.json'
];

['face', 'hair', 'nose', 'eyeL', 'eyeR', 'pupilL', 'pupilR', 'blinkL', 'blinkR', 'browL', 'browR',
 'mouthSmile', 'mouthNeutral', 'mouthOh', 'mouthWow', 'mouthSad',
 'torso', 'legL', 'legR', 'armL0', 'armL1', 'armL2', 'armL3',
 'armR0', 'armR1', 'armR2', 'armR3'].forEach(function (n) {
  CORE.push('./assets/bob/' + n + '.png');
});

['ButtonClick', 'Drop', 'Falling', 'Laugh', 'LevelPassed', 'WalkStep', 'Weee', 'Yowwy']
  .forEach(function (n) { CORE.push('./assets/audio/' + n + '.mp3'); });
CORE.push('./assets/audio/ReadySetGo.m4a');

/* The music is ~1.8 MB and the game is fully playable without it, so it is
   cached only once a player has actually heard it. */

function isCode(url) {
  return /\.(?:html|css|js|json|webmanifest)$/.test(url.pathname) ||
    url.pathname.endsWith('/');
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(CORE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function store(request, response) {
  if (response && response.ok && response.type === 'basic') {
    var copy = response.clone();
    caches.open(CACHE).then(function (c) { c.put(request, copy); });
  }
  return response;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') { return; }

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) { return; }

  if (req.mode === 'navigate' || isCode(url)) {
    e.respondWith(
      fetch(req)
        .then(function (res) { return store(req, res); })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match('./index.html');
          });
        })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { return store(req, res); });
    })
  );
});
