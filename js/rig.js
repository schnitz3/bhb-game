/* Bob's puppet rig.
 *
 * Every piece was composited out of the character PSD on one shared canvas and
 * then cropped, so rig.json holds each piece's position in a single "rig space".
 * Drawing them at those coordinates reassembles Bob exactly; animating means
 * rotating individual pieces around joints we derive from the same coordinates.
 */
(function (global) {
  'use strict';

  var PARTS = [
    'face', 'hair', 'nose', 'eyeL', 'eyeR', 'pupilL', 'pupilR', 'blinkL', 'blinkR',
    'browL', 'browR',
    'mouthSmile', 'mouthNeutral', 'mouthOh', 'mouthWow', 'mouthSad',
    'torso', 'legL', 'legR',
    'armL0', 'armL1', 'armL2', 'armL3',
    'armR0', 'armR1', 'armR2', 'armR3'
  ];

  var MOUTHS = {
    smile: 'mouthSmile',
    neutral: 'mouthNeutral',
    oh: 'mouthOh',
    wow: 'mouthWow',
    sad: 'mouthSad'
  };

  function BobRig() {
    this.img = {};
    this.m = null;
    this.ready = false;
  }

  BobRig.prototype.load = function (baseUrl, onStep) {
    var self = this;
    return fetch(baseUrl + 'rig.json')
      .then(function (r) { return r.json(); })
      .then(function (manifest) {
        self.m = manifest;
        return Promise.all(PARTS.map(function (name) {
          return new Promise(function (resolve, reject) {
            var im = new Image();
            im.onload = function () {
              self.img[name] = im;
              if (onStep) { onStep(); }
              resolve();
            };
            im.onerror = function () { reject(new Error('missing sprite: ' + name)); };
            im.src = baseUrl + name + '.png';
          });
        }));
      })
      .then(function () {
        self._deriveJoints();
        self.ready = true;
        return self;
      });
  };

  BobRig.prototype.partCount = function () { return PARTS.length; };

  /* Joints are read off the artwork rather than hand-tuned, so re-exporting the
     PSD at a different scale keeps everything lined up. */
  BobRig.prototype._deriveJoints = function () {
    var m = this.m;
    var legL = m.legL, legR = m.legR, torso = m.torso, face = m.face, hair = m.hair;

    // topCx is the centre of each part's top edge, measured off the artwork, so
    // the hips land on the trouser tops rather than on the bounding boxes (the
    // shoes stick out sideways and would drag the pivot off-centre).
    this.hipL = { x: legL.x + legL.topCx, y: legL.y + 4 };
    this.hipR = { x: legR.x + legR.topCx, y: legR.y + 4 };

    // stand Bob on the lowest point of his shoes, centred between his hips
    this.feetY = Math.max(legL.y + legL.h, legR.y + legR.h);
    this.centreX = (this.hipL.x + this.hipR.x) * 0.5;

    // the neck: top-centre of the torso, where the head sits
    this.neck = { x: torso.x + torso.topCx, y: torso.y + torso.h * 0.06 };

    // the curl roots into the scalp at the bottom of its own artwork
    this.hairRoot = { x: hair.x + hair.botCx, y: hair.y + hair.h };

    this.shoulderL = { x: m.armL0.x + 2, y: m.armL0.y + 6 };
    this.shoulderR = { x: m.armR0.x + m.armR0.w - 2, y: m.armR0.y + 6 };

    // the nose is drawn off-centre; mirroring it across this line turns his head
    this.faceCx = face.x + face.w * 0.5;

    this.topY = Math.min(face.y, hair.y, torso.y);
    this.rigHeight = this.feetY - this.topY;
    this.headWidth = face.w;
  };

  BobRig.prototype._blit = function (ctx, name, dx, dy) {
    var p = this.m[name];
    if (!p) { return; }
    ctx.drawImage(this.img[name], p.x + (dx || 0), p.y + (dy || 0), p.w, p.h);
  };

  BobRig.prototype._rotateAbout = function (ctx, pivot, angle, fn) {
    ctx.save();
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(angle);
    ctx.translate(-pivot.x, -pivot.y);
    fn();
    ctx.restore();
  };

  /* pose:
   *   x, y        where his feet touch the ground, in canvas pixels
   *   height      feet-to-crown height in canvas pixels
   *   lean        body rotation, radians (positive tips to his right / screen right)
   *   headTilt    extra head rotation on top of lean, radians
   *   walk        walk-cycle phase, 0..1 (null or negative freezes the legs)
   *   armL, armR  0..3, how far each arm is thrown out
   *   mouth       'smile' | 'neutral' | 'oh' | 'wow' | 'sad'
   *   blink       0..1, how closed the eyes are
   *   lookX/lookY -1..1 pupil drift
   *   nose        >0 mirrors the nose across the face, turning his head
   *   squash      1 = normal, >1 stretches him taller
   *   alpha       0..1
   */
  BobRig.prototype.draw = function (ctx, pose) {
    if (!this.ready) { return; }

    var scale = pose.height / this.rigHeight;
    var walk = (pose.walk == null || pose.walk < 0) ? null : pose.walk;
    var swing = walk == null ? 0 : Math.sin(walk * Math.PI * 2);
    var lift = walk == null ? 0 : Math.abs(Math.cos(walk * Math.PI * 2));
    var squash = pose.squash == null ? 1 : pose.squash;

    ctx.save();
    if (pose.alpha != null && pose.alpha < 1) { ctx.globalAlpha = pose.alpha; }
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.lean || 0);
    ctx.scale(scale / squash, scale * squash);
    // bounce the whole body a touch on each step
    ctx.translate(-this.centreX, -this.feetY - (walk == null ? 0 : lift * 5));

    var self = this;

    // --- legs, behind everything: they pivot at the hips ---
    // The puppet stands with its shoes splayed outward, which reads as a stance
    // rather than a walk. Mirroring the screen-left leg about its own hip points
    // both feet the way he is travelling.
    this._rotateAbout(ctx, this.hipL, swing * 0.33, function () {
      self._blit(ctx, 'legL');
    });
    this._rotateAbout(ctx, this.hipR, -swing * 0.33, function () {
      ctx.translate(self.hipR.x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-self.hipR.x, 0);
      self._blit(ctx, 'legR');
    });

    // --- arms ---
    // The far arm tucks under the jacket and the near one sits over it. That
    // asymmetry is what stops him reading as a flat, dead-on cut-out.
    var aL = Math.max(0, Math.min(3, Math.round(pose.armL || 0)));
    var aR = Math.max(0, Math.min(3, Math.round(pose.armR || 0)));
    this._rotateAbout(ctx, this.shoulderL, -swing * 0.12, function () {
      self._blit(ctx, 'armL' + aL);
    });

    this._blit(ctx, 'torso');

    this._rotateAbout(ctx, this.shoulderR, swing * 0.12, function () {
      self._blit(ctx, 'armR' + aR);
    });

    // --- head, hinged at the neck so it lags behind the body ---
    this._rotateAbout(ctx, this.neck, pose.headTilt || 0, function () {
      var nod = walk == null ? 0 : lift * 3;
      self._blit(ctx, 'face', 0, -nod);
      self._drawFace(ctx, pose, -nod);
      // the curl swings on its own, a beat behind the head
      ctx.save();
      ctx.translate(0, -nod);
      self._rotateAbout(ctx, self.hairRoot, pose.hair || 0, function () {
        self._blit(ctx, 'hair');
      });
      ctx.restore();
    });

    ctx.restore();
  };

  BobRig.prototype._drawFace = function (ctx, pose, dy) {
    var self = this;
    var blink = Math.max(0, Math.min(1, pose.blink || 0));

    // Mirroring the nose across the centre of the face both flips the curve and
    // moves it to the other side, which reads as his head turning that way.
    if (pose.nose > 0) {
      ctx.save();
      ctx.translate(this.faceCx, 0);
      ctx.scale(-1, 1);
      ctx.translate(-this.faceCx, 0);
      this._blit(ctx, 'nose', 0, dy);
      ctx.restore();
    } else {
      this._blit(ctx, 'nose', 0, dy);
    }
    var lookX = Math.max(-1, Math.min(1, pose.lookX || 0)) * 13;
    var lookY = Math.max(-1, Math.min(1, pose.lookY || 0)) * 9;

    this._blit(ctx, 'eyeL', 0, dy);
    this._blit(ctx, 'eyeR', 0, dy);

    if (blink < 0.96) {
      // squeeze the pupils toward the lids as the eyes close
      var open = 1 - blink;
      var pl = this.m.pupilL, pr = this.m.pupilR;
      ctx.save();
      ctx.globalAlpha = (ctx.globalAlpha) * Math.min(1, open * 2.2);
      ctx.drawImage(this.img.pupilL, pl.x + lookX, pl.y + dy + lookY + (1 - open) * pl.h * 0.3,
        pl.w, pl.h * Math.max(0.05, open));
      ctx.drawImage(this.img.pupilR, pr.x + lookX, pr.y + dy + lookY + (1 - open) * pr.h * 0.3,
        pr.w, pr.h * Math.max(0.05, open));
      ctx.restore();
    }

    if (blink > 0.04) {
      ctx.save();
      ctx.globalAlpha = ctx.globalAlpha * blink;
      this._blit(ctx, 'blinkL', 0, dy);
      this._blit(ctx, 'blinkR', 0, dy);
      ctx.restore();
    }

    // worried faces pull the brows down and together
    var worry = pose.brow || 0;
    var bl = this.m.browL, br = this.m.browR;
    ctx.save();
    ctx.translate(0, dy);
    this._rotateAbout(ctx, { x: bl.x + bl.w, y: bl.y }, worry * 0.42, function () {
      ctx.drawImage(self.img.browL, bl.x, bl.y + worry * 22, bl.w, bl.h);
    });
    this._rotateAbout(ctx, { x: br.x, y: br.y }, -worry * 0.42, function () {
      ctx.drawImage(self.img.browR, br.x, br.y + worry * 22, br.w, br.h);
    });
    ctx.restore();

    this._blit(ctx, MOUTHS[pose.mouth] || 'mouthSmile', 0, dy);
  };

  /* Where Bob's head sits right now, in canvas pixels — used to park speech
     bubbles and milestone badges without them colliding with his face. */
  BobRig.prototype.headTop = function (pose) {
    var scale = pose.height / this.rigHeight;
    return {
      x: pose.x - (this.centreX - (this.m.face.x + this.m.face.w * 0.5)) * scale,
      y: pose.y - (this.feetY - this.m.face.y) * scale,
      w: this.m.face.w * scale
    };
  };

  global.BobRig = BobRig;
}(window));
