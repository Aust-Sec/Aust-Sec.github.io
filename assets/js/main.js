/* ==========================================================================
   AUSTSec · 主脚本
   --------------------------------------------------------------------------
   1. 3D 粒子网络（画布）—— 带磷光拖尾的旋转球状网络
   2. 逐字「遮挡揭示 + 模糊对焦」标题动效
   3. 分屏叙事：滚轮 / 触摸 / 键盘 / 右侧刻度统一驱动
   4. 自绘光标、数字滚动
   零依赖、无构建，直接丢 GitHub Pages 就能跑。
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  /* ======================================================================
     1. 逐字切分与揭示
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
        // 空格/不换行空格原样输出。
        // 若包进 inline-block 的 .ch 里，连续空白会被折叠算法吃掉，
        // 结果就是 "NOT A CLUB." 变成 "NOTACLUB."。
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
     2. 3D 粒子网络
     ----------------------------------------------------------------------
     用球面均匀采样（Fibonacci 球）布点，透视投影到 2D，
     再按空间距离连线。每帧不清屏、只盖一层半透明黑 —— 形成磷光拖尾，
     这是画面“贵”的关键。
     ====================================================================== */
  function initNetwork() {
    var cvs = document.getElementById('net');
    if (!cvs) return;
    var ctx = cvs.getContext('2d');
    if (!ctx) return;

    var W = 0, H = 0, cx = 0, cy = 0, R = 0;
    var pts = [];
    var mouse = { x: 0, y: 0 };        // -1..1
    var target = { x: 0, y: 0 };
    var rotY = 0, rotX = -0.22;
    var visible = true;

    var COUNT = 420;
    var LINK_DIST = 0.62;              // 连线阈值（单位球半径）
    var FOCAL = 2.6;

    /* Fibonacci 球：均匀布点 */
    function build() {
      pts = [];
      var golden = Math.PI * (3 - Math.sqrt(5));
      for (var i = 0; i < COUNT; i++) {
        var y = 1 - (i / (COUNT - 1)) * 2;
        var r = Math.sqrt(Math.max(0, 1 - y * y));
        var th = golden * i;
        pts.push({
          x: Math.cos(th) * r,
          y: y,
          z: Math.sin(th) * r,
          sx: 0, sy: 0, scale: 0, depth: 0
        });
      }
    }

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      cvs.width = Math.round(W * dpr);
      cvs.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2;
      cy = H / 2;
      R = Math.min(W, H) * (W < 760 ? 0.25 : 0.185);
      R = Math.min(R, H * 0.30);        // 再压一层，保证标题区不被压住
      // 主体偏心放置：向右下偏移，把中心让给文字（原站的音箱也是偏的）
      if (W < 760) {
        cx = W / 2;
        cy = H * 0.34;                  // 窄屏上移，给下方数据让出空间
      } else {
        cx = W / 2 + R * 0.52;
        cy = H / 2 + R * 0.20;
      }
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }

    function project() {
      var cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      var cosX = Math.cos(rotX), sinX = Math.sin(rotX);
      for (var i = 0; i < COUNT; i++) {
        var p = pts[i];
        // 绕 Y 轴
        var x1 = p.x * cosY - p.z * sinY;
        var z1 = p.x * sinY + p.z * cosY;
        // 绕 X 轴
        var y1 = p.y * cosX - z1 * sinX;
        var z2 = p.y * sinX + z1 * cosX;

        var s = FOCAL / (FOCAL + z2);          // 透视
        p.sx = cx + x1 * R * s;
        p.sy = cy + y1 * R * s;
        p.scale = s;
        p.depth = z2;                          // -1 近 .. 1 远
      }
    }

    function drawLinks() {
      ctx.lineWidth = 1;
      var i, j, a, b, dx, dy, dz, d2, alpha;
      for (i = 0; i < COUNT; i++) {
        a = pts[i];
        for (j = i + 1; j < COUNT; j++) {
          b = pts[j];
          dx = a.x - b.x; dy = a.y - b.y; dz = a.z - b.z;
          d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > LINK_DIST * LINK_DIST) continue;

          // 越近越亮；越靠前越亮
          // 注意：数值压得比较低，因为球体是所有屏共用的背景，
          // 文字铺满整宽的屏（如 START HERE）上它会直接压在正文上。
          alpha = (1 - Math.sqrt(d2) / LINK_DIST) * 0.115;
          alpha *= (1 - (a.depth + b.depth) * 0.5 * 0.5);
          if (alpha <= 0.008) continue;

          ctx.strokeStyle = 'rgba(239,239,239,' + alpha.toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
      }
    }

    function drawParticles(t) {
      for (var i = 0; i < COUNT; i++) {
        var p = pts[i];
        var depthFade = 1 - (p.depth + 1) * 0.5;     // 近亮远暗
        var size = (0.7 + p.scale * 0.9) * (0.6 + depthFade * 0.8);
        var alpha = 0.07 + depthFade * 0.30;

        // 少量节点做成青色并缓慢脉动，作为“数据源”
        if (i % 37 === 0) {
          var pulse = 0.5 + 0.5 * Math.sin(t * 0.0016 + i);
          ctx.fillStyle = 'rgba(0,255,255,' + (alpha * (0.35 + pulse * 0.5)).toFixed(3) + ')';
          size *= 1.5 + pulse * 0.7;
        } else {
          ctx.fillStyle = 'rgba(239,239,239,' + alpha.toFixed(3) + ')';
        }
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    var last = 0, FRAME = 1000 / 34;

    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible) return;
      if (now - last < FRAME) return;
      last = now;

      // 鼠标阻尼跟随
      target.x = clamp(mouse.x, -1, 1);
      target.y = clamp(mouse.y, -1, 1);

      if (!reduceMotion) {
        rotY += 0.0022;
        rotX += (( -0.22 + target.y * 0.34) - rotX) * 0.03;
        rotY += (target.x * 0.010);
      }

      project();

      // 半透明黑罩 -> 磷光拖尾
      ctx.fillStyle = reduceMotion ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0.20)';
      ctx.fillRect(0, 0, W, H);

      drawLinks();
      drawParticles(now);
    }

    /* ---- 交互与生命周期 ---- */
    window.addEventListener('pointermove', function (e) {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt); rt = setTimeout(resize, 140);
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
      }, { threshold: 0 }).observe(document.body);
    }
    document.addEventListener('visibilitychange', function () {
      visible = !document.hidden;
    });

    build();
    resize();
    if (reduceMotion) {
      rotY = 0.7; project();
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      drawLinks(); drawParticles(0);
      return;
    }
    requestAnimationFrame(frame);
  }

  /* ======================================================================
     3. 分屏叙事
     ====================================================================== */
  function initBeats() {
    var beats = Array.prototype.slice.call(document.querySelectorAll('.beat'));
    if (!beats.length) return;

    var marks = Array.prototype.slice.call(document.querySelectorAll('.mark'));
    var railProgress = document.getElementById('railProgress');
    var beatNow = document.getElementById('beatNow');
    var current = 0;
    var busy = false;

    // 每个 beat 的文字预先切好字，进入时才播放
    var kineticCache = beats.map(function (b) { return prepareKinetic(b); });
    var played = beats.map(function () { return false; });

    function play(i) {
      if (played[i]) return;
      played[i] = true;
      var inners = kineticCache[i];
      if (reduceMotion) { beats[i].classList.add('is-in'); return; }

      // 自适应错峰：字多的时候自动压缩间隔。
      // 固定 32ms 对 100 字的正文意味着 3.2s 才放完，读起来像卡住了。
      var spread = Math.min(0.032 * inners.length, 0.55);   // 整体展开时长上限 550ms
      var stagger = inners.length > 1 ? spread / (inners.length - 1) : 0;

      inners.forEach(function (inner, k) {
        inner.style.transitionDelay = (120 + k * stagger * 1000) + 'ms';
      });
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { beats[i].classList.add('is-in'); });
      });
      // 数字滚动
      Array.prototype.slice.call(beats[i].querySelectorAll('[data-count]')).forEach(countUp);
    }

    function go(i, instant) {
      i = clamp(i, 0, beats.length - 1);
      if (i === current && !instant) return;

      beats.forEach(function (b, k) { b.classList.toggle('is-active', k === i); });
      marks.forEach(function (m, k) { m.classList.toggle('is-active', k === i); });

      // 序幕只有大标题，压暗层可以轻；内容页文字密，需要更强的压暗层
      document.body.classList.toggle('is-deep', i > 0);

      if (beatNow) beatNow.textContent = String(i + 1).padStart(2, '0');
      if (railProgress) {
        railProgress.style.transform = 'scaleY(' + (i / (beats.length - 1)) + ')';
      }
      current = i;

      play(i);

      if (busy) return;
      busy = true;
      setTimeout(function () { busy = false; }, reduceMotion ? 80 : 900);
    }

    /* --- 输入：滚轮 --- */
    window.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (Math.abs(e.deltaY) < 4) return;
      if (busy) return;
      go(current + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    /* --- 输入：触摸滑动 --- */
    var touchY = null;
    window.addEventListener('touchstart', function (e) {
      touchY = e.touches[0].clientY;
    }, { passive: true });
    window.addEventListener('touchend', function (e) {
      if (touchY === null) return;
      var dy = touchY - (e.changedTouches[0] || {}).clientY;
      touchY = null;
      if (Math.abs(dy) < 40) return;
      go(current + (dy > 0 ? 1 : -1));
    }, { passive: true });

    /* --- 输入：键盘 --- */
    window.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault(); go(current + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); go(current - 1);
      } else if (e.key === 'Home') { e.preventDefault(); go(0); }
      else if (e.key === 'End') { e.preventDefault(); go(beats.length - 1); }
    });

    /* --- 输入：右侧刻度 / 目录 / 按钮锚点 --- */
    Array.prototype.slice.call(document.querySelectorAll('[data-target]')).forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var sel = el.getAttribute('data-target');
        var idx = -1;
        for (var k = 0; k < beats.length; k++) {
          if ('#' + beats[k].id === sel) { idx = k; break; }
        }
        if (idx >= 0) go(idx);
      });
    });

    // 目录浮层里的锚点
    Array.prototype.slice.call(document.querySelectorAll('.overlay-nav a')).forEach(function (a) {
      a.addEventListener('click', function () { closeOverlay(); });
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

    // 动态计算轨道长度：刻度数越多线越长
    go(0, true);
  }

  /* ======================================================================
     4. 数字滚动
     ====================================================================== */
  function countUp(el) {
    if (el.dataset.done === '1') return;
    el.dataset.done = '1';
    var to = parseInt(el.dataset.count, 10) || 0;
    if (reduceMotion) { el.textContent = to.toLocaleString('en-US'); return; }
    var dur = 1500, start = null;
    function tick(now) {
      if (start === null) start = now;
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * eased).toLocaleString('en-US');
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ======================================================================
     5. 自绘光标
     ====================================================================== */
  function initCursor() {
    var el = document.getElementById('cursor');
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

    // 悬停到可交互元素上时放大
    Array.prototype.slice.call(document.querySelectorAll('a,button,.gate,.qr,.path li')).forEach(function (n) {
      n.addEventListener('pointerenter', function () { el.classList.add('is-hot'); });
      n.addEventListener('pointerleave', function () { el.classList.remove('is-hot'); });
    });

    (function loop() {
      requestAnimationFrame(loop);
      x = lerp(x, tx, 0.18);
      y = lerp(y, ty, 0.18);
      el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    })();
  }

  /* ======================================================================
     6. 鼠标遥测 HUD
     ----------------------------------------------------------------------
     原站那种"数据感"的来源是**偶尔浮现**，不是常驻。
     这里做成：鼠标移动时显示，停下 1.2s 后淡出，避免变成廉价的跑马灯。
     ====================================================================== */
  function initHud() {
    var hud = document.getElementById('hud');
    var elX = document.getElementById('hudX');
    var elY = document.getElementById('hudY');
    var elNode = document.getElementById('hudNode');
    var elPing = document.getElementById('hudPing');
    if (!hud || !elX) return;

    // 触摸设备不显示（没有"悬停"概念）
    if (!window.matchMedia || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;

    var hideTimer = null, lastPing = 0;

    function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

    window.addEventListener('pointermove', function (e) {
      var x = Math.round(e.clientX), y = Math.round(e.clientY);

      elX.textContent = pad(x, 4);
      elY.textContent = pad(y, 4);
      elNode.textContent = pad((x * 7 + y * 13) % 512, 3);

      // ping 值不需要每个事件都算，每 400ms 更新一次即可
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
     7. 启动
     ====================================================================== */
  function init() {
    // 总屏数从 DOM 读，加/删 section 不用改 JS
    var total = document.getElementById('beatTotal');
    var beatsAll = document.querySelectorAll('.beat');
    if (total && beatsAll.length) {
      total.textContent = String(beatsAll.length).padStart(2, '0');
    }

    initNetwork();
    initCursor();
    initHud();
    initBeats();

    var y = document.getElementById('year');
    if (y) y.textContent = String(new Date().getFullYear());

    Array.prototype.slice.call(document.querySelectorAll('[data-todo]')).forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        alert('待接入：' + a.dataset.todo + '\n请在 index.html 里把 href 换成真实链接。');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
