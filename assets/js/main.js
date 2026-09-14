/* ==========================================================================
   AUSTSec · 主脚本
   --------------------------------------------------------------------------
   1. 背景三层结构（远景 dust / 主体 topology core / 近景 fragment）+ 视差
   2. 主体"场景状态"：每屏不同的形态与位置，形成 motion narrative
   3. 逐字揭示只给大标题；正文整行出现（克制）
   4. 分屏叙事 / 自绘光标 / 遥测 HUD / 二维码弹层
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
     ----------------------------------------------------------------------
     所有"每帧固定比例"的插值/衰减都必须换算成按时间算，
     否则 60Hz 和 80Hz 用户看到的运动速度不一样：
       · 插值更快 / morph 更快 / 碎片更快 / 拖尾衰减更快
     基准取 60fps（16.667ms）。
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
        // 空格原样输出：包进 inline-block 会让连续空白被折叠算法吃掉
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

  function prepareKinetic(root) {
    var els = Array.prototype.slice.call(root.querySelectorAll('[data-kinetic]'));
    var inners = [];
    els.forEach(function (el) { inners = inners.concat(splitChars(el)); });
    return inners;
  }

  /* ======================================================================
     2. 背景：三层 + 场景状态
     ----------------------------------------------------------------------
     原来的问题是"所有东西都在同一个深度层"，所以像 3D wireframe globe
     而不是一个空间。现在拆成：
       远景 dust      —— 移动极少，只做视差 2px
       主体 core      —— 巨大拓扑球，按屏切换形态，视差 8px
       近景 fragment  —— 偶尔掠过镜头的碎片，视差 20px
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
    var LINK_DIST = 0.40;
    var FOCAL = 2.6;

    // 场景状态（由 CSS 变量驱动，见 style.css 的 --orb-*）
    var orb = { x: 70, y: 52, r: 0.40, o: 1 };
    var orbT = { x: 70, y: 52, r: 0.40, o: 1 };
    var mode = 'sphere';        // sphere | scatter | path | radar
    var modeMix = { scatter: 0, path: 0, radar: 0 };
    var modeMixT = { scatter: 0, path: 0, radar: 0 };

    /* ---------- 布点 ---------- */
    function build() {
      core = [];
      var golden = Math.PI * (3 - Math.sqrt(5));
      for (var i = 0; i < COUNT; i++) {
        var y = 1 - (i / (COUNT - 1)) * 2;
        var r = Math.sqrt(Math.max(0, 1 - y * y));
        var th = golden * i;
        core.push({
          bx: Math.cos(th) * r, by: y, bz: Math.sin(th) * r,   // 球面基准
          sx: 0, sy: 0, scale: 1, depth: 0,
          hot: i % 41 === 0                                     // 稀有亮点
        });
      }
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

    /* ---------- 场景目标 ----------
       单向数据流：
         applyScene() → orbT（目标，只由分屏逻辑写）
         applyOrb()   → orb（平滑值）→ 写回 --orb-x/--orb-y（只给光环用）
       绝对不能让 orbT 反过来读 --orb-*，否则目标会被自己的平滑输出覆盖，
       球会卡在原地看着不动（上一版就是这个自反馈 bug）。 */
    function setOrbTarget(x, y, r, o) {
      orbT.x = x; orbT.y = y; orbT.r = r; orbT.o = o;
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
      // 插值系数按 dt 换算 —— 固定 0.05 在不同刷新率下速度不同
      var t = instant ? 1 : dtAlpha(0.055, dt);
      orb.x = lerp(orb.x, orbT.x, t);
      orb.y = lerp(orb.y, orbT.y, t);
      orb.r = lerp(orb.r, orbT.r, t);
      orb.o = lerp(orb.o, orbT.o, t);

      cx = W * (orb.x / 100);
      cy = H * (orb.y / 100);
      // 主体要大：允许超出屏幕，被裁切才显得有压迫感
      R = Math.min(W, H) * orb.r;
      if (W < 760) R = Math.min(R, H * 0.34);

      // 光源跟随球：把平滑后的位置写回 CSS 变量。
      // 不能在 CSS 里做 transition —— 渐变不可插值，transition 是无效的。
      orbVarTick = (orbVarTick + 1) % 8;
      if (orbVarTick === 0) {
        var rs = document.documentElement.style;
        rs.setProperty('--orb-x', orb.x.toFixed(2));
        rs.setProperty('--orb-y', orb.y.toFixed(2));
      }
    }
    var orbVarTick = 0;

    function setMode(m) {
      mode = m;
      // JOIN 用 gather：从上一屏的散开状态极缓慢地回收成完整 Core。
      // 不是直接切 sphere —— 要看得见"前面的东西重新聚合了"。
      modeMixT = {
        scatter: m === 'scatter' ? 1 : 0,
        path: m === 'path' ? 1 : 0,
        radar: m === 'radar' ? 1 : 0
      };
      gather = (m === 'gather');
    }
    var gather = false;

    /* ---------- 投影 ---------- */
    function project(t, dt) {
      // JOIN 进入时把 morph 速度放慢 4 倍，聚合成完整 Core 要 2~2.5 秒
      var morph = gather ? 0.0115 : 0.05;
      var aMode = dtAlpha(morph, dt);
      modeMix.scatter = lerp(modeMix.scatter, modeMixT.scatter, aMode);
      modeMix.path = lerp(modeMix.path, modeMixT.path, aMode);
      modeMix.radar = lerp(modeMix.radar, modeMixT.radar, aMode);

      var cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      var cosX = Math.cos(pitch), sinX = Math.sin(pitch);
      var sc = modeMix.scatter, pa = modeMix.path, ra = modeMix.radar;

      for (var i = 0; i < COUNT; i++) {
        var p = core[i];
        var bx = p.bx, by = p.by, bz = p.bz;

        // scatter：向外炸开一点
        if (sc > 0.001) {
          var k = 1 + sc * (0.55 + (i % 7) * 0.05);
          bx *= k; by *= k; bz *= k;
        }
        // path：向一条斜向脊线收拢，形成"路径/轨迹"
        if (pa > 0.001) {
          var u = i / COUNT;
          var tx = -0.55 + u * 1.15;
          var ty = 0.62 - u * 1.24;
          var tz = Math.sin(u * Math.PI * 2) * 0.16;
          bx = lerp(bx, tx, pa); by = lerp(by, ty, pa); bz = lerp(bz, tz, pa);
        }
        // radar：压扁成盘状，像雷达扫描面
        if (ra > 0.001) {
          var flat = 0.12;
          by = lerp(by, by * flat, ra);
        }

        var x1 = bx * cosY - bz * sinY;
        var z1 = bx * sinY + bz * cosY;
        var y1 = by * cosX - z1 * sinX;
        var z2 = by * sinX + z1 * cosX;

        var s = FOCAL / (FOCAL + z2);
        p.sx = cx + x1 * R * s;
        p.sy = cy + y1 * R * s;
        p.scale = s;
        p.depth = z2;
      }
    }

    /* ---------- 三层绘制 ---------- */
    function drawDust(px, py) {
      for (var i = 0; i < DUST_N; i++) {
        var d = dust[i];
        var x = (d.x * 0.5 + 0.5) * W + px * 0.12;      // 视差最小
        var y = (d.y * 0.5 + 0.5) * H + py * 0.12;
        ctx.fillStyle = 'rgba(242,244,245,' + (d.a * 0.5).toFixed(3) + ')';
        ctx.fillRect(x, y, d.s, d.s);
      }
    }

    function drawLinks(alphaMul) {
      ctx.lineWidth = 1;
      var i, j, a, b, dx, dy, dz, d2, alpha;
      for (i = 0; i < COUNT; i++) {
        a = core[i];
        for (j = i + 1; j < COUNT; j++) {
          b = core[j];
          dx = a.bx - b.bx; dy = a.by - b.by; dz = a.bz - b.bz;
          d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > LINK_DIST * LINK_DIST) continue;
          alpha = (1 - Math.sqrt(d2) / LINK_DIST) * 0.20 * alphaMul;
          alpha *= (1 - (a.depth + b.depth) * 0.25);
          if (alpha <= 0.010) continue;
          ctx.strokeStyle = 'rgba(242,244,245,' + alpha.toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
      }
    }

    /* ---------- FIELD 联动：hover 模块 → 点亮一组节点 ----------
       这是"UI 在控制数字空间"而不是"背景放了个 Canvas"的关键一步。
       强度刻意压得很低：亮起来是"响应"，不能抢正文。 */
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

        // 被 hover 命中的那一组：整组提亮 + 长出光晕
        var inGroup = pulseGroup >= 0 && (i % 4) === pulseGroup;
        var boost = inGroup ? pulseAmt : 0;

        if (p.hot || boost > 0.02) {
          var pulse = 0.5 + 0.5 * Math.sin(t * 0.0012 + i);
          var rad = 26 + pulse * 12 + boost * 10;
          var gr = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad);
          if (boost > 0.02) {
            // 联动亮度远低于常驻亮点，避免整片"烧起来"
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
        f.x += f.v * step;                  // 位移按时间算
        if (f.x > 1.3) frag[i] = spawnFrag(false);
        var x = (f.x * 0.5 + 0.5) * W + px * 0.5;       // 近乎前景，视差最大
        var y = (f.y * 0.5 + 0.5) * H + py * 0.5;
        ctx.strokeStyle = 'rgba(180,235,255,' + f.a.toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - f.len, y + f.len * 0.16);
        ctx.stroke();
      }
    }

    /* ---------- 主循环（60fps 自适应） ---------- */
    var last = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible) return;
      var dt = Math.min(48, now - last);
      if (dt < 12) return;                  // 上限约 80fps，高刷屏不空转
      last = now;

      var t = now;
      applyOrb(false, dt);          // 注意：主循环里不能调 readOrbVars()
      // applyOrb 会把平滑后的 orb.x 写回 --orb-x，若这里再读回来当目标，
      // 就形成自反馈：目标永远追不上自己，球会缓慢爬行且几乎不动。

      if (!reduceMotion) {
        yaw += 0.00045 * dt;                       // 已 dt 化
        yaw += (yawTarget - yaw) * dtAlpha(0.014, dt);
        pitch += (pitchTarget - pitch) * dtAlpha(0.022, dt);
        yawTarget *= dtPow(0.985, dt);             // 衰减按时间换算
        pitchTarget += (-0.20 - pitchTarget) * dtAlpha(0.007, dt);
      }

      project(t, dt);

      // 拖尾：半透明底覆盖也按时间算，否则 80fps 衰减更快（更黑）
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
      yawTarget = (mouse.x - 0.5) * 0.55;   // 只设目标，不持续加值
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
      yaw = 0.7; project(0);
      ctx.fillStyle = '#030506'; ctx.fillRect(0, 0, W, H);
      drawLinks(1); drawCore(0);
      return;
    }
    requestAnimationFrame(frame);

    // 暴露给分屏逻辑切换场景
    window.__austOrb = {
      setMode: setMode,
      resize: resize,
      /** 设置场景目标（单向：分屏逻辑 → 目标 → 平滑 → CSS 变量） */
      setTarget: setOrbTarget,
      /** 悬停 FIELD 模块时点亮对应的一组节点 */
      pulse: function (group) {
        pulseGroup = group;
        pulseAmtT = group >= 0 ? 1 : 0;
      },
      /** 调试用：查看内部状态 */
      debug: function () {
        return {
          orb: { x: orb.x, y: orb.y, r: orb.r, o: orb.o },
          orbT: { x: orbT.x, y: orbT.y, r: orbT.r, o: orbT.o },
          mode: mode, gather: gather,
          cx: cx, cy: cy, R: R, W: W, H: H,
          varInline: document.documentElement.style.getPropertyValue('--orb-x'),
          varComputed: getComputedStyle(document.documentElement).getPropertyValue('--orb-x')
        };
      }
    };
  }

  /* ======================================================================
     3. 分屏叙事
     ----------------------------------------------------------------------
     每屏不仅换内容，还切换背景主体的形态与位置 —— motion narrative。
     ====================================================================== */
  var SCENES = {
    //        x%   y%   半径   不透明度  形态
    // 主体放大后会和左侧文字打架，所以 INDEX 也把球推右一些，
    // 靠"位置"而不是"压暗"来保证可读性。
    top:      { x: 78, y: 52, r: 0.30, o: 0.88, mode: 'sphere'  },
    about:    { x: 94, y: 54, r: 0.29, o: 0.68, mode: 'sphere'  },
    whatwedo: { x: 86, y: 50, r: 0.31, o: 0.58, mode: 'scatter' },
    start:    { x: 82, y: 50, r: 0.30, o: 0.56, mode: 'path'    },
    signal:   { x: 78, y: 50, r: 0.31, o: 0.66, mode: 'radar'   },
    // JOIN：球回中 + gather —— 前面散开/压扁的东西重新聚合成完整 Core
    join:     { x: 52, y: 47, r: 0.33, o: 0.82, mode: 'gather'  }
  };

  // HUD 只在特定场景出现，让它成为"场景语言"而不是全站装饰
  var HUD_SCENES = { top: 1, whatwedo: 1, signal: 1 };

  function initBeats() {
    var beats = Array.prototype.slice.call(document.querySelectorAll('.beat'));
    if (!beats.length) return;

    var root = document.documentElement;
    var marks = Array.prototype.slice.call(document.querySelectorAll('.mark'));
    var railProgress = document.getElementById('railProgress');
    var beatNow = document.getElementById('beatNow');
    var current = 0, busy = false;

    // 预切字：只有大标题逐字，正文用整行 .rise
    var kineticCache = beats.map(function (b) {
      var heads = Array.prototype.slice.call(b.querySelectorAll('.display'));
      var inners = [];
      heads.forEach(function (h) {
        if (h.dataset.kinetic !== undefined) inners = inners.concat(splitChars(h));
      });
      // .display 默认都参与逐字，不再依赖 data-kinetic
      return inners;
    });
    var played = beats.map(function () { return false; });

    function applyScene(id) {
      var s = SCENES[id] || SCENES.top;
      // 直接写目标值（单向），同时把初始值写进 CSS 变量让光环立刻对齐
      if (window.__austOrb && window.__austOrb.setTarget) {
        window.__austOrb.setTarget(s.x, s.y, s.r, s.o);
      } else {
        // 画布还未初始化时，先把值放进 CSS 变量，初始化时会被读到
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

      // 自适应错峰：字数多时自动压缩，总展开上限 620ms
      var spread = Math.min(0.030 * inners.length, 0.62);
      var stagger = inners.length > 1 ? spread / (inners.length - 1) : 0;
      inners.forEach(function (inner, k) {
        inner.style.transitionDelay = (110 + k * stagger * 1000) + 'ms';
      });
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { beats[i].classList.add('is-in'); });
      });
      // 正文整行浮现
      Array.prototype.slice.call(beats[i].querySelectorAll('.rise')).forEach(function (el, k) {
        el.style.transitionDelay = (140 + k * 80) + 'ms';
        el.classList.add('is-in');
      });
    }

    function go(i, instant) {
      i = clamp(i, 0, beats.length - 1);
      if (i === current && !instant) return;

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
      play(i);

      document.body.classList.toggle('is-deep', i > 0);
      // HUD 属于场景语言：只在 INDEX / FIELD / SIGNAL 出现
      document.body.classList.toggle('hud-on', !!HUD_SCENES[beats[i].id]);

      if (busy) return;
      busy = true;
      setTimeout(function () { busy = false; }, reduceMotion ? 80 : 950);
    }

    /* --- 输入 --- */
    window.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (Math.abs(e.deltaY) < 4 || busy) return;
      go(current + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    var touchY = null;
    window.addEventListener('touchstart', function (e) {
      touchY = e.touches[0].clientY;
    }, { passive: true });
    window.addEventListener('touchend', function (e) {
      if (touchY === null) return;
      var dy = touchY - ((e.changedTouches[0] || {}).clientY || 0);
      touchY = null;
      if (Math.abs(dy) < 40) return;
      go(current + (dy > 0 ? 1 : -1));
    }, { passive: true });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault(); go(current + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); go(current - 1);
      } else if (e.key === 'Home') { e.preventDefault(); go(0); }
      else if (e.key === 'End') { e.preventDefault(); go(beats.length - 1); }
    });

    Array.prototype.slice.call(document.querySelectorAll('[data-target]')).forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var sel = el.getAttribute('data-target');
        for (var k = 0; k < beats.length; k++) {
          if ('#' + beats[k].id === sel) { go(k); break; }
        }
      });
    });

    /* ---- FIELD 模块 ↔ 背景联动 ----
       hover 第 N 个模块 → 球上第 N 组节点亮起。
       这一步让 UI 看起来在"控制"这个数字空间，而不是浮在背景上。 */
    Array.prototype.slice.call(document.querySelectorAll('.gate')).forEach(function (gate, gi) {
      gate.addEventListener('pointerenter', function () {
        if (window.__austOrb) window.__austOrb.pulse(gi % 4);
      });
      gate.addEventListener('pointerleave', function () {
        if (window.__austOrb) window.__austOrb.pulse(-1);
      });
    });

    /* ---- 目录浮层 ---- */
    var overlay = document.getElementById('overlay');
    var toggle = document.getElementById('navToggle');
    var closeBtn = document.getElementById('overlayClose');

    function openOverlay() {
      if (!overlay) return;
      overlay.hidden = false;
      requestAnimationFrame(function () { overlay.classList.add('is-open'); });
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }
    function closeOverlay() {
      if (!overlay) return;
      overlay.classList.remove('is-open');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      setTimeout(function () { overlay.hidden = true; }, 450);
    }
    if (toggle) toggle.addEventListener('click', function () {
      if (overlay && overlay.hidden) openOverlay(); else closeOverlay();
    });
    if (closeBtn) closeBtn.addEventListener('click', closeOverlay);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeOverlay();
    });

    go(0, true);
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
     6. 自绘光标：3px 点 + 细环，悬停出现动作标签
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

    // 悬停动作标签：不同元素给不同词
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
