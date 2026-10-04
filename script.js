/* ============================================================
   夏日贴纸 · 心动盖章 — 交互逻辑
   结构：
     GameState   单一状态源
     FrameMap    object-fit:cover 画面映射（圆点/贴纸贴身的关键）
     VideoMachine idle/speaking 两态切换（互斥播放）
     StickerDrag  Pointer Events 拖拽（含点击放置模式）
     Affection    好感度数值 + 动画
     DialogueBox  台词淡入淡出
     Effects      心形粒子 / 吸附闪光
   ============================================================ */
"use strict";

/* ---------- 工具 ---------- */
const $ = (sel) => document.querySelector(sel);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ---------- DOM ---------- */
const els = {
  stage: $("#stage"),
  idleVideo: $("#idleVideo"),
  speakingVideo: $("#speakingVideo"),
  targetLayer: $("#targetLayer"),
  stickerLayer: $("#stickerLayer"),
  ghost: $("#ghost"),
  ghostImg: $("#ghostImg"),
  dockRow: $("#dockRow"),
  dockHint: $("#dockHint"),
  pickHint: $("#pickHint"),
  dialogue: $("#dialogue"),
  dialogueText: $("#dialogueText"),
  dialogueNarr: $("#dialogueNarr"),
  affection: $("#affection"),
  affectionFill: $("#affectionFill"),
  affectionNum: null,
  finish: $("#finish"),
};

/* ============================================================
   游戏状态（唯一状态源）
   ============================================================ */
const GameState = {
  currentStep: 0,          // 下一个应完成的贴纸下标（严格顺序 1→5）
  usedIds: new Set(),
  affection: 0,            // 0–100
  speaking: false,         // 语音播放中锁定输入
  speechId: 0,             // 当前语音序号，阻断旧语音回调串线
  finished: false,

  nextSticker() {
    if (this.currentStep >= STICKER_DATA.length) return null;
    return STICKER_DATA[this.currentStep];
  },
  completeCurrent() {
    const s = STICKER_DATA[this.currentStep];
    this.usedIds.add(s.id);
    this.currentStep += 1;
    this.affection = clamp(this.affection + AFFECTION_PER_STICKER, 0, 100);
    if (this.currentStep >= STICKER_DATA.length) this.finished = true;
    return s;
  },
};

/* ============================================================
   FrameMap — 视频 object-fit:cover 的可视画面映射
   data.js 里的 x/y 是视频帧内百分比（1080×1920 标定）；
   cover 会按宽高比裁切，这里把「帧百分比」换算成「舞台百分比」，
   并在 resize / 旋转时重算 → 圆点与贴纸始终贴在人物身上。
   ============================================================ */
const FrameMap = {
  videoAspect: 1080 / 1920, // loadeddata 后用 videoWidth/videoHeight 校准
  placed: [],               // [{el, data}] 供 resize 重排

  calibrate() {
    const v = els.idleVideo;
    if (v.videoWidth && v.videoHeight) this.videoAspect = v.videoWidth / v.videoHeight;
    this.applyAll();
  },

  /** 帧% → 舞台%（仅处理垂直/水平位移，不含缩放误差校正） */
  frameToStage(fx, fy) {
    const sw = els.stage.clientWidth;
    const sh = els.stage.clientHeight;
    if (!sw || !sh) return { x: fx, y: fy, scale: 1 };
    const stageAspect = sw / sh;
    let visibleW, visibleH; // 画面铺满舞台后实际显示的帧尺寸（px）
    if (this.videoAspect > stageAspect) {
      // 视频更宽 → 按高度铺满，左右裁切
      visibleH = sh;
      visibleW = sh * this.videoAspect;
    } else {
      // 视频更高 → 按宽度铺满，上下裁切
      visibleW = sw;
      visibleH = sw / this.videoAspect;
    }
    const offX = (sw - visibleW) / 2;
    const offY = (sh - visibleH) / 2;
    return {
      x: ((offX + (fx / 100) * visibleW) / sw) * 100,
      y: ((offY + (fy / 100) * visibleH) / sh) * 100,
      scale: visibleW / sw, // 帧宽相对舞台宽的倍数（贴纸大小校准）
    };
  },

  applyTo(el, data) {
    const p = this.frameToStage(data.x, data.y);
    el.style.left = p.x + "%";
    el.style.top = p.y + "%";
    if (data.size) {
      // 通用缩放；有 maxW 限制的（如脸颊）不超过画面宽 maxW 比例
      let w = data.size * PLACE_SCALE * p.scale;
      if (data.maxW) w = Math.min(w, data.maxW * 100);
      el.style.width = w + "%";
    }
  },

  applyAll() {
    Stage.targets.forEach((el, key) => {
      const data = STICKER_DATA.find((s) => s.target === key);
      if (data) this.applyTo(el, { x: data.x, y: data.y });
    });
    this.placed.forEach(({ el, data }) => this.applyTo(el, data));
  },
};

/* ============================================================
   视频状态机：IDLE ⇄ SPEAKING（互斥，绝不同时播放）
   ============================================================ */
const VideoMachine = {
  enter() {
    els.idleVideo.addEventListener("loadeddata", () => FrameMap.calibrate(), { once: true });
    this.toIdle(true);
  },
  toIdle(first = false) {
    els.speakingVideo.pause();
    els.speakingVideo.classList.add("is-hidden");
    els.idleVideo.classList.remove("is-hidden");
    els.idleVideo.currentTime = 0;
    els.idleVideo.play().catch(() => {});
  },
  /** 进入说话态（speaking.mp4 带 loop，语音更长时无缝循环） */
  speak() {
    els.idleVideo.pause();
    els.idleVideo.classList.add("is-hidden");
    els.speakingVideo.classList.remove("is-hidden");
    els.speakingVideo.currentTime = 0;
    els.speakingVideo.play().catch(() => {});
    return () => {}; // 语音结束由 AudioPlayer 驱动回 IDLE
  },
};

/* One voice element, one line, one completion. No warm-play or fallback replay. */
const AudioPlayer = {
  audio: null,
  current: null,
  init() {
    if (this.audio) return;
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.loop = false;
    this.audio.muted = false;
    this.audio.volume = 1;
  },
  prime() {
    this.init();
    if (this.current) return;
    const next = GameState.nextSticker();
    if (next && this.audio.getAttribute("src") !== next.audio) {
      this.audio.src = next.audio;
      this.audio.load();
    }
  },
  play(src, callbacks = {}) {
    this.stopCurrent();
    this.init();
    const a = this.audio;
    if (a.getAttribute("src") !== src) { a.src = src; a.load(); }
    try { a.currentTime = 0; } catch (_) {}
    a.muted = false;
    a.volume = 1;
    a.loop = false;
    return new Promise((resolve) => {
      const h = { resolve, callbacks, waiting: false, pending: false, started: false,
        attempt: 0, lastTime: 0, stalledAt: performance.now(), timer: null, listeners: [] };
      this.current = h;
      const listen = (type, fn) => { a.addEventListener(type, fn); h.listeners.push([type, fn]); };
      listen("playing", () => {
        if (this.current !== h) return;
        h.started = true;
        h.waiting = false;
        h.stalledAt = performance.now();
        callbacks.onPlaying?.();
      });
      listen("timeupdate", () => {
        if (this.current !== h) return;
        if (a.currentTime > h.lastTime) {
          h.lastTime = a.currentTime;
          h.stalledAt = performance.now();
        }
        // Progress-based backup for a missing ended event; never wall-clock expiry.
        if (h.started && Number.isFinite(a.duration) && a.duration > 0 &&
            a.currentTime >= a.duration - 0.035) this.finish(h, true);
      });
      listen("ended", () => {
        if (this.current === h && h.started) this.finish(h, true);
      });
      listen("error", () => this.waitForGesture(h));
      listen("pause", () => {
        if (this.current === h && !a.ended && h.started) this.waitForGesture(h);
      });
      h.timer = setInterval(() => {
        if (this.current !== h || h.waiting) return;
        if (performance.now() - h.stalledAt > 15000) this.waitForGesture(h);
      }, 1000);
      // Synchronous call on the placement event; no fetch/decode promise beforehand.
      this.start(h);
    });
  },
  start(h) {
    if (this.current !== h || h.pending) return;
    h.pending = true;
    h.waiting = false;
    h.stalledAt = performance.now();
    const attempt = ++h.attempt;
    const a = this.audio;
    try {
      const request = a.play();
      Promise.resolve(request).then(() => {
        if (this.current !== h || attempt !== h.attempt) return;
        h.pending = false;
      }, () => {
        if (this.current !== h || attempt !== h.attempt) return;
        h.pending = false;
        this.waitForGesture(h);
      });
    } catch (_) {
      h.pending = false;
      this.waitForGesture(h);
    }
  },
  waitForGesture(h) {
    if (this.current !== h || h.waiting) return;
    h.waiting = true;
    h.pending = false;
    h.attempt++;
    this.audio.pause();
    h.callbacks.onBlocked?.();
  },
  retryFromGesture() {
    const h = this.current;
    if (h?.waiting) this.start(h);
  },
  finish(h, completed) {
    if (this.current !== h) return;
    this.current = null;
    h.attempt++;
    clearInterval(h.timer);
    h.listeners.forEach(([type, fn]) => this.audio.removeEventListener(type, fn));
    this.audio.pause();
    h.resolve(completed);
  },
  stopCurrent() {
    if (this.current) this.finish(this.current, false);
  },
};

/* ============================================================
   好感度
   ============================================================ */
const Affection = {
  enter() {
    const num = document.createElement("div");
    num.className = "affection__num";
    els.affection.appendChild(num);
    els.affectionNum = num;
    this.render(0);
  },
  render(v) {
    els.affectionFill.style.height = v + "%";
    els.affectionNum.textContent = v + "%";
  },
  gain(originClient) {
    els.affection.classList.remove("beat");
    void els.affection.offsetWidth;
    els.affection.classList.add("beat");
    els.affectionNum.classList.remove("bump");
    void els.affectionNum.offsetWidth;
    els.affectionNum.classList.add("bump");
    this.render(GameState.affection);
    if (originClient) Effects.hearts(originClient.x, originClient.y, 6);
  },
};

/* ============================================================
   台词
   ============================================================ */
const DialogueBox = {
  show(sticker) {
    els.dialogueText.textContent = sticker.dialogue;
    els.dialogueNarr.textContent = sticker.narration;
    els.dialogue.classList.add("show");
  },
  hide() {
    els.dialogue.classList.remove("show");
  },
};

/* ============================================================
   特效
   ============================================================ */
const Effects = {
  hearts(x, y, n = 5) {
    for (let i = 0; i < n; i++) {
      const h = document.createElement("div");
      h.className = "heart-particle";
      h.textContent = ["💗", "💕", "✨"][i % 3];
      h.style.left = x + (Math.random() * 64 - 32) + "px";
      h.style.top = y + (Math.random() * 30 - 15) + "px";
      h.style.animationDelay = i * 90 + "ms";
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 1400);
    }
  },
  targetFlash(targetEl) {
    const f = document.createElement("div");
    f.className = "target__flash";
    targetEl.appendChild(f);
    requestAnimationFrame(() => f.classList.add("go"));
    setTimeout(() => f.remove(), 700);
  },
};

/* ============================================================
   目标点 & 贴纸层渲染
   ============================================================ */
const Stage = {
  targets: new Map(), // target key -> element

  buildTargets() {
    STICKER_DATA.forEach((s, idx) => {
      const t = document.createElement("div");
      t.className = "target";
      t.dataset.target = s.target;
      if (idx > 0) t.classList.add("target--pending"); // 依次出现：只显示第一个
      const dot = document.createElement("div");
      dot.className = "target__dot";
      t.appendChild(dot);
      els.targetLayer.appendChild(t);
      this.targets.set(s.target, t);
    });
    FrameMap.applyAll();
    this.refresh();
  },

  /** 只高亮当前目标；未轮到的隐藏，完成的收起 */
  refresh() {
    const next = GameState.nextSticker();
    this.targets.forEach((el, key) => {
      el.classList.remove("target--active");
      const isDone = el.classList.contains("target--done");
      if (!isDone && key !== next?.target) el.classList.add("target--pending");
    });
    if (next) {
      const el = this.targets.get(next.target);
      if (el) {
        el.classList.remove("target--pending");
        el.classList.add("target--active");
      }
    }
  },

  markDone(targetKey) {
    const el = this.targets.get(targetKey);
    if (!el) return;
    Effects.targetFlash(el);
    el.classList.remove("target--active");
    setTimeout(() => el.classList.add("target--done"), 260);
  },
  placeSticker(s) {
    const p = document.createElement("div");
    p.className = "placed pop-in";
    const img = document.createElement("img");
    img.src = s.sticker;
    img.alt = s.targetName + "贴纸";
    img.draggable = false;
    p.appendChild(img);
    FrameMap.applyTo(p, s);
    els.stickerLayer.appendChild(p);
    FrameMap.placed.push({ el: p, data: s });
    setTimeout(() => p.classList.remove("pop-in"), 600);
  },
};

/* ============================================================
   底部贴纸栏
   ============================================================ */
const Dock = {
  slots: new Map(), // id -> element

  build() {
    STICKER_DATA.forEach((s) => {
      const slot = document.createElement("div");
      slot.className = "dock__slot";
      slot.dataset.id = s.id;
      const img = document.createElement("img");
      img.src = s.sticker;
      img.alt = s.targetName + "贴纸";
      img.draggable = false;
      slot.appendChild(img);
      els.dockRow.appendChild(slot);
      this.slots.set(s.id, slot);
    });
    this.refresh();
  },

  refresh() {
    const next = GameState.nextSticker();
    this.slots.forEach((slot, id) => {
      slot.classList.remove("dock__slot--next", "dock__slot--used", "dock__slot--locked");
      if (GameState.usedIds.has(id)) slot.classList.add("dock__slot--used");
      else if (next && id === next.id) slot.classList.add("dock__slot--next");
      else slot.classList.add("dock__slot--locked");
    });
    els.dockHint.textContent = next
      ? `把「${next.targetName}贴纸」拖到人物${next.targetName}的圆点上 ♪（或点击贴纸再点圆圈）`
      : "五枚贴纸都盖上啦 ✦";
  },

  /** 未命中时的轻微回弹 */
  bump(slot) {
    if (!slot) return;
    slot.classList.remove("dock__slot--shake");
    void slot.offsetWidth;
    slot.classList.add("dock__slot--shake");
    setTimeout(() => slot.classList.remove("dock__slot--shake"), 450);
  },
};

/* ============================================================
   拖拽 / 点击放置（Pointer Events，桌面 + 移动统一）
   ============================================================ */
const StickerDrag = {
  active: null,
  dragging: false,
  moved: false,
  startX: 0, startY: 0,
  slotEl: null,

  enter() {
    els.dockRow.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (e) => this.onMove(e), { passive: false });
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => this.onUp(e, true));
  },

  onDown(e) {
    if (GameState.speaking || GameState.finished) return;
    if (e.button !== undefined && e.button !== 0) return;
    const slot = e.target.closest(".dock__slot");
    if (!slot || slot.classList.contains("dock__slot--used") || slot.classList.contains("dock__slot--locked")) return;
    const next = GameState.nextSticker();
    if (!next || Number(slot.dataset.id) !== next.id) return; // 严格顺序
    this.active = next;
    this.dragging = true;
    this.moved = false;
    this.slotEl = slot;
    this.startX = e.clientX;
    this.startY = e.clientY;
    try { slot.setPointerCapture?.(e.pointerId); } catch (_) {}
    e.preventDefault();
  },

  onMove(e) {
    if (!this.dragging || !this.active) return;
    if (!this.moved && Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > 6) {
      this.moved = true;
      els.ghostImg.src = this.active.sticker;
      els.ghost.classList.remove("is-hidden");
    }
    if (this.moved) {
      els.ghost.style.left = e.clientX + "px";
      els.ghost.style.top = e.clientY + "px";
      e.preventDefault(); // 阻止移动端页面滚动
    }
  },

  onUp(e, cancelled = false) {
    if (!this.dragging || !this.active) return;
    const sticker = this.active;
    const slot = this.slotEl;
    this.dragging = false;
    this.active = null;
    this.slotEl = null;
    els.ghost.classList.add("is-hidden");

    if (cancelled) { Dock.bump(slot); return; }

    if (!this.moved) {
      Placement.start(sticker); // 点击模式
      return;
    }

    if (this.hitTest(e.clientX, e.clientY, sticker)) {
      this.success(sticker, { x: e.clientX, y: e.clientY });
    } else {
      Dock.bump(slot); // 轻微回弹，不消耗贴纸
    }
  },

  /** 落点是否命中目标圆圈（基于圆点本体，宽容半径随舞台缩放） */
  hitTest(clientX, clientY, sticker) {
    const el = Stage.targets.get(sticker.target);
    if (!el) return false;
    const dot = el.querySelector(".target__dot");
    const r = (dot || el).getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const radius = Math.max(els.stage.clientWidth * 0.065, 34);
    return Math.hypot(clientX - cx, clientY - cy) <= radius;
  },

  /** 成功放置 → 好感度 / 视频 / 语音 / 台词 全链路 */
  success(sticker, originClient) {
    // 同一张贴纸的重复 pointer 事件只允许成功一次
    if (GameState.speaking || GameState.finished) return;
    const speechId = ++GameState.speechId;
    GameState.speaking = true;
    Placement.cancel();

    const done = GameState.completeCurrent();
    Stage.markDone(done.target);
    Stage.placeSticker(done);
    Dock.refresh();
    Affection.gain(originClient);

    // 当前台词与当前音频绑定；被浏览器阻止时保留这句，等待真实手势恢复。
    DialogueBox.show(done);
    BGM.duck(true);
    const closeSpeech = (completed) => {
      if (!completed || speechId !== GameState.speechId) return;
      DialogueBox.hide();
      BGM.duck(false);
      VideoMachine.toIdle();
      GameState.speaking = false;
      if (GameState.finished) {
        setTimeout(() => els.finish.classList.add("show"), 420);
      } else {
        Stage.refresh();
        Dock.refresh();
        AudioPlayer.prime();
      }
    };
    AudioPlayer.play(done.audio, {
      onPlaying: () => {
        if (speechId !== GameState.speechId) return;
        DialogueBox.show(done);
        VideoMachine.speak();
        Dock.refresh();
      },
      onBlocked: () => {
        if (speechId !== GameState.speechId) return;
        VideoMachine.toIdle();
        els.dockHint.textContent = "轻点画面，继续播放这句语音";
      },
    }).then(closeSpeech);
  },
};

/* ============================================================
   点击放置模式（点击贴纸 → 点击圆圈）
   ============================================================ */
const Placement = {
  pending: null,

  start(sticker) {
    this.pending = sticker;
    els.pickHint.textContent = `已拿起「${sticker.targetName}贴纸」— 点一下人物${sticker.targetName}上的圆圈放下 ♪`;
    els.pickHint.classList.remove("is-hidden");
    els.stage.addEventListener("pointerdown", this._onStageDown, true);
  },

  _onStageDown(e) {
    if (!Placement.pending) return;
    if (GameState.speaking) { Placement.cancel(); return; }
    const sticker = Placement.pending;
    if (StickerDrag.hitTest(e.clientX, e.clientY, sticker)) {
      Placement.cancel();
      StickerDrag.success(sticker, { x: e.clientX, y: e.clientY });
    } else {
      // 未命中：气泡轻抖提示，保持放置模式
      els.pickHint.classList.add("is-hidden");
      setTimeout(() => {
        if (Placement.pending) els.pickHint.classList.remove("is-hidden");
      }, 260);
    }
  },

  cancel() {
    this.pending = null;
    els.pickHint.classList.add("is-hidden");
    els.stage.removeEventListener("pointerdown", this._onStageDown, true);
  },
};

/* ============================================================
   BGM：默认自动播放，可开关；语音播放时自动压低
   ============================================================ */
const BGM = {
  audio: null,
  on: true,
  enter() {
    this.audio = new Audio(BGM_SRC);
    this.audio.loop = true;
    this.audio.volume = BGM_VOLUME;
    this.audio.preload = "auto";
    const el = document.getElementById("bgm");
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.toggle();
    });
    // 尝试自动播放；被浏览器拦截则等首次交互
    this.audio.play().then(() => {
      this.render();
    }).catch(() => {
      const unlock = () => {
        if (this.on) this.audio.play().catch(() => {});
        window.removeEventListener("pointerdown", unlock);
      };
      window.addEventListener("pointerdown", unlock);
    });
    this.render();
  },
  toggle() {
    this.on = !this.on;
    if (this.on) {
      this.audio.play().catch(() => {});
    } else {
      this.audio.pause();
    }
    this.render();
  },
  /** 语音期间压低，结束恢复 */
  duck(onOff) {
    if (!this.audio) return;
    this.audio.volume = onOff ? 0.16 : BGM_VOLUME;
  },
  render() {
    const el = document.getElementById("bgm");
    if (!el) return;
    el.classList.toggle("bgm--off", !this.on);
    // 图标按钮没有文字节点，不应因此中断音频初始化。
    el.setAttribute("aria-pressed", String(this.on));
  },
};

/* ============================================================
   加载层：预热素材并按真实下载进度推进；完成后淡出再启动游戏。
   只新增这一层，不改动游戏内任何逻辑。
   ============================================================ */
const Loader = {
  el: null,
  fill: null,
  finished: false,
  loaded: 0,
  total: 0,

  assetList() {
    const list = [
      "assets/loading-chibi.png",
      "assets/video/idle.mp4",
      "assets/video/speaking.mp4",
      "assets/audio/bgm.mp3",
    ];
    STICKER_DATA.forEach((s) => {
      list.push(s.sticker, s.audio, s.audio.replace(/\.mp3$/, "-v.mp4"));
    });
    return list;
  },

  start() {
    this.el = document.getElementById("loader");
    this.fill = document.getElementById("loaderFill");
    if (!this.el) { boot(); return; }

    const list = this.assetList();
    let settled = 0;
    const onSettle = () => {
      settled += 1;
      if (settled >= list.length) this.finish();
    };
    list.forEach((url) => {
      this.fetchBytes(url).then(onSettle, onSettle);
    });
    // 兜底：网络异常时不至于永远卡在加载层
    setTimeout(() => this.finish(), 15000);
  },

  /** 流式下载，按真实字节推进进度条 */
  fetchBytes(url) {
    return fetch(url, { cache: "force-cache" }).then((res) => {
      if (!res.ok) throw new Error(url);
      const len = Number(res.headers.get("content-length")) || 0;
      this.total += len;
      if (!res.body || !res.body.getReader) return res.arrayBuffer();
      const reader = res.body.getReader();
      const pump = () => reader.read().then(({ done, value }) => {
        if (done) return;
        if (value) this.loaded += value.length;
        this.render();
        return pump();
      });
      return pump();
    });
  },

  render() {
    if (!this.fill) return;
    const ratio = this.total > 0 ? this.loaded / this.total : 0;
    const pct = Math.max(4, Math.min(100, Math.round(ratio * 100)));
    this.fill.style.width = pct + "%";
  },

  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.fill) this.fill.style.width = "100%";
    boot(); // 素材已就绪，先启动游戏
    setTimeout(() => {
      if (this.el) this.el.classList.add("is-done");
      setTimeout(() => { if (this.el) this.el.style.display = "none"; }, 650);
    }, 220);
  },
};

/* ============================================================
   启动
   ============================================================ */
function boot() {
  VideoMachine.enter();
  Stage.buildTargets();
  Dock.build();
  Affection.enter();
  StickerDrag.enter();
  BGM.enter();

  // 视频元数据就绪后校准画面映射；旋转/缩放时重排（圆点贴纸跟身）
  // 同时测量贴纸栏实际高度，让台词气泡始终悬在其上方
  const measureDock = () => {
    const dock = document.getElementById("dock");
    if (dock) document.documentElement.style.setProperty("--dock-h", dock.offsetHeight + "px");
  };
  FrameMap.calibrate();
  measureDock();
  window.addEventListener("resize", () => { FrameMap.applyAll(); measureDock(); });
  window.addEventListener("orientationchange", () => setTimeout(() => FrameMap.applyAll(), 120));

  AudioPlayer.prime();
  // 只在等待授权/恢复时响应真实手势；正常播放中不重新启动任何媒体。
  ["pointerup", "touchend", "click"].forEach((ev) => {
    window.addEventListener(ev, (event) => {
      if (!event.isTrusted) return;
      AudioPlayer.retryFromGesture();
    }, { passive: true });
  });
}

document.addEventListener("DOMContentLoaded", () => Loader.start());
