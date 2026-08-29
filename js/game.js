/* Balance Big Head Bob — game loop, physics and flow.
 *
 * Bob is an inverted pendulum: gravity pushes him further over the more he
 * leans, and holding a side of the screen pushes back. That makes the game
 * about reacting and letting go at the right moment, rather than about luck.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------ tuning knobs

  /* Tuning. The numbers matter more than they look: with heavy damping the
     angular velocity settles at roughly PLAYER_TORQUE / DAMPING while a side is
     held, so Bob crosses his whole range in about a second and a half. Anything
     much faster and a single tap flings him past upright before you can react.
     Gravity stays below PLAYER_TORQUE early on, which means a beginner can
     always recover; by the end it wins near the edges and you have to keep him
     out of them instead. */
  var FALL_ANGLE = 0.62;          // radians past upright before he goes over
  var PLAYER_TORQUE = 2.9;        // rad/s^2 while a side is held
  var GRAVITY_MIN = 2.6;          // rad/s^2 multiplier when the walk starts
  var GRAVITY_MAX = 7.0;          // ...and once it is fully wound up
  var DAMPING = 3.2;
  var SPEED_MIN = 8;              // feet per second
  var SPEED_MAX = 14;
  var RAMP_FEET = 1800;           // distance over which gravity and pace max out
  var PRESSURE_FEET = 3200;       // slower ramp so the wind never stops building
  var GRACE = 1.4;                // calm seconds at the start of a walk
  var TILT_DEADZONE = 4;          // degrees of device tilt ignored

  var MILESTONES = [
    { ft: 60, word: 'NICE!' },
    { ft: 150, word: 'RESPECT!' },
    { ft: 300, word: 'LOVE!' },
    { ft: 600, word: 'PEACE!' },
    { ft: 1000, word: 'WOW!' },
    { ft: 1600, word: 'LEGEND!' },
    { ft: 2400, word: 'UNREAL!' }
  ];

  var TORNADO_FROM = 220;         // feet before the first one can show up
  var TORNADO_EVERY = 34;         // seconds between them, roughly

  var BRAND = {
    blue: '#38b6ff', red: '#ff3131', purple: '#cb6ce6',
    pink: '#ff66c4', ink: '#123a5c'
  };

  // ------------------------------------------------------------------ store

  var Store = {
    get: function (k, dflt) {
      try {
        var v = localStorage.getItem('bhb.' + k);
        return v === null ? dflt : JSON.parse(v);
      } catch (e) { return dflt; }
    },
    set: function (k, v) {
      try { localStorage.setItem('bhb.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ }
    }
  };

  // ------------------------------------------------------------------ audio

  var Audio_ = {
    muted: Store.get('muted', false),
    buffers: {},
    music: null,
    musicWanted: false,
    unlocked: false,

    load: function (base, names) {
      var self = this;
      names.forEach(function (n) {
        var a = new Audio();
        a.preload = 'auto';
        a.src = base + n + '.mp3';
        self.buffers[n] = a;
      });
    },

    unlock: function () {
      if (this.unlocked) { return; }
      this.unlocked = true;
      // a muted play/pause on first gesture satisfies mobile autoplay rules
      Object.keys(this.buffers).forEach(function (k) {
        var a = Audio_.buffers[k];
        var v = a.volume;
        a.volume = 0;
        var p = a.play();
        if (p && p.then) { p.then(function () { a.pause(); a.currentTime = 0; a.volume = v; }, function () { a.volume = v; }); }
        else { a.pause(); a.currentTime = 0; a.volume = v; }
      });
      if (this.musicWanted) { this.startMusic(); }
    },

    play: function (name, vol, rate) {
      if (this.muted) { return; }
      var src = this.buffers[name];
      if (!src) { return; }
      var a = src.cloneNode();
      a.volume = vol == null ? 1 : vol;
      if (rate) { a.playbackRate = rate; }
      var p = a.play();
      if (p && p.catch) { p.catch(function () { /* blocked until a gesture */ }); }
    },

    startMusic: function () {
      this.musicWanted = true;
      if (!this.unlocked) { return; }
      if (!this.music) {
        this.music = new Audio('assets/audio/music.m4a');
        this.music.loop = true;
        this.music.volume = 0;
      }
      if (this.muted) { return; }
      var m = this.music;
      var p = m.play();
      if (p && p.catch) { p.catch(function () {}); }
      // fade in so it does not slam in over the countdown
      var target = 0.28;
      var t0 = performance.now();
      (function fade() {
        var k = Math.min(1, (performance.now() - t0) / 1200);
        m.volume = Audio_.muted ? 0 : target * k;
        if (k < 1) { requestAnimationFrame(fade); }
      }());
    },

    stopMusic: function () {
      this.musicWanted = false;
      if (this.music) { this.music.pause(); this.music.currentTime = 0; }
    },

    setMuted: function (m) {
      this.muted = m;
      Store.set('muted', m);
      if (this.music) { this.music.volume = m ? 0 : 0.28; }
      if (!m && this.musicWanted) { this.startMusic(); }
    }
  };

  // ------------------------------------------------------------------- dom

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    app: $('app'),
    canvas: $('stage'),
    hud: $('hud'),
    score: $('score'),
    best: $('best'),
    needle: $('needle'),
    meterTrack: document.querySelector('.meter-track'),
    meterCaption: $('meterCaption'),
    coach: $('coach'),
    coachText: $('coachText'),
    overlay: $('overlay'),
    zoneL: $('zoneL'),
    zoneR: $('zoneR'),
    toast: $('toast'),
    panels: {
      load: $('panelLoad'),
      title: $('panelTitle'),
      how: $('panelHow'),
      pause: $('panelPause'),
      over: $('panelOver')
    },
    loadBar: $('loadBar'),
    titleBest: $('titleBest'),
    titleHint: $('titleHint'),
    finalScore: $('finalScore'),
    finalBest: $('finalBest'),
    overKicker: $('overKicker'),
    btnSound: $('btnSound')
  };

  var ctx = el.canvas.getContext('2d');
  var world = new World();
  var fx = new FX();
  var bob = new BobRig();

  // ------------------------------------------------------------------ state

  var S = {
    mode: 'load',        // load | title | how | tutorial | play | falling | over | paused
    angle: 0,
    angVel: 0,
    dist: 0,
    best: Store.get('best', 0),
    elapsed: 0,
    walkPhase: 0,
    blink: 0,
    blinkTimer: 2,
    headTilt: 0,
    headVel: 0,
    hairAngle: 0,
    hairVel: 0,
    noseDir: -1,
    shake: 0,
    tornado: null,
    nextTornado: TORNADO_EVERY,
    gustIn: -1,
    gustDir: 1,
    nextGust: 3,
    milestone: 0,
    badge: null,
    countdown: null,
    fallT: 0,
    fallDir: 1,
    tutorStep: 0,
    tutorHeld: 0,
    tiltOn: Store.get('tilt', false),
    tiltRaw: 0,
    tiltReady: false,
    resumeFrom: null
  };

  var input = { left: false, right: false, keyL: false, keyR: false, touchL: false, touchR: false };

  // --------------------------------------------------------------- helpers

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function difficulty() { return clamp(S.dist / RAMP_FEET, 0, 1); }

  /* Gravity and walking pace level off, but the wind keeps getting pushier well
     past that, so a very good run still has to end somewhere. */
  function pressure() { return clamp(S.dist / PRESSURE_FEET, 0, 1.6); }

  function showPanel(name) {
    Object.keys(el.panels).forEach(function (k) { el.panels[k].hidden = (k !== name); });
    el.overlay.hidden = !name;
    fitWordmarks();
  }

  /* "Big Head Bob" always sits on one line. Rather than guessing a font size
     that happens to fit, shrink the name until it does. Hidden panels have no
     width to measure, so this runs whenever a panel is shown. */
  function fitWordmarks() {
    var marks = document.querySelectorAll('.wordmark em');
    for (var i = 0; i < marks.length; i++) {
      var em = marks[i];
      var panel = em.parentNode.parentNode;
      if (!panel || !panel.clientWidth) { continue; }
      var cs = window.getComputedStyle(panel);
      var avail = panel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (!(avail > 0)) { continue; }
      em.style.fontSize = '';
      var size = parseFloat(window.getComputedStyle(em).fontSize);
      var guard = 0;
      while (em.scrollWidth > avail && size > 13 && guard++ < 80) {
        size -= 1;
        em.style.fontSize = size + 'px';
      }
    }
  }

  function coach(text, urgent) {
    if (!text) { el.coach.hidden = true; return; }
    if (el.coachText.textContent !== text) { el.coachText.textContent = text; }
    el.coach.classList.toggle('urgent', !!urgent);
    el.coach.hidden = false;
  }

  var toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2600);
  }

  // ------------------------------------------------------------ canvas size

  var dpr = 1;
  var trackW = 0;
  function resize() {
    var w = el.app.clientWidth;
    var h = el.app.clientHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = Math.max(1, Math.round(w * dpr));
    el.canvas.height = Math.max(1, Math.round(h * dpr));
    world.layout(w, h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    trackW = el.meterTrack.clientWidth;
    fitWordmarks();
  }

  var resizeTimer;
  function scheduleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 60);
  }
  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);
  if (window.ResizeObserver) { new ResizeObserver(scheduleResize).observe(el.app); }

  // ------------------------------------------------------------------ input

  function refreshInput() {
    input.left = input.keyL || input.touchL || (S.tiltOn && S.tiltRaw < -TILT_DEADZONE);
    input.right = input.keyR || input.touchR || (S.tiltOn && S.tiltRaw > TILT_DEADZONE);
    el.zoneL.classList.toggle('held', input.left && S.mode !== 'title');
    el.zoneR.classList.toggle('held', input.right && S.mode !== 'title');
  }

  function bindZone(node, side) {
    var active = {};
    node.addEventListener('pointerdown', function (e) {
      Audio_.unlock();
      active[e.pointerId] = true;
      node.setPointerCapture(e.pointerId);
      input[side] = true;
      refreshInput();
      e.preventDefault();
    });
    function up(e) {
      delete active[e.pointerId];
      if (!Object.keys(active).length) { input[side] = false; refreshInput(); }
    }
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('lostpointercapture', up);
    node.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  bindZone(el.zoneL, 'touchL');
  bindZone(el.zoneR, 'touchR');

  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { input.keyL = true; refreshInput(); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { input.keyR = true; refreshInput(); e.preventDefault(); }
    else if (k === ' ' || k === 'Enter') {
      Audio_.unlock();
      if (S.mode === 'title') { startRun(); e.preventDefault(); }
      else if (S.mode === 'over') { startRun(); e.preventDefault(); }
      else if (S.mode === 'paused') { resume(); e.preventDefault(); }
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (S.mode === 'play' || S.mode === 'tutorial') { pause(); }
      else if (S.mode === 'paused') { resume(); }
    } else if (k === 'm' || k === 'M') { setMuted(!Audio_.muted); }
  });

  window.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { input.keyL = false; refreshInput(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { input.keyR = false; refreshInput(); }
  });

  window.addEventListener('blur', function () {
    input.keyL = input.keyR = input.touchL = input.touchR = false;
    refreshInput();
    if (S.mode === 'play' || S.mode === 'tutorial') { pause(); }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && (S.mode === 'play' || S.mode === 'tutorial')) { pause(); }
  });

  // ------------------------------------------------------------------- tilt

  function onTilt(e) {
    // gamma is the left/right tilt of the device, in degrees
    var g = e.gamma;
    if (g == null) { return; }
    if (Math.abs(window.orientation) === 90) { g = e.beta == null ? g : e.beta * (window.orientation > 0 ? 1 : -1); }
    S.tiltRaw = clamp(g, -35, 35);
    S.tiltReady = true;
    refreshInput();
  }

  function enableTilt() {
    var DOE = window.DeviceOrientationEvent;
    if (!DOE) { toast('This device has no tilt sensor.'); return; }
    function attach() {
      window.addEventListener('deviceorientation', onTilt);
      S.tiltOn = true;
      Store.set('tilt', true);
      updateTiltButton();
      toast('Tilt controls on. Lean your device to balance.');
    }
    if (typeof DOE.requestPermission === 'function') {
      DOE.requestPermission().then(function (r) {
        if (r === 'granted') { attach(); }
        else { toast('Tilt permission was declined.'); }
      }).catch(function () { toast('Tilt is not available here.'); });
    } else { attach(); }
  }

  function disableTilt() {
    window.removeEventListener('deviceorientation', onTilt);
    S.tiltOn = false;
    S.tiltRaw = 0;
    Store.set('tilt', false);
    updateTiltButton();
    refreshInput();
  }

  function updateTiltButton() {
    var b = $('btnTilt');
    if (!b) { return; }
    b.textContent = S.tiltOn ? 'Turn tilt off' : 'Use tilt controls';
    b.setAttribute('aria-pressed', S.tiltOn ? 'true' : 'false');
  }

  // --------------------------------------------------------------- flow

  function setMuted(m) {
    Audio_.setMuted(m);
    el.btnSound.setAttribute('aria-pressed', m ? 'true' : 'false');
    el.btnSound.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  }

  function resetBob() {
    S.angle = 0;
    S.angVel = 0;
    S.headTilt = 0;
    S.headVel = 0;
    S.walkPhase = 0;
    S.dist = 0;
    S.elapsed = 0;
    S.milestone = 0;
    S.badge = null;
    S.gustIn = -1;
    S.nextGust = 3.4;
    S.fallT = 0;
    S.hairAngle = 0;
    S.hairVel = 0;
    S.shake = 0;
    S.tornado = null;
    S.nextTornado = TORNADO_EVERY;
    world.setTornado(null);
    fx.clear();
  }

  function toTitle() {
    S.mode = 'title';
    resetBob();
    el.app.classList.remove('playing');
    el.hud.hidden = false;
    el.hud.classList.add('menu');
    coach(null);
    Audio_.stopMusic();
    el.titleBest.hidden = !(S.best > 0);
    if (S.best > 0) { el.titleBest.querySelector('strong').textContent = Math.round(S.best); }
    el.titleHint.textContent = Store.get('taught', false)
      ? 'Hold either side of the screen to keep Bob upright.'
      : 'First time? The practice run only takes a moment.';
    showPanel('title');
  }

  function startRun() {
    if (!Store.get('taught', false)) { startTutorial(); return; }
    resetBob();
    S.mode = 'play';
    S.countdown = { t: 0, step: -1 };
    el.app.classList.add('playing');
    el.hud.hidden = false;
    el.hud.classList.remove('menu');
    el.score.textContent = '0';
    el.best.textContent = Math.round(S.best);
    showPanel(null);
    coach(null);
    Audio_.startMusic();
  }

  function startTutorial() {
    resetBob();
    S.mode = 'tutorial';
    S.tutorStep = 0;
    S.tutorHeld = 0;
    S.angle = 0.30;
    el.app.classList.add('playing');
    el.hud.hidden = false;
    el.hud.classList.remove('menu');
    el.score.textContent = '0';
    el.best.textContent = Math.round(S.best);
    showPanel(null);
  }

  function pause() {
    if (S.mode !== 'play' && S.mode !== 'tutorial') { return; }
    S.resumeFrom = S.mode;
    S.mode = 'paused';
    input.keyL = input.keyR = input.touchL = input.touchR = false;
    refreshInput();
    coach(null);
    if (Audio_.music) { Audio_.music.pause(); }
    showPanel('pause');
  }

  function resume() {
    if (S.mode !== 'paused') { return; }
    S.mode = S.resumeFrom || 'play';
    showPanel(null);
    if (Audio_.music && !Audio_.muted && Audio_.musicWanted) {
      var p = Audio_.music.play();
      if (p && p.catch) { p.catch(function () {}); }
    }
  }

  function fall() {
    S.mode = 'falling';
    S.fallT = 0;
    S.fallDir = S.angle > 0 ? 1 : -1;
    coach(null);
    Audio_.play('Falling', 0.7);
    Audio_.play('Yowwy', 0.9);
    if (Audio_.music) { Audio_.music.pause(); }
  }

  function gameOver() {
    S.mode = 'over';
    el.app.classList.remove('playing');
    el.hud.classList.add('menu');
    var feet = Math.round(S.dist);
    var isBest = feet > S.best;
    if (isBest) { S.best = feet; Store.set('best', feet); }

    el.finalScore.textContent = feet;
    el.overKicker.textContent = pickKicker(feet);
    el.finalBest.classList.toggle('record', isBest);
    el.finalBest.textContent = isBest
      ? 'New personal best!'
      : (S.best > 0 ? 'Your best is ' + Math.round(S.best) + ' ft' : '');
    el.best.textContent = Math.round(S.best);
    showPanel('over');
  }

  function pickKicker(feet) {
    if (feet < 60) { return 'That was a short walk!'; }
    if (feet < 200) { return 'Bob took a tumble'; }
    if (feet < 600) { return 'Good balancing!'; }
    if (feet < 1200) { return 'Bob went a long way'; }
    return 'Bob is basically a tightrope walker';
  }

  // ------------------------------------------------------------- simulation

  function stepPhysics(dt) {
    var diff = difficulty();
    var grace = S.elapsed < GRACE;
    var G = lerp(GRAVITY_MIN, GRAVITY_MAX, diff) * (grace ? 0.45 : 1);

    var dir = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    var torque = G * Math.sin(S.angle) + dir * PLAYER_TORQUE;

    if (!grace) {
      // a gentle constant breeze, so he never sits perfectly still
      var press = pressure();
      var breeze = (Math.sin(S.elapsed * 0.73) * 0.55 + Math.sin(S.elapsed * 1.91 + 1.3) * 0.4);
      torque += breeze * (0.35 + press * 0.85);

      // telegraphed gusts: warn first, then shove
      S.nextGust -= dt;
      if (S.gustIn < 0 && S.nextGust <= 0) {
        S.gustDir = Math.random() < 0.5 ? -1 : 1;
        // prefer shoving him the way he is already going, but not always
        if (Math.abs(S.angle) > 0.12 && Math.random() < 0.6) { S.gustDir = S.angle > 0 ? 1 : -1; }
        S.gustIn = 0.75;
        world.showGust(S.gustDir);
        Audio_.play('WalkStep', 0.25, 0.6);
      }
      // A tornado is a rarer, much bigger event than a gust: it is announced,
      // it rattles the whole screen, and it shoves him back and forth while it
      // crosses rather than landing one clean hit.
      if (S.dist > TORNADO_FROM && !S.tornado) {
        S.nextTornado -= dt;
        if (S.nextTornado <= 0) {
          S.tornado = { t: 0, dur: 5.0, dir: Math.random() < 0.5 ? -1 : 1 };
          S.nextTornado = TORNADO_EVERY + Math.random() * 18;
          Audio_.play('Falling', 0.35, 0.6);
        }
      }
      if (S.tornado) {
        S.tornado.t += dt;
        var tp = S.tornado.t / S.tornado.dur;
        // intensity peaks as it sweeps past him, then falls away
        var near = Math.max(0, 1 - Math.abs(tp - 0.55) / 0.45);
        var bite = near * near;
        torque += Math.sin(S.tornado.t * 8.5) * bite * (2.6 + press * 1.6);
        torque += S.tornado.dir * bite * 0.9;
        S.shake = Math.max(S.shake, bite * 1.45);
        world.setTornado({ x: S.tornado.dir > 0 ? 1 - tp : tp, k: near });
        if (tp < 0.5) { coach('TORNADO! Hold on!', true); }
        if (S.tornado.t >= S.tornado.dur) { S.tornado = null; world.setTornado(null); }
      }

      if (S.gustIn >= 0) {
        S.gustIn -= dt;
        if (S.gustIn <= 0) {
          S.angVel += S.gustDir * (0.50 + press * 0.70);
          S.gustIn = -1;
          var ramp = Math.min(1, press);
          S.nextGust = lerp(3.1, 1.15, ramp) + Math.random() * lerp(2.4, 0.8, ramp);
        }
      }
    }

    S.angVel += torque * dt;
    S.angVel -= S.angVel * DAMPING * dt;
    S.angle += S.angVel * dt;

    if (Math.abs(S.angle) >= FALL_ANGLE) {
      S.angle = clamp(S.angle, -FALL_ANGLE, FALL_ANGLE);
      fall();
    }
  }

  /* The practice run is a scripted lesson rather than real physics: holding the
     right side always brings Bob smoothly upright and he can never fall over,
     so a first-time player learns the mapping without being punished for it. */
  function stepTutorial(dt) {
    if (S.tutorStep <= 1) {
      var wantLeft = S.tutorStep === 0;
      var target = wantLeft ? 0.30 : -0.30;
      var holding = wantLeft ? input.left : input.right;
      var pressingWrong = (wantLeft ? input.right : input.left) && !holding;

      // spring toward the lesson pose normally, toward upright while held
      var goal = holding ? 0 : target;
      var k = holding ? 6.5 : 2.6;
      S.angVel += (goal - S.angle) * k * dt;
      if (pressingWrong) { S.angVel += (wantLeft ? 1 : -1) * PLAYER_TORQUE * 0.3 * dt; }
      S.angVel -= S.angVel * 5.2 * dt;
      S.angle = clamp(S.angle + S.angVel * dt, -0.46, 0.46);
      if (Math.abs(S.angle) > 0.455) { S.angVel = 0; }

      if (holding) { S.tutorHeld += dt; }

      if (pressingWrong) {
        coach(wantLeft ? 'Other side! Hold the LEFT' : 'Other side! Hold the RIGHT', true);
      } else if (holding) {
        coach('That is it. He is straightening up!');
      } else if (wantLeft) {
        coach('Bob is leaning RIGHT, so hold the LEFT side');
      } else {
        coach('Now he leans LEFT, so hold the RIGHT side');
      }

      el.zoneL.classList.toggle('coach', wantLeft && !holding);
      el.zoneR.classList.toggle('coach', !wantLeft && !holding);

      if (S.tutorHeld > 0.5 && Math.abs(S.angle) < 0.12) {
        S.tutorStep++;
        S.tutorHeld = 0;
        S.angVel = 0;
        S.angle = S.tutorStep === 1 ? -0.06 : 0;
        Audio_.play('LevelPassed', 0.5);
        fx.confetti(bobScreenX(), world.groundY - world.bobHeight * 0.6, 30);
      }
    } else {
      S.tutorHeld += dt;
      coach('Perfect. Let go once he is upright!');
      el.zoneL.classList.remove('coach');
      el.zoneR.classList.remove('coach');
      S.angle += (0 - S.angle) * 4 * dt;
      if (S.tutorHeld > 1.6) {
        Store.set('taught', true);
        coach(null);
        el.zoneL.classList.remove('coach');
        el.zoneR.classList.remove('coach');
        startRun();
      }
    }
  }

  function bobScreenX() { return world.w * (world.portrait ? 0.5 : 0.42); }

  function update(dt) {
    var speed = 0;

    if (S.mode === 'play') {
      if (S.countdown) {
        S.countdown.t += dt;
        var stepIdx = Math.floor(S.countdown.t / 0.62);
        if (stepIdx !== S.countdown.step && stepIdx < 3) {
          S.countdown.step = stepIdx;
          Audio_.play('Beep', 0.35);
        }
        if (S.countdown.t >= 1.86) { S.countdown = null; }
      } else {
        S.elapsed += dt;
        stepPhysics(dt);
        speed = lerp(SPEED_MIN, SPEED_MAX, difficulty());
        S.dist += speed * dt;
        el.score.textContent = Math.round(S.dist);

        if (S.milestone < MILESTONES.length && S.dist >= MILESTONES[S.milestone].ft) {
          var ms = MILESTONES[S.milestone];
          S.badge = { word: ms.word, t: 0 };
          S.milestone++;
          Audio_.play('LevelPassed', 0.95);
          Audio_.play(Math.random() < 0.5 ? 'Laugh' : 'Weee', 0.7);
          fx.confetti(world.w * 0.28, world.h * 0.34, 60);
          fx.confetti(world.w * 0.72, world.h * 0.34, 60);
        }
        if (Math.random() < dt * 0.10) { world.jumpDolphin(); }
        if (Math.random() < dt * 0.055) { Audio_.play(Math.random() < 0.5 ? 'Laugh' : 'Weee', 0.35); }
      }
    } else if (S.mode === 'tutorial') {
      stepTutorial(dt);
      speed = SPEED_MIN * 0.8;
    } else if (S.mode === 'falling') {
      S.fallT += dt;
      var k = Math.min(1, S.fallT / 0.52);
      var ease = k * k * (3 - 2 * k);
      S.angle = lerp(S.fallDir * FALL_ANGLE, S.fallDir * 1.44, ease);
      if (S.fallT >= 0.52 && S.fallT - dt < 0.52) {
        Audio_.play('Drop', 0.8);
        S.shake = Math.max(S.shake, 0.55);
        var hx = bobScreenX() + S.fallDir * world.bobHeight * 0.3;
        fx.puff(hx, world.groundY - world.bobHeight * 0.16, 22, world.bobHeight / 420);
      }
      if (S.fallT > 1.25) { gameOver(); }
    } else if (S.mode === 'title') {
      // idle sway on the menu so he is never a still image
      S.angle = Math.sin(S.elapsed * 1.1) * 0.06;
      S.elapsed += dt;
      speed = SPEED_MIN * 0.35;
    }

    // He turns his head toward the side you are holding. The nose keeps its last
    // direction when you let go, so it does not flicker while he coasts.
    if (input.left) { S.noseDir = -1; }
    else if (input.right) { S.noseDir = 1; }

    // legs only cycle while he is actually walking
    if (S.mode === 'play' && !S.countdown) { S.walkPhase = (S.walkPhase + dt * 1.75) % 1; }
    else if (S.mode === 'tutorial' || S.mode === 'title') { S.walkPhase = (S.walkPhase + dt * 1.1) % 1; }

    // head lags behind the body, which is what makes him read as top-heavy
    var headTarget = -S.angVel * 0.16;
    S.headVel += (headTarget - S.headTilt) * 46 * dt;
    S.headVel -= S.headVel * 9 * dt;
    S.headTilt = clamp(S.headTilt + S.headVel * dt, -0.22, 0.22);

    /* The curl is a dangle, the way Character Animator rigs one: a light spring
       with very little damping, pulled by gravity toward whichever way he is
       leaning and thrown the opposite way by any sudden movement. Because it is
       underdamped it keeps wobbling for a moment after he stops. */
    var hairTarget = S.angle * 0.38 - S.angVel * 0.30 - S.headTilt * 0.6;
    if (S.mode === 'play' && !S.countdown) {
      hairTarget += Math.sin(S.walkPhase * Math.PI * 2) * 0.09;
    }
    S.hairVel += (hairTarget - S.hairAngle) * 95 * dt;
    S.hairVel -= S.hairVel * 5.0 * dt;
    S.hairAngle = clamp(S.hairAngle + S.hairVel * dt, -1.2, 1.2);

    if (S.shake > 0) { S.shake = Math.max(0, S.shake - dt * 1.6); }

    // blinking
    S.blinkTimer -= dt;
    if (S.blinkTimer <= 0) { S.blinkTimer = 2.4 + Math.random() * 3.6; S.blink = 1e-4; }
    if (S.blink > 0) {
      S.blink += dt * 9;
      if (S.blink >= 2) { S.blink = 0; }
    }

    if (S.badge) {
      S.badge.t += dt;
      if (S.badge.t > 1.9) { S.badge = null; }
    }

    world.update(dt, speed * 11);
    fx.update(dt);
    updateMeter();
  }

  // ------------------------------------------------------------------ meter

  function updateMeter() {
    if (el.hud.hidden || el.hud.classList.contains('menu')) { return; }
    if (!trackW) { trackW = el.meterTrack.clientWidth; }

    var ratio = clamp(S.angle / FALL_ANGLE, -1, 1);
    var travel = (trackW * 0.5 - 9);
    el.needle.style.transform = 'translateX(' + (ratio * travel).toFixed(1) + 'px)';

    var mag = Math.abs(ratio);
    var caption, urgent = false;
    if (S.mode === 'falling' || S.mode === 'over') { caption = 'Down he goes'; }
    else if (mag < 0.3) { caption = 'Steady'; }
    else if (mag < 0.62) { caption = S.angle > 0 ? 'Leaning right, hold LEFT' : 'Leaning left, hold RIGHT'; }
    else { caption = S.angle > 0 ? 'HOLD LEFT!' : 'HOLD RIGHT!'; urgent = true; }

    if (el.meterCaption.textContent !== caption) { el.meterCaption.textContent = caption; }

    // the coach line only shouts when it matters, so it stays meaningful
    if (S.mode === 'play' && !S.countdown) {
      if (urgent) { coach(S.angle > 0 ? '◀  HOLD LEFT' : 'HOLD RIGHT  ▶', true); }
      else if (S.gustIn >= 0 && !S.badge) {
        coach(S.gustDir > 0 ? 'Gust coming from the left!' : 'Gust coming from the right!');
      }
      else { coach(null); }
    }
  }

  // ----------------------------------------------------------------- render

  function bobPose() {
    var falling = S.mode === 'falling' || S.mode === 'over';
    var mag = clamp(Math.abs(S.angle) / FALL_ANGLE, 0, 1);
    var arm = mag < 0.25 ? 0 : (mag < 0.5 ? 1 : (mag < 0.75 ? 2 : 3));
    var mouth;
    if (falling) { mouth = 'sad'; }
    else if (S.mode === 'title' || S.mode === 'tutorial') { mouth = mag > 0.55 ? 'oh' : 'smile'; }
    else if (mag < 0.34) { mouth = 'smile'; }
    else if (mag < 0.58) { mouth = 'neutral'; }
    else if (mag < 0.8) { mouth = 'oh'; }
    else { mouth = 'wow'; }

    var blinkAmt = falling ? 0 : (S.blink > 0 ? (S.blink < 1 ? S.blink : 2 - S.blink) : 0);
    var lean = S.angle;
    var walking = !falling && ((S.mode === 'play' && !S.countdown) || S.mode === 'tutorial' || S.mode === 'title');
    // He pivots on his feet, so toppling swings his head nearly a body-length
    // sideways. Slide him back by however much the head would overhang, which
    // keeps the landing framed on a narrow phone and a wide desktop alike.
    var x = bobScreenX();
    if (falling) {
      var s = world.bobHeight / bob.rigHeight;
      var headHalf = bob.headWidth * s * 0.5;
      // his head's centre sits 0.66 of his height above his feet
      var headX = x + Math.sin(lean) * 0.66 * world.bobHeight;
      var margin = 10;
      if (headX + headHalf > world.w - margin) { x -= headX + headHalf - (world.w - margin); }
      else if (headX - headHalf < margin) { x += margin - (headX - headHalf); }
    }
    var y = world.groundY;

    // once he is on the sand, pivot around his shoulder rather than his feet
    if (falling && S.fallT > 0) {
      y = world.groundY - Math.min(1, S.fallT / 0.52) * world.bobHeight * 0.02;
    }

    return {
      x: x,
      y: y,
      height: world.bobHeight,
      lean: lean,
      headTilt: falling ? 0 : S.headTilt,
      hair: S.hairAngle,
      walk: walking ? S.walkPhase : null,
      armL: falling ? 3 : (S.angle < -0.08 ? Math.min(3, arm + 1) : arm),
      armR: falling ? 3 : (S.angle > 0.08 ? Math.min(3, arm + 1) : arm),
      mouth: mouth,
      blink: blinkAmt,
      brow: falling ? 1 : mag,
      nose: S.noseDir,
      lookX: falling ? 0 : clamp(S.angle / FALL_ANGLE, -1, 1),
      lookY: falling ? 0.5 : 0,
      squash: 1 + (S.mode === 'play' && !S.countdown ? Math.sin(S.walkPhase * Math.PI * 4) * 0.006 : 0)
    };
  }

  function drawShadow(pose) {
    var w = world.bobHeight * 0.30;
    var lean = Math.min(1.2, Math.abs(pose.lean));
    ctx.save();
    ctx.globalAlpha = 0.20 - lean * 0.07;
    ctx.fillStyle = '#8a6a34';
    ctx.beginPath();
    ctx.ellipse(pose.x + Math.sin(pose.lean) * world.bobHeight * 0.22, world.groundY + world.bobHeight * 0.012,
      w * (1 + lean * 0.35), w * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCountdown() {
    if (!S.countdown) { return; }
    var words = ['READY', 'SET', 'GO!'];
    var i = clamp(Math.floor(S.countdown.t / 0.62) || 0, 0, words.length - 1);
    var local = (S.countdown.t - i * 0.62) / 0.62;
    var scale = 0.7 + (1 - Math.pow(1 - Math.min(1, local * 2.4), 3)) * 0.35;
    var alpha = local > 0.75 ? 1 - (local - 0.75) / 0.25 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(world.w * 0.5, world.h * 0.30);
    ctx.scale(scale, scale);
    var size = Math.min(world.w * 0.17, world.h * 0.16);
    ctx.font = '700 ' + size + 'px OpenDyslexic, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = size * 0.16;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(words[i], 0, 0);
    ctx.fillStyle = i === 2 ? BRAND.pink : BRAND.blue;
    ctx.fillText(words[i], 0, 0);
    ctx.restore();
  }

  function drawBadge() {
    if (!S.badge) { return; }
    var t = S.badge.t;
    var pop = t < 0.22 ? t / 0.22 : 1;
    var out = t > 1.5 ? 1 - (t - 1.5) / 0.4 : 1;
    var size = Math.min(world.w, world.h) * 0.15;
    var x = world.w * 0.5;
    var y = world.h * 0.24;

    ctx.save();
    ctx.globalAlpha = Math.max(0, out);
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 9) * 0.03);
    ctx.scale(0.6 + pop * 0.4, 0.6 + pop * 0.4);

    // comic burst
    ctx.beginPath();
    var spikes = 13;
    for (var i = 0; i < spikes * 2; i++) {
      var r = size * (i % 2 ? 0.72 : 1.05);
      var a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      var px = Math.cos(a) * r * 1.55;
      var py = Math.sin(a) * r;
      if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    }
    ctx.closePath();
    var g = ctx.createLinearGradient(-size, -size, size, size);
    g.addColorStop(0, BRAND.red);
    g.addColorStop(1, BRAND.pink);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = size * 0.075;
    ctx.strokeStyle = BRAND.ink;
    ctx.stroke();

    // longer words like RESPECT! overflowed the burst at a fixed size, so shrink
    // the type until it sits inside the spikes
    var inner = size * 1.85;
    var fs = size * 0.46;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + fs + 'px OpenDyslexic, sans-serif';
    var guard = 0;
    while (ctx.measureText(S.badge.word).width > inner && fs > 6 && guard++ < 60) {
      fs *= 0.93;
      ctx.font = '700 ' + fs + 'px OpenDyslexic, sans-serif';
    }
    ctx.fillStyle = '#fff3a8';
    ctx.fillText(S.badge.word, 0, size * 0.02);
    ctx.restore();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.shake > 0.002) {
      var amp = S.shake * Math.min(world.w, world.h) * 0.022;
      ctx.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }
    world.draw(ctx);

    var pose = bobPose();
    drawShadow(pose);
    bob.draw(ctx, pose);

    fx.draw(ctx);
    drawBadge();
    drawCountdown();
  }

  // ------------------------------------------------------------------- loop

  var last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) { last = now; }
    // a restored tab or an odd timestamp can hand us a backwards or NaN delta;
    // letting that through runs the whole simulation in reverse
    var dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) { dt = 0; }
    if (dt > 0.05) { dt = 0.05; }
    if (S.mode !== 'paused') { update(dt); }
    render();
  }

  // ------------------------------------------------------------- ui wiring

  $('btnPlay').addEventListener('click', function () { Audio_.unlock(); Audio_.play('ButtonClick'); startRun(); });
  $('btnHow').addEventListener('click', function () { Audio_.play('ButtonClick'); S.mode = 'how'; showPanel('how'); updateTiltButton(); });
  $('btnHowBack').addEventListener('click', function () { Audio_.play('ButtonClick'); toTitle(); });
  $('btnTutorial').addEventListener('click', function () { Audio_.unlock(); Audio_.play('ButtonClick'); startTutorial(); });
  $('btnResume').addEventListener('click', function () { Audio_.play('ButtonClick'); resume(); });
  $('btnQuit').addEventListener('click', function () { Audio_.play('ButtonClick'); Audio_.stopMusic(); toTitle(); });
  $('btnAgain').addEventListener('click', function () { Audio_.play('ButtonClick'); startRun(); });
  $('btnMenu').addEventListener('click', function () { Audio_.play('ButtonClick'); toTitle(); });
  $('btnPause').addEventListener('click', function () { Audio_.play('ButtonClick'); pause(); });
  $('btnSound').addEventListener('click', function () { setMuted(!Audio_.muted); Audio_.play('ButtonClick'); });

  $('btnTilt').addEventListener('click', function () {
    Audio_.play('ButtonClick');
    if (S.tiltOn) { disableTilt(); } else { enableTilt(); }
  });

  $('btnFull').addEventListener('click', function () {
    Audio_.play('ButtonClick');
    var d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    } else {
      var e = d.documentElement;
      var fn = e.requestFullscreen || e.webkitRequestFullscreen;
      if (fn) { fn.call(e).catch(function () { toast('Full screen is not available here.'); }); }
      else { toast('Full screen is not available here.'); }
    }
  });

  $('btnShare').addEventListener('click', function () {
    Audio_.play('ButtonClick');
    var feet = Math.round(S.dist);
    var text = 'I walked ' + feet + ' ft in Balance Big Head Bob! Balance. Breathe. Be your best.';
    var url = location.href.split('#')[0];
    if (navigator.share) {
      navigator.share({ title: 'Balance Big Head Bob', text: text, url: url })
        .catch(function () { /* dismissed */ });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + ' ' + url)
        .then(function () { toast('Score copied. Paste it anywhere!'); })
        .catch(function () { toast(text); });
    } else { toast(text); }
  });

  // ------------------------------------------------------------------ boot

  function boot() {
    setMuted(Audio_.muted);
    resize();
    // iOS needs a fresh gesture for permission, so only auto-reattach where it is free
    if (S.tiltOn && window.DeviceOrientationEvent &&
        typeof window.DeviceOrientationEvent.requestPermission !== 'function') {
      window.addEventListener('deviceorientation', onTilt);
    } else if (S.tiltOn) {
      S.tiltOn = false;
    }
    updateTiltButton();

    var total = bob.partCount() + world.artCount();
    var done = 0;
    function step() {
      done++;
      el.loadBar.style.width = Math.round((done / total) * 100) + '%';
    }

    Audio_.load('assets/audio/', ['ButtonClick', 'Drop', 'Falling', 'Laugh',
      'LevelPassed', 'WalkStep', 'Weee', 'Yowwy', 'Beep']);

    // canvas text will silently fall back unless the face is actually requested
    var fonts = Promise.resolve();
    if (document.fonts && document.fonts.load) {
      fonts = Promise.all([
        document.fonts.load('700 48px OpenDyslexic'),
        document.fonts.load('400 20px OpenDyslexic')
      ]).catch(function () {});
    }

    Promise.all([
      bob.load('assets/bob/', step),
      world.loadArt('assets/img/', step),
      fonts
    ]).then(function () {
      resize();
      toTitle();
      requestAnimationFrame(frame);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline play unavailable */ });
      }
    }).catch(function (err) {
      el.panels.load.innerHTML = '<h2>Could not load the game</h2>' +
        '<p class="loading-note">' + String(err.message || err) + '</p>' +
        '<p class="loading-note">Try refreshing the page.</p>';
    });
  }

  boot();
}());
