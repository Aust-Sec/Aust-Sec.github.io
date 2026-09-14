/* ==========================================================================
   AUSTSec · 主脚本
   --------------------------------------------------------------------------
   1. 背景三层结构（远景 dust / 主体 topology core / 近景 fragment）+ 视差
   2. 主体"姿态系统"：始终保持完整球体，只做轻微拉伸、扭转与呼吸。
      页面变化时保留同一张拓扑网络，不再突变成簇、螺旋或雷达盘。
   3. 节点 currentPosition → lerp → targetPosition，慢速过渡到新姿态。
   4. 分屏叙事（桌面） / 原生滚动（移动端）双布局，共用同一套视觉系统。
   5. 逐字揭示 / 自绘光标 / 遥测 HUD / 二维码弹层
   零依赖、无构建，直接丢 GitHub Pages 就能跑。
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  /* ----------------------------------------------------------------------
     dt 归一化
     ---------------------------------------------------------------------- */
  var BASE = 1000 / 60;
  function dtAlpha(alpha60, dt) {
    return 1 - Math.pow(1 - alpha60, dt / BASE);
  }
  function dtPow(factor60, dt) {
    return Math.pow(factor60, dt / BASE);
  }

  /* ======================================================================
     1. 逐字切分
     ====================================================================== */
  function splitChars(el) {
    if (!el || el.dataset.split === 'done') return [];
    var inners = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var texts = [];
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue.trim()) texts.push(walker.currentNode);
    }
    texts.forEach(function (node) {
      var frag = document.createDocumentFragment();
      Array.from(node.nodeValue).forEach(function (ch) {
        if (ch === ' ' || ch === '\u00a0' || ch === '\t') {
          frag.appendChild(document.createTextNode(ch));
          return;
        }
        var outer = document.createElement('span');
        outer.className = 'ch';
        var inner = document.createElement('span');
        inner.className = 'ch-in';
        inner.textContent = ch;
        outer.appendChild(inner);
        frag.appendChild(outer);
        inners.push(inner);
      });
      node.parentNode.replaceChild(frag, node);
    });
    el.dataset.split = 'done';
    return inners;
  }

  /* ======================================================================
     2. 背景：三层 + 连续姿态系统
     ----------------------------------------------------------------------
     远景 dust      —— 只做 2px 视差
     主体 core      —— 同一张球面拓扑，按屏轻微调整姿态，视差 8px
     近景 fragment  —— 偶尔掠过的碎片，视差 20px
     ====================================================================== */
  function initNetwork() {
    var cvs = document.getElementById('net');
    if (!cvs) return;
    var ctx = cvs.getContext('2d');
    if (!ctx) return;

    var W = 0, H = 0, cx = 0, cy = 0, R = 0;
    var core = [], dust = [], frag = [];
    var mouse = { x: 0, y: 0 };
    var yaw = 0, yawTarget = 0, pitch = -0.20, pitchTarget = -0.20;
    var visible = true;

    var COUNT = 300;
    var DUST_N = 90;
    var FRAG_N = 16;
    var FOCAL = 2.6;

    /* ---- 姿态定义 ----
       名称沿用原场景键，避免改动导航逻辑；实际轮廓都保持为同一个球体。
       页面变化只改变球体的姿态，而不是把它变成另一件东西。 */
    var TARGET_SHAPES = ['sphere', 'ellipsoid', 'clusters', 'helix', 'radar'];
    var targets = { sphere: [], ellipsoid: [], clusters: [], helix: [], radar: [] };
    var edges = [];

    var CLUSTERS = 4;

    /* 场景状态（由分屏/滚动逻辑驱动） */
    var orb = { x: 50, y: 52, r: 0.40, o: 1 };
    var orbT = { x: 50, y: 52, r: 0.40, o: 1 };
    var mode = 'sphere';
    var shapePhase = 0;

    /* ---------- 每个点属于哪个簇 ---------- */
    function clusterOf(i) {
      return Math.min(CLUSTERS - 1, Math.floor(i / COUNT * CLUSTERS));
    }

    /* ---------- 布点 ---------- */
    function build() {
      core = [];
      var golden = Math.PI * (3 - Math.sqrt(5));
      for (var i = 0; i < COUNT; i++) {
        var y = 1 - (i / (COUNT - 1)) * 2;
        var r = Math.sqrt(Math.max(0, 1 - y * y));
        var th = golden * i;
        var bx = Math.cos(th) * r, by = y, bz = Math.sin(th) * r;
        core.push({
          id: i,
          bx: bx, by: by, bz: bz,         // 球面基准
          x: bx, y: by, z: bz,            // 当前动画位置（初始 = sphere）
          sx: 0, sy: 0, scale: 1, depth: 0,
          hot: i % 41 === 0,
          cluster: clusterOf(i)
        });
      }
      computeTargets();
      computeEdges();
      dust = [];
      for (var d = 0; d < DUST_N; d++) {
        dust.push({
          x: Math.random() * 2 - 1,
          y: Math.random() * 2 - 1,
          z: Math.random() * 0.6 + 0.4,
          s: Math.random() * 1.1 + 0.3,
          a: Math.random() * 0.30 + 0.08
        });
      }
      frag = [];
      for (var f = 0; f < FRAG_N; f++) frag.push(spawnFrag(true));
    }

    function spawnFrag(anywhere) {
      return {
        x: anywhere ? Math.random() * 2 - 1 : -1.3,
        y: Math.random() * 1.6 - 0.8,
        z: Math.random() * 0.5 + 0.6,
        v: Math.random() * 0.0016 + 0.0009,
        len: Math.random() * 60 + 30,
        a: Math.random() * 0.22 + 0.06
      };
    }

    /* ---------- 一次性计算所有姿态 ---------- */
    function computeTargets() {
      for (var i = 0; i < COUNT; i++) {
        var p = core[i];
        targets.sphere[i] = { x: p.bx, y: p.by, z: p.bz };
        // ABOUT：轻微横向展开。
        targets.ellipsoid[i] = { x: p.bx * 1.045, y: p.by * 0.985, z: p.bz * 1.02 };

        // FIELD：沿纬度产生很浅的起伏，外轮廓仍然完整。
        var bloom = 1 + Math.sin(p.by * Math.PI * 2.5) * 0.026;
        targets.clusters[i] = { x: p.bx * bloom, y: p.by * 0.995, z: p.bz * bloom };

        // START：不同纬度轻微扭转，形成流动感，而不是收成一根螺旋。
        var twist = p.by * 0.18;
        var ct = Math.cos(twist), st = Math.sin(twist);
        targets.helix[i] = {
          x: p.bx * ct - p.bz * st,
          y: p.by,
          z: p.bx * st + p.bz * ct
        };

        // SIGNAL：略微纵向聚焦，保持球体与网络的连续性。
        targets.radar[i] = { x: p.bx * 0.975, y: p.by * 1.035, z: p.bz * 1.01 };
      }
    }

    /* ---------- 只计算一次拓扑；换页时连线不重新洗牌 ---------- */
    function computeEdges() {
      edges = [];
      var LINK_DIST = 0.40;
      var LD2 = LINK_DIST * LINK_DIST;
      for (var i = 0; i < COUNT; i++) {
        var a = core[i];
        for (var j = i + 1; j < COUNT; j++) {
          var b = core[j];
          var dx = a.bx - b.bx, dy = a.by - b.by, dz = a.bz - b.bz;
          var d2 = dx * dx + dy * dy + dz * dz;
          if (d2 <= LD2) {
            edges.push([i, j, 1 - Math.sqrt(d2) / LINK_DIST]);
          }
        }
      }
    }

    /* ---------- 场景目标（单向数据流） ---------- */
    function setOrbTarget(x, y, r, o) {
      orbT.x = x; orbT.y = y; orbT.r = r; orbT.o = o;
    }

    function setMode(m) {
      if (m === 'gather') m = 'sphere';
      mode = TARGET_SHAPES.indexOf(m) >= 0 ? m : 'sphere';
    }

    /* ---------- 尺寸 ---------- */
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      cvs.width = Math.round(W * dpr);
      cvs.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      applyOrb(true);
      ctx.fillStyle = '#030506';
      ctx.fillRect(0, 0, W, H);
    }

    function applyOrb(instant, dt) {
      var t = instant ? 1 : dtAlpha(0.055, dt);
      orb.x = lerp(orb.x, orbT.x, t);
      orb.y = lerp(orb.y, orbT.y, t);
      orb.r = lerp(orb.r, orbT.r, t);
      orb.o = lerp(orb.o, orbT.o, t);

      cx = W * (orb.x / 100);
      cy = H * (orb.y / 100);
      R = Math.min(W, H) * orb.r;
      if (W < 760) R = Math.min(R, H * 0.40);

      orbVarTick = (orbVarTick + 1) % 8;
      if (orbVarTick === 0) {
        var rs = document.documentElement.style;
        rs.setProperty('--orb-x', orb.x.toFixed(2));
        rs.setProperty('--orb-y', orb.y.toFixed(2));
      }
    }
    var orbVarTick = 0;

    /* ---------- 投影 + 姿态插值 ---------- */
    function project(dt) {
      var aMode = dtAlpha(0.024, dt);
      var cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      var cosX = Math.cos(pitch), sinX = Math.sin(pitch);
      var tgt = targets[mode] || targets.sphere;
      shapePhase += 0.00042 * dt;
      var breath = 1 + Math.sin(shapePhase) * 0.010;

      for (var i = 0; i < COUNT; i++) {
        var p = core[i];
        var tt = tgt[i];
        p.x = lerp(p.x, tt.x, aMode);
        p.y = lerp(p.y, tt.y, aMode);
        p.z = lerp(p.z, tt.z, aMode);

        /* 连续、低幅度的有机呼吸；使用空间坐标而不是节点序号，
           相邻点会一起运动，不会出现毛刺或“融化”的轮廓。 */
        var local = breath * (1 + Math.sin(shapePhase * 0.72 + p.y * 2.7 + p.z * 1.3) * 0.0045);
        var qx = p.x * local, qy = p.y * local, qz = p.z * local;

        var x1 = qx * cosY - qz * sinY;
        var z1 = qx * sinY + qz * cosY;
        var y1 = qy * cosX - z1 * sinX;
        var z2 = qy * sinX + z1 * cosX;

        var sc = FOCAL / (FOCAL + z2);
        p.sx = cx + x1 * R * sc;
        p.sy = cy + y1 * R * sc;
        p.scale = sc;
        p.depth = z2;
      }
    }

    /* ---------- 三层绘制 ---------- */
    function drawDust(px, py) {
      for (var i = 0; i < DUST_N; i++) {
        var d = dust[i];
        var x = (d.x * 0.5 + 0.5) * W + px * 0.12;
        var y = (d.y * 0.5 + 0.5) * H + py * 0.12;
        ctx.fillStyle = 'rgba(242,244,245,' + (d.a * 0.5).toFixed(3) + ')';
        ctx.fillRect(x, y, d.s, d.s);
      }
    }

    function drawLinks(alphaMul) {
      ctx.lineWidth = 1;
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var a = core[e[0]], b = core[e[1]];
        var alpha = e[2] * 0.20 * alphaMul;
        alpha *= (1 - (a.depth + b.depth) * 0.25);
        if (alpha <= 0.010) continue;
        ctx.strokeStyle = 'rgba(242,244,245,' + alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    }

    /* ---------- FIELD 联动：hover 模块 → 点亮对应簇 ---------- */
    var pulseGroup = -1;      // -1 无；0..3 对应 CTF / SRC / SECURITY / SIGNAL
    var pulseAmt = 0, pulseAmtT = 0;

    function drawCore(t, dt) {
      pulseAmt = lerp(pulseAmt, pulseAmtT, dtAlpha(0.09, dt || BASE));

      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < COUNT; i++) {
        var p = core[i];
        var depthFade = 1 - (p.depth + 1) * 0.5;
        var size = (0.75 + p.scale * 0.95) * (0.6 + depthFade * 0.8);
        var alpha = 0.10 + depthFade * 0.44;

        var inGroup = pulseGroup >= 0 && p.cluster === pulseGroup;
        var boost = inGroup ? pulseAmt : 0;

        if (p.hot || boost > 0.02) {
          var pulse = 0.5 + 0.5 * Math.sin(t * 0.0012 + i);
          var rad = 26 + pulse * 12 + boost * 10;
          var gr = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad);
          if (boost > 0.02) {
            gr.addColorStop(0, 'rgba(130,233,255,' + (0.20 + pulse * 0.10 + boost * 0.20).toFixed(3) + ')');
            gr.addColorStop(0.35, 'rgba(41,109,255,' + (0.08 + boost * 0.10).toFixed(3) + ')');
          } else {
            gr.addColorStop(0, 'rgba(130,233,255,' + (0.34 + pulse * 0.22).toFixed(3) + ')');
            gr.addColorStop(0.35, 'rgba(41,109,255,' + (0.13 + pulse * 0.08).toFixed(3) + ')');
          }
          gr.addColorStop(1, 'rgba(41,109,255,0)');
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(200,245,255,' + (0.88 * Math.min(1, alpha + boost * 0.5)).toFixed(3) + ')';
          size *= 1.5 + boost * 0.35;
        } else {
          ctx.fillStyle = 'rgba(242,244,245,' + (alpha + boost * 0.2).toFixed(3) + ')';
        }
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawFrag(px, py, dt) {
      var step = dt / BASE;
      for (var i = 0; i < FRAG_N; i++) {
        var f = frag[i];
        f.x += f.v * step;
        if (f.x > 1.3) frag[i] = spawnFrag(false);
        var x = (f.x * 0.5 + 0.5) * W + px * 0.5;
        var y = (f.y * 0.5 + 0.5) * H + py * 0.5;
        ctx.strokeStyle = 'rgba(180,235,255,' + f.a.toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - f.len, y + f.len * 0.16);
        ctx.stroke();
      }
    }

    /* ---------- 主循环 ---------- */
    var last = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible) return;
      var dt = Math.min(48, now - last);
      if (dt < 12) return;
      last = now;

      var t = now;
      applyOrb(false, dt);

      if (!reduceMotion) {
        yaw += 0.00045 * dt;
        yaw += (yawTarget - yaw) * dtAlpha(0.014, dt);
        pitch += (pitchTarget - pitch) * dtAlpha(0.022, dt);
        yawTarget *= dtPow(0.985, dt);
        pitchTarget += (-0.20 - pitchTarget) * dtAlpha(0.007, dt);
      }

      project(dt);

      ctx.globalCompositeOperation = 'source-over';
      var fade = reduceMotion ? 1 : 1 - dtPow(1 - 0.34, dt);
      ctx.fillStyle = 'rgba(3,5,6,' + (reduceMotion ? 1 : fade).toFixed(4) + ')';
      ctx.fillRect(0, 0, W, H);

      var px = (mouse.x - 0.5) * 2, py = (mouse.y - 0.5) * 2;
      drawDust(px, py);
      ctx.globalAlpha = orb.o;
      drawLinks(1);
      drawCore(t, dt);
      ctx.globalAlpha = 1;
      drawFrag(px, py, dt);
    }

    /* ---------- 交互 ---------- */
    window.addEventListener('pointermove', function (e) {
      mouse.x = e.clientX / window.innerWidth;
      mouse.y = e.clientY / window.innerHeight;
      yawTarget = (mouse.x - 0.5) * 0.55;
      pitchTarget = -0.20 + (mouse.y - 0.5) * 0.30;
    }, { passive: true });

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt); rt = setTimeout(resize, 140);
    });
    document.addEventListener('visibilitychange', function () {
      visible = !document.hidden;
    });

    build();
    resize();

    if (reduceMotion) {
      yaw = 0.7;
      project(1000);
      ctx.fillStyle = '#030506'; ctx.fillRect(0, 0, W, H);
      drawLinks(1); drawCore(0, BASE);
      return;
    }
    requestAnimationFrame(frame);

    window.__austOrb = {
      setMode: setMode,
      resize: resize,
      setTarget: setOrbTarget,
      pulse: function (group) {
        pulseGroup = group;
        pulseAmtT = group >= 0 ? 1 : 0;
      },
      debug: function () {
        return {
          orb: { x: orb.x, y: orb.y, r: orb.r, o: orb.o },
          orbT: { x: orbT.x, y: orbT.y, r: orbT.r, o: orbT.o },
          mode: mode,
          cx: cx, cy: cy, R: R, W: W, H: H
        };
      }
    };
  }

  /* ======================================================================
     3. 场景定义 + 分屏叙事 / 原生滚动
     ----------------------------------------------------------------------
     桌面：全屏分屏，滚轮 / 触摸 / 方向键 / 刻度翻页。
     移动端：原生纵向滚动，背景 Canvas 固定，滚动时用 IntersectionObserver
     切换姿态；同一套视觉系统，两套构图。
     ====================================================================== */
  var SCENES = {
    //        x%   y%   半径   不透明度  姿态
    top:      { x: 78, y: 52, r: 0.30, o: 0.88, mode: 'sphere'    },
    about:    { x: 86, y: 53, r: 0.29, o: 0.70, mode: 'ellipsoid' },
    whatwedo: { x: 82, y: 51, r: 0.30, o: 0.62, mode: 'clusters'  },
    start:    { x: 80, y: 50, r: 0.30, o: 0.60, mode: 'helix'     },
    signal:   { x: 77, y: 50, r: 0.31, o: 0.68, mode: 'radar'     },
    join:     { x: 68, y: 49, r: 0.32, o: 0.80, mode: 'gather'    }
  };

  /* 移动端：保持球体居中略沉，切页只做几像素级漂移。 */
  var SCENES_MOBILE = {
    top:      { x: 50, y: 72, r: 0.46, o: 0.78, mode: 'sphere'    },
    about:    { x: 52, y: 73, r: 0.40, o: 0.44, mode: 'ellipsoid' },
    whatwedo: { x: 49, y: 72, r: 0.40, o: 0.40, mode: 'clusters'  },
    start:    { x: 51, y: 73, r: 0.39, o: 0.38, mode: 'helix'     },
    signal:   { x: 49, y: 72, r: 0.41, o: 0.44, mode: 'radar'     },
    join:     { x: 50, y: 70, r: 0.42, o: 0.54, mode: 'gather'    }
  };

  // HUD 只在特定场景出现（桌面）
  var HUD_SCENES = { top: 1, whatwedo: 1, signal: 1 };

  function initBeats() {
    var beats = Array.prototype.slice.call(document.querySelectorAll('.beat'));
    if (!beats.length) return;

    var root = document.documentElement;
    var marks = Array.prototype.slice.call(document.querySelectorAll('.mark'));
    var railProgress = document.getElementById('railProgress');
    var beatNow = document.getElementById('beatNow');
    var overlay = document.getElementById('overlay');
    var toggle = document.getElementById('navToggle');
    var closeBtn = document.getElementById('overlayClose');
    var current = 0, busy = false;

    var mq = window.matchMedia('(max-width: 820px)');
    var isMobile = mq.matches;

    function sceneFor(id) {
      var set = isMobile ? SCENES_MOBILE : SCENES;
      return set[id] || set.top;
    }

    // 预切字（桌面逐字揭示用；移动端由 CSS 强制全部可见）
    var kineticCache = beats.map(function (b) {
      var heads = Array.prototype.slice.call(b.querySelectorAll('.display'));
      var inners = [];
      heads.forEach(function (h) {
        if (h.dataset.kinetic !== undefined) inners = inners.concat(splitChars(h));
      });
      return inners;
    });
    var played = beats.map(function () { return false; });

    function applyScene(id) {
      var s = sceneFor(id);
      if (window.__austOrb && window.__austOrb.setTarget) {
        window.__austOrb.setTarget(s.x, s.y, s.r, s.o);
      } else {
        root.style.setProperty('--orb-x', String(s.x));
        root.style.setProperty('--orb-y', String(s.y));
        root.style.setProperty('--orb-r', String(s.r));
        root.style.setProperty('--orb-o', String(s.o));
      }
      if (window.__austOrb) window.__austOrb.setMode(s.mode);
    }

    function play(i) {
      if (played[i]) return;
      played[i] = true;
      var inners = kineticCache[i];
      if (reduceMotion) { beats[i].classList.add('is-in'); return; }

      var spread = Math.min(0.030 * inners.length, 0.62);
      var stagger = inners.length > 1 ? spread / (inners.length - 1) : 0;
      inners.forEach(function (inner, k) {
        inner.style.transitionDelay = (110 + k * stagger * 1000) + 'ms';
      });
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { beats[i].classList.add('is-in'); });
      });
      Array.prototype.slice.call(beats[i].querySelectorAll('.rise')).forEach(function (el, k) {
        el.style.transitionDelay = (140 + k * 80) + 'ms';
        el.classList.add('is-in');
      });
    }

    function setActive(i) {
      beats.forEach(function (b, k) {
        b.classList.toggle('is-active', k === i);
        b.classList.toggle('is-past', k < i);
      });
      marks.forEach(function (m, k) { m.classList.toggle('is-active', k === i); });
      if (beatNow) beatNow.textContent = String(i + 1).padStart(2, '0');
      if (railProgress) {
        railProgress.style.transform = 'scaleY(' + (i / (beats.length - 1)) + ')';
      }
      current = i;
      applyScene(beats[i].id);
      document.body.classList.toggle('is-deep', i > 0);
      document.body.classList.toggle('hud-on', !!HUD_SCENES[beats[i].id]);
    }

    function go(i, instant) {
      i = clamp(i, 0, beats.length - 1);
      if (i === current && !instant) return;
      setActive(i);
      play(i);
      if (busy) return;
      busy = true;
      setTimeout(function () { busy = false; }, reduceMotion ? 80 : 950);
    }

    function closeOverlay() {
      if (!overlay) return;
      overlay.classList.remove('is-open');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      setTimeout(function () { overlay.hidden = true; }, 450);
    }

    /* --- 移动端：滚动驱动场景 --- */
    var observer = null;
    function setupObserver() {
      if (observer || !('IntersectionObserver' in window)) return;
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            var idx = beats.indexOf(en.target);
            if (idx >= 0) setActive(idx);
          }
        });
      }, { threshold: 0.5, rootMargin: '-12% 0px -12% 0px' });
      beats.forEach(function (b) { observer.observe(b); });
    }
    function teardownObserver() {
      if (observer) { observer.disconnect(); observer = null; }
    }

    /* --- 输入（桌面全屏翻页） --- */
    window.addEventListener('wheel', function (e) {
      if (isMobile) return;
      e.preventDefault();
      if (Math.abs(e.deltaY) < 4 || busy) return;
      go(current + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    var touchY = null;
    window.addEventListener('touchstart', function (e) {
      touchY = e.touches[0].clientY;
    }, { passive: true });
    window.addEventListener('touchend', function (e) {
      if (isMobile || touchY === null) return;
      var dy = touchY - ((e.changedTouches[0] || {}).clientY || 0);
      touchY = null;
      if (Math.abs(dy) < 40) return;
      go(current + (dy > 0 ? 1 : -1));
    }, { passive: true });

    window.addEventListener('keydown', function (e) {
      if (isMobile) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault(); go(current + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); go(current - 1);
      } else if (e.key === 'Home') { e.preventDefault(); go(0); }
      else if (e.key === 'End') { e.preventDefault(); go(beats.length - 1); }
    });

    /* --- 目录 / 导航点击：桌面翻页，移动端滚动到对应区块 --- */
    function indexOfBeat(sel) {
      for (var k = 0; k < beats.length; k++) {
        if ('#' + beats[k].id === sel) return k;
      }
      return -1;
    }
    Array.prototype.slice.call(document.querySelectorAll('[data-target]')).forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var k = indexOfBeat(el.getAttribute('data-target'));
        if (k < 0) return;
        if (isMobile) {
          closeOverlay();
          beats[k].scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        } else {
          go(k);
        }
      });
    });

    /* ---- FIELD 模块 ↔ 背景联动（hover 第 N 个模块 → 点亮第 N 个簇） ---- */
    Array.prototype.slice.call(document.querySelectorAll('.gate')).forEach(function (gate, gi) {
      gate.addEventListener('pointerenter', function () {
        if (window.__austOrb) window.__austOrb.pulse(gi % 4);
      });
      gate.addEventListener('pointerleave', function () {
        if (window.__austOrb) window.__austOrb.pulse(-1);
      });
    });

    /* ---- 目录浮层 ---- */
    function openOverlay() {
      if (!overlay) return;
      overlay.hidden = false;
      requestAnimationFrame(function () { overlay.classList.add('is-open'); });
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }
    if (toggle) toggle.addEventListener('click', function () {
      if (overlay && overlay.hidden) openOverlay(); else closeOverlay();
    });
    if (closeBtn) closeBtn.addEventListener('click', closeOverlay);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeOverlay();
    });

    /* --- 布局切换（旋转 / 拉伸窗口跨越 820px 断点） --- */
    function onMqChange(e) {
      isMobile = e.matches;
      if (isMobile) {
        setupObserver();
        applyScene(beats[current].id);
      } else {
        teardownObserver();
        go(0, true);
      }
    }
    if (mq.addEventListener) mq.addEventListener('change', onMqChange);
    else if (mq.addListener) mq.addListener(onMqChange);

    /* --- 启动 --- */
    if (isMobile) {
      applyScene(beats[0].id);
      setupObserver();
    } else {
      go(0, true);
    }
  }

  /* ======================================================================
     4. 入会二维码弹层
     ====================================================================== */
  function initModal() {
    var modal = document.getElementById('memberModal');
    var open = document.getElementById('joinOpen');
    var close = document.getElementById('memberClose');
    if (!modal) return;

    function show() {
      modal.hidden = false;
      requestAnimationFrame(function () { modal.classList.add('is-open'); });
    }
    function hide() {
      modal.classList.remove('is-open');
      setTimeout(function () { modal.hidden = true; }, 450);
    }
    if (open) open.addEventListener('click', show);
    if (close) close.addEventListener('click', hide);
    modal.addEventListener('click', function (e) { if (e.target === modal) hide(); });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) hide();
    });
  }

  /* ======================================================================
     5. 鼠标遥测 HUD
     ====================================================================== */
  function initHud() {
    var hud = document.getElementById('hud');
    var elX = document.getElementById('hudX');
    var elY = document.getElementById('hudY');
    var elNode = document.getElementById('hudNode');
    var elPing = document.getElementById('hudPing');
    if (!hud || !elX) return;
    if (!window.matchMedia || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;

    var hideTimer = null, lastPing = 0;
    var pad = function (n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; };

    window.addEventListener('pointermove', function (e) {
      var x = Math.round(e.clientX), y = Math.round(e.clientY);
      elX.textContent = pad(x, 4);
      elY.textContent = pad(y, 4);
      elNode.textContent = pad((x * 7 + y * 13) % 512, 3);

      var now = Date.now();
      if (now - lastPing > 400) {
        lastPing = now;
        elPing.textContent = (8 + Math.round(Math.random() * 18)) + 'ms';
      }
      hud.classList.add('is-on');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { hud.classList.remove('is-on'); }, 1200);
    }, { passive: true });
  }

  /* ======================================================================
     6. 自绘光标
     ====================================================================== */
  function initCursor() {
    var el = document.getElementById('cursor');
    var label = document.getElementById('cursorLabel');
    if (!el) return;
    if (!window.matchMedia || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;

    document.body.classList.add('has-custom-cursor');

    var x = -100, y = -100, tx = -100, ty = -100, shown = false;

    window.addEventListener('pointermove', function (e) {
      tx = e.clientX; ty = e.clientY;
      if (!shown) { shown = true; x = tx; y = ty; el.classList.add('is-visible'); }
    }, { passive: true });
    window.addEventListener('pointerleave', function () {
      shown = false; el.classList.remove('is-visible');
    });

    var HOT = [
      ['.gate', 'VIEW'],
      ['.qr', 'SCAN'],
      ['#joinOpen', 'JOIN'],
      ['.mark', 'GOTO'],
      ['.overlay-nav a', 'GOTO'],
      ['.btn', 'OPEN']
    ];
    HOT.forEach(function (pair) {
      Array.prototype.slice.call(document.querySelectorAll(pair[0])).forEach(function (n) {
        n.addEventListener('pointerenter', function () {
          if (label) label.textContent = pair[1];
          el.classList.add('is-hot');
        });
        n.addEventListener('pointerleave', function () { el.classList.remove('is-hot'); });
      });
    });

    (function loop() {
      requestAnimationFrame(loop);
      x = lerp(x, tx, 0.19);
      y = lerp(y, ty, 0.19);
      el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    })();
  }

  /* ======================================================================
     7. 启动
     ====================================================================== */
  function init() {
    var total = document.getElementById('beatTotal');
    var beatsAll = document.querySelectorAll('.beat');
    if (total && beatsAll.length) {
      total.textContent = String(beatsAll.length).padStart(2, '0');
    }

    initNetwork();
    initCursor();
    initHud();
    initBeats();
    initModal();

    var y = document.getElementById('year');
    if (y) y.textContent = String(new Date().getFullYear());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
