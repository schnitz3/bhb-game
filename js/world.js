/* The beach.
 *
 * Everything here is drawn from code rather than from fixed-size artwork, so the
 * scene fits a tall phone, a short phone on its side, a tablet and a desktop
 * without letterboxing or a "please rotate your device" wall.
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  function clampNum(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* cheap deterministic noise so scenery is stable frame to frame */
  function hash(n) {
    var x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }

  function World() {
    this.scroll = 0;
    this.t = 0;
    this.sky = null;
    this.skyW = 0;
    this.skyH = 0;
    this.palm = null;
    this.dolphin = null;
    this.dolphinRun = null;
    this.gust = 0;
    this.gustDir = 0;
  }

  World.prototype.loadArt = function (baseUrl, onStep) {
    var self = this;
    function img(src) {
      return new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () { if (onStep) { onStep(); } resolve(im); };
        im.onerror = function () { reject(new Error('missing image: ' + src)); };
        im.src = baseUrl + src;
      });
    }
    return Promise.all([img('palm.png'), img('dolphin.png')]).then(function (r) {
      self.palm = r[0];
      self.dolphin = r[1];
      return self;
    });
  };

  World.prototype.artCount = function () { return 2; };

  /* Vertical layout. Portrait gets a higher horizon so there is room for a very
     tall Bob; short landscape screens keep the sand band thin. */
  World.prototype.layout = function (w, h) {
    if (!(w > 1) || !(h > 1)) { return; }
    var portrait = h > w;
    var shortSide = h < 460;

    this.w = w;
    this.h = h;
    this.portrait = portrait;

    this.horizonY = h * (portrait ? 0.40 : (shortSide ? 0.34 : 0.38));
    this.seaH = h * (portrait ? 0.11 : 0.10);
    this.sandY = this.horizonY + this.seaH;
    this.groundY = h * (portrait ? 0.86 : (shortSide ? 0.90 : 0.88));

    // how tall Bob stands, in pixels — big enough to read on a phone,
    // never so big he collides with the HUD
    var headroom = this.groundY - (this.horizonY * 0.42);
    this.bobHeight = Math.min(headroom, portrait ? w * 0.82 : h * 0.66);
    this.bobHeight = Math.max(120, this.bobHeight);

    this._buildSky();
  };

  World.prototype._buildSky = function () {
    var w = Math.max(1, Math.ceil(this.w));
    var h = Math.max(1, Math.ceil(this.h));
    if (!this.sky) { this.sky = document.createElement('canvas'); }
    this.sky.width = w;
    this.sky.height = h;
    var c = this.sky.getContext('2d');

    var g = c.createLinearGradient(0, 0, 0, this.horizonY);
    g.addColorStop(0, '#1f9fef');
    g.addColorStop(0.55, '#63c4ff');
    g.addColorStop(1, '#cdeeff');
    c.fillStyle = g;
    c.fillRect(0, 0, w, this.horizonY + 1);

    var sea = c.createLinearGradient(0, this.horizonY, 0, this.sandY);
    sea.addColorStop(0, '#8fd8f6');
    sea.addColorStop(0.18, '#2f95d8');
    sea.addColorStop(1, '#1c6fb5');
    c.fillStyle = sea;
    c.fillRect(0, this.horizonY, w, this.seaH + 1);

    var sand = c.createLinearGradient(0, this.sandY, 0, h);
    sand.addColorStop(0, '#f6e6bb');
    sand.addColorStop(0.35, '#f2d99b');
    sand.addColorStop(1, '#e6c079');
    c.fillStyle = sand;
    c.fillRect(0, this.sandY, w, h - this.sandY + 1);

    // wet sand where the water meets the beach
    var foam = c.createLinearGradient(0, this.sandY - 2, 0, this.sandY + this.h * 0.035);
    foam.addColorStop(0, 'rgba(255,255,255,0.85)');
    foam.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = foam;
    c.fillRect(0, this.sandY - 2, w, this.h * 0.035);
  };

  World.prototype.update = function (dt, speed) {
    this.t += dt;
    this.scroll += speed * dt;
    if (this.gust > 0) { this.gust = Math.max(0, this.gust - dt * 1.1); }
    if (this.dolphinRun) {
      this.dolphinRun.t += dt;
      if (this.dolphinRun.t > this.dolphinRun.dur) { this.dolphinRun = null; }
    }
  };

  World.prototype.showGust = function (dir) {
    this.gust = 1;
    this.gustDir = dir;
  };

  World.prototype.jumpDolphin = function () {
    if (this.dolphinRun) { return; }
    this.dolphinRun = {
      t: 0,
      dur: 1.6,
      x: 0.12 + hash(this.t * 3.3) * 0.6,
      flip: hash(this.t * 7.7) > 0.5
    };
  };

  World.prototype.draw = function (ctx) {
    var w = this.w, h = this.h;

    ctx.drawImage(this.sky, 0, 0);

    this._sun(ctx);
    this._sea(ctx);
    this._dolphin(ctx);
    this._clouds(ctx);
    this._boats(ctx);
    this._palms(ctx);
    this._sandDetail(ctx);
    if (this.gust > 0.01) { this._wind(ctx); }
  };

  World.prototype._sun = function (ctx) {
    var x = this.w * 0.86;
    var y = this.horizonY * 0.24;
    var r = Math.min(this.w, this.h) * 0.055;
    var pulse = 1 + Math.sin(this.t * 1.1) * 0.03;

    var glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 4.2);
    glow.addColorStop(0, 'rgba(255,243,170,0.55)');
    glow.addColorStop(1, 'rgba(255,243,170,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 4.2, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#fff3a8';
    ctx.beginPath();
    ctx.arc(x, y, r * pulse, 0, TAU);
    ctx.fill();
  };

  World.prototype._sea = function (ctx) {
    // slow horizontal glints so the water is not a flat band
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.horizonY, this.w, this.seaH);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineCap = 'round';
    for (var i = 0; i < 22; i++) {
      var seed = hash(i * 5.3);
      var y = this.horizonY + this.seaH * (0.12 + hash(i * 2.1) * 0.85);
      var len = this.w * (0.03 + seed * 0.07);
      var drift = (this.t * (6 + seed * 22) + seed * this.w * 3) % (this.w + 240) - 120;
      ctx.globalAlpha = 0.18 + 0.32 * Math.abs(Math.sin(this.t * 0.8 + i));
      ctx.lineWidth = Math.max(1, this.seaH * 0.035);
      ctx.beginPath();
      ctx.moveTo(drift, y);
      ctx.lineTo(drift + len, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  World.prototype._dolphin = function (ctx) {
    var run = this.dolphinRun;
    if (!run || !this.dolphin) { return; }
    var p = run.t / run.dur;
    var frame = Math.min(15, Math.floor(p * 16));
    var sx = (frame % 4) * 256;
    var sy = Math.floor(frame / 4) * 256;
    var size = Math.min(this.w, this.h) * 0.16;
    var x = this.w * run.x;
    var y = this.horizonY + this.seaH * 0.55 - size * 0.5;

    ctx.save();
    ctx.globalAlpha = 0.95;
    if (run.flip) {
      ctx.translate(x + size, y);
      ctx.scale(-1, 1);
      ctx.drawImage(this.dolphin, sx, sy, 256, 256, 0, 0, size, size);
    } else {
      ctx.drawImage(this.dolphin, sx, sy, 256, 256, x, y, size, size);
    }
    ctx.restore();
  };

  World.prototype._clouds = function (ctx) {
    var layers = [
      { p: 0.04, n: 4, y: 0.10, s: 1.35, a: 0.55 },
      { p: 0.09, n: 5, y: 0.20, s: 1.0, a: 0.75 },
      { p: 0.16, n: 4, y: 0.30, s: 0.72, a: 0.9 }
    ];
    var base = Math.min(this.w, this.h);

    for (var l = 0; l < layers.length; l++) {
      var L = layers[l];
      var span = this.w + base * 1.2;
      for (var i = 0; i < L.n; i++) {
        var seed = hash(l * 31.4 + i * 9.7);
        var spacing = span / L.n;
        var x = ((i * spacing + seed * spacing) - this.scroll * L.p) % span;
        if (x < -base * 0.6) { x += span; }
        var y = this.horizonY * (L.y + seed * 0.18);
        this._cloud(ctx, x, y, base * 0.09 * L.s * (0.75 + seed * 0.6), L.a);
      }
    }
  };

  World.prototype._cloud = function (ctx, x, y, r, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, 0, TAU);
    ctx.arc(x + r * 0.8, y - r * 0.28, r * 0.9, 0, TAU);
    ctx.arc(x + r * 1.75, y, r * 0.66, 0, TAU);
    ctx.arc(x + r * 0.85, y + r * 0.34, r * 0.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  World.prototype._boats = function (ctx) {
    var span = this.w * 2.2;
    var size = Math.min(this.w, this.h) * 0.035;
    for (var i = 0; i < 3; i++) {
      var seed = hash(i * 17.3 + 2);
      var x = ((i * span / 3 + seed * span) - this.scroll * 0.05) % span;
      if (x < -size * 3) { x += span; }
      if (x > this.w + size * 3) { continue; }
      var y = this.horizonY + this.seaH * (0.16 + seed * 0.22);
      var bob = Math.sin(this.t * 1.6 + i) * size * 0.08;

      ctx.save();
      ctx.translate(x, y + bob);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.5);
      ctx.lineTo(size * 0.7, 0);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = i % 2 ? '#ff66c4' : '#ff3131';
      ctx.beginPath();
      ctx.moveTo(-size * 0.08, -size * 1.35);
      ctx.lineTo(-size * 0.62, 0);
      ctx.lineTo(-size * 0.08, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#123a5c';
      ctx.fillRect(-size * 0.72, 0, size * 1.5, size * 0.2);
      ctx.restore();
    }
  };

  World.prototype._palms = function (ctx) {
    if (!this.palm) { return; }
    var ar = this.palm.height / this.palm.width;
    var sandDepth = this.groundY - this.sandY;

    /* Palms are sized from where their trunk meets the sand up to a target
       height above the horizon, rather than from the viewport. A phone on its
       side has very little sky, and a fraction-of-height palm would have its
       whole crown off the top of the screen. */
    var rows = [
      { p: 0.32, n: 4, foot: 0.04, top: 0.62, span: 1.7, alpha: 0.5, tint: true },
      { p: 0.8, n: 3, foot: 0.40, top: 0.25, span: 3.0, alpha: 1, tint: false }
    ];

    for (var r = 0; r < rows.length; r++) {
      var R = rows[r];
      var span = this.w * R.span;
      var footY = this.sandY + sandDepth * R.foot;
      // never let a palm grow past the frame, whatever the layout works out to
      var hgt = clampNum(footY - this.horizonY * R.top, 40, this.h * 1.15);
      var wdt = hgt / ar;

      for (var i = 0; i < R.n; i++) {
        var seed = hash(r * 41.9 + i * 6.1);
        var x = ((i * span / R.n + seed * span * 0.7) - this.scroll * R.p) % span;
        if (x < -wdt * 1.5) { x += span; }
        if (x > this.w + wdt) { continue; }
        var sway = Math.sin(this.t * 0.9 + seed * 6) * 0.02 + this.gust * this.gustDir * 0.05;
        var sc = 0.82 + seed * 0.34;

        ctx.save();
        ctx.globalAlpha = R.alpha;
        ctx.translate(x, footY);
        ctx.rotate(sway);
        if (seed > 0.5) { ctx.scale(-1, 1); }
        ctx.drawImage(this.palm, -wdt * sc * 0.5, -hgt * sc, wdt * sc, hgt * sc);
        if (R.tint) {
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = 'rgba(150,205,240,0.45)';
          ctx.fillRect(-wdt * sc, -hgt * sc, wdt * sc * 2, hgt * sc);
        }
        ctx.restore();
      }
    }
  };

  World.prototype._sandDetail = function (ctx) {
    var span = this.w * 1.4;
    var base = Math.min(this.w, this.h);

    // shells and pebbles between the water and the walk line
    for (var i = 0; i < 14; i++) {
      var seed = hash(i * 3.77 + 11);
      var depth = 0.25 + seed * 0.55;
      var x = ((i * span / 14 + seed * span) - this.scroll * (0.4 + depth * 0.5)) % span;
      if (x < -20) { x += span; }
      if (x > this.w + 20) { continue; }
      var y = this.sandY + (this.groundY - this.sandY) * depth;
      var r = base * 0.005 * (0.6 + seed);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = seed > 0.6 ? '#d9b477' : '#cfa96b';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.6, r, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // grass tufts in the very front, moving at full speed to sell the walk
    var tufts = 9;
    var tspan = this.w * 1.25;
    for (var j = 0; j < tufts; j++) {
      var s2 = hash(j * 8.13 + 5);
      var tx = ((j * tspan / tufts + s2 * tspan) - this.scroll * 1.25) % tspan;
      if (tx < -40) { tx += tspan; }
      if (tx > this.w + 40) { continue; }
      var ty = this.h - (this.h - this.groundY) * (0.05 + s2 * 0.45);
      this._tuft(ctx, tx, ty, base * 0.028 * (0.7 + s2 * 0.8), s2);
    }
  };

  World.prototype._tuft = function (ctx, x, y, size, seed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#5fb84f';
    ctx.lineWidth = Math.max(1.5, size * 0.13);
    ctx.lineCap = 'round';
    for (var b = 0; b < 5; b++) {
      var a = (-0.7 + b * 0.35) + Math.sin(this.t * 1.7 + seed * 9 + b) * 0.09
        + this.gust * this.gustDir * 0.25;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.sin(a) * size * 0.5, -size * 0.6,
        Math.sin(a) * size * 1.15, -size * (0.85 + (b % 2) * 0.25));
      ctx.stroke();
    }
    ctx.restore();
  };

  World.prototype._wind = function (ctx) {
    var g = this.gust;
    var dir = this.gustDir;
    ctx.save();
    ctx.globalAlpha = g * 0.55;
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    for (var i = 0; i < 11; i++) {
      var seed = hash(i * 12.9 + 3);
      var y = this.horizonY * 0.25 + (this.groundY - this.horizonY * 0.25) * seed;
      var len = this.w * (0.12 + seed * 0.26);
      var travel = (1 - g) * this.w * 1.5;
      var x = dir > 0 ? -len + travel + seed * this.w * 0.3
        : this.w + len - travel - seed * this.w * 0.3;
      ctx.lineWidth = Math.max(1.5, this.h * 0.006 * (0.5 + seed));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + dir * len * 0.5, y - this.h * 0.02 * (seed - 0.5),
        x + dir * len, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------------- FX */

  function FX() {
    this.parts = [];
  }

  FX.prototype.confetti = function (x, y, n) {
    var colors = ['#38b6ff', '#ff3131', '#cb6ce6', '#ff66c4', '#ffd23f', '#7ed957'];
    for (var i = 0; i < n; i++) {
      var a = -Math.PI * 0.5 + (Math.random() - 0.5) * 2.2;
      var sp = 220 + Math.random() * 420;
      this.parts.push({
        kind: 'confetti',
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 14,
        size: 6 + Math.random() * 9,
        color: colors[(Math.random() * colors.length) | 0],
        life: 1.4 + Math.random() * 1.1,
        age: 0
      });
    }
  };

  FX.prototype.puff = function (x, y, n, scale) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var sp = 40 + Math.random() * 190;
      this.parts.push({
        kind: 'puff',
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6 - 40,
        size: (8 + Math.random() * 20) * (scale || 1),
        life: 0.5 + Math.random() * 0.5,
        age: 0
      });
    }
  };

  FX.prototype.update = function (dt) {
    for (var i = this.parts.length - 1; i >= 0; i--) {
      var p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'confetti') {
        p.vy += 900 * dt;
        p.vx *= 0.99;
        p.rot += p.spin * dt;
      } else {
        p.vy += 120 * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.size += 34 * dt;
      }
    }
  };

  FX.prototype.draw = function (ctx) {
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      var k = 1 - p.age / p.life;
      ctx.save();
      if (p.kind === 'confetti') {
        ctx.globalAlpha = Math.min(1, k * 2.2);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size * 0.5, -p.size * 0.28, p.size, p.size * 0.56);
      } else {
        ctx.globalAlpha = k * 0.6;
        ctx.fillStyle = '#fff6e2';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  FX.prototype.clear = function () { this.parts.length = 0; };

  global.World = World;
  global.FX = FX;
}(window));
