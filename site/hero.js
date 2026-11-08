// The app window in the hero: the real app (/demo/) with sample data, shown as a short tour.
//
// - Each stop opens a screen of the demo, lights up the part it's about and explains it in a card,
//   like the app's own first-run tour.
// - On big screens the window stays in view while the page scrolls past it, and scrolling moves the
//   tour along. The page scrolls at its normal speed; nothing is taken over. Elsewhere, Next and
//   Back move it.
// - The demo never takes the page's scroll: a see-through shield covers it until someone chooses to
//   use it ("Try it yourself", or a click in the window). Done, moving the pointer out of the window
//   or tapping outside it gives the page its scroll back and the tour picks up where it was.
(function () {
  var STEPS = [
    { title: "Today", hash: "#/", target: '[data-tour="today"]', body: "Where each day starts: recovery, weigh-in, how you feel, and the session that fits. After a ride it shows how you did against the plan." },
    { title: "Plan", hash: "#/plan", target: '[data-tour="plan"]', body: "Your weeks laid out, recovery weeks built in, and where your fitness lands at the end. Click a day to change it, or drag it to another." },
    { title: "Ride", hash: "#/ride", target: '[data-tour="ride-player"]', body: "Lactic sets the watts on your smart trainer, interval by interval. This demo has a simulated trainer, so you can ride it right here." },
    { title: "Health", hash: "#/health", target: '[data-tour="health"]', body: "Recovery, sleep, HRV, resting heart rate and weight, from your watch or ring. Click any of them for its history." },
    { title: "Progress", hash: "#/progress", target: '[data-tour="progress"]', body: "Fitness, fatigue and form, your power curve and every ride. Every number comes from an open engine." },
    { title: "Coach", hash: "#/", coach: true, target: "aside:not([inert])", body: "Ask why today is hard, or to move Saturday's ride. It reads your numbers and suggests changes for you to apply. Or ride without one." },
  ];

  var tour = document.getElementById("tour");
  var win = document.getElementById("app-window");
  var stage = document.getElementById("app-stage");
  var frame = document.getElementById("app-live");
  var shield = document.getElementById("app-shield");
  var release = document.getElementById("app-release");
  var stepsEl = document.getElementById("tour-steps");
  var loading = document.getElementById("app-loading");
  var spot = document.getElementById("tour-spot");
  var card = document.getElementById("tour-card");
  var countEl = document.getElementById("tour-count");
  var titleEl = document.getElementById("tour-title");
  var bodyEl = document.getElementById("tour-body");
  var hintEl = document.getElementById("tour-hint");
  var backBtn = document.getElementById("tour-back");
  var nextBtn = document.getElementById("tour-next");
  var tryBtn = document.getElementById("tour-try");

  var ready = false;
  var active = false;
  var current = -1;
  var big = matchMedia("(min-width: 900px) and (min-height: 640px)");
  var reduced = matchMedia("(prefers-reduced-motion: reduce)");
  var scrolling = function () { return tour.classList.contains("is-tour"); };

  // Loader: covers the demo until its page is up; from there the app shows the same loader until it has drawn.
  var done = function () {
    loading.hidden = true;
    if (ready) return;
    ready = true;
    if (current >= 0) show(current, true);
  };
  frame.addEventListener("load", done);
  addEventListener("message", function (e) {
    if (e.origin === location.origin && e.data && e.data.lactic === "ready") done();
  });
  try {
    // It may have loaded before this script ran.
    if (frame.contentDocument && frame.contentDocument.readyState === "complete" && frame.contentWindow.location.href !== "about:blank") done();
  } catch (e) {}

  // Using the demo: the tour steps aside.
  function activate() {
    if (active) return;
    active = true;
    win.classList.add("is-active");
    release.hidden = false;
    frame.removeAttribute("tabindex");
    try { frame.contentWindow.focus(); } catch (e) {}
  }
  function deactivate() {
    if (!active) return;
    active = false;
    win.classList.remove("is-active");
    release.hidden = true;
    frame.setAttribute("tabindex", "-1");
    blurDemo();
    if (current >= 0) show(current, true);
  }
  function blurDemo() {
    try { var el = frame.contentDocument.activeElement; if (el && el.blur) el.blur(); } catch (e) {}
  }
  shield.addEventListener("click", activate);
  tryBtn.addEventListener("click", activate);
  release.addEventListener("click", function () { deactivate(); nextBtn.focus(); });
  win.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") deactivate(); });
  document.addEventListener("pointerdown", function (e) { if (!win.contains(e.target)) deactivate(); });

  // The step strip in the title bar.
  STEPS.forEach(function (s, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tour-step";
    b.setAttribute("aria-label", s.title);
    b.title = s.title;
    b.addEventListener("click", function () { go(i); });
    stepsEl.appendChild(b);
  });
  var stepButtons = stepsEl.children;

  function mark(i) {
    for (var k = 0; k < stepButtons.length; k++) {
      stepButtons[k].classList.toggle("on", k === i);
      if (k === i) stepButtons[k].setAttribute("aria-current", "step");
      else stepButtons[k].removeAttribute("aria-current");
    }
    countEl.textContent = i + 1 + " of " + STEPS.length;
    titleEl.textContent = STEPS[i].title;
    bodyEl.textContent = STEPS[i].body;
    var last = i === STEPS.length - 1;
    backBtn.hidden = i === 0;
    nextBtn.textContent = last ? "Try it yourself" : "Next";
    tryBtn.hidden = last;
    hintEl.hidden = !scrolling() || last;
  }

  // Shows step i in the demo and the card.
  function show(i, force) {
    if (i === current && !force) return;
    var was = current;
    current = i;
    mark(i);
    if (!force) card.classList.remove("in");
    place(null);
    if (!ready) return;
    try {
      var w = frame.contentWindow;
      if (was >= 0 && was !== i && STEPS[was].coach) w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
      var moved = w.location.hash !== STEPS[i].hash && !(STEPS[i].hash === "#/" && w.location.hash === "");
      if (moved) w.location.hash = STEPS[i].hash;
      w.scrollTo(0, 0);
      if (STEPS[i].coach) {
        // After a move, the screen redraws first; the drawer opens once it's there.
        setTimeout(function () {
          if (current !== i) return;
          w.dispatchEvent(new w.CustomEvent("coach:open", { detail: {} }));
          // The drawer puts the cursor in its message box; keep the page's keys on the page until someone clicks in.
          setTimeout(function () { if (!active) blurDemo(); }, 150);
        }, moved ? 350 : 0);
      }
    } catch (e) {}
    follow(i);
  }

  // The part a step is about, in the stage's coordinates (null when it isn't on screen).
  function targetRect(i) {
    try {
      var el = frame.contentDocument.querySelector(STEPS[i].target);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      if (!r.width && el.firstElementChild) r = el.firstElementChild.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      var sw = stage.clientWidth, sh = stage.clientHeight;
      var top = Math.max(0, r.top), left = Math.max(0, r.left);
      var bottom = Math.min(sh, r.bottom), right = Math.min(sw, r.right);
      if (bottom - top < 8 || right - left < 8) return null;
      return { top: top, left: left, width: right - left, height: bottom - top };
    } catch (e) {
      return null;
    }
  }

  // Keeps the light on the part while the screen draws (screens load lazily; the drawer slides in).
  var following = 0;
  function follow(i) {
    var run = ++following;
    var tries = 0;
    var last = "";
    (function tick() {
      if (run !== following || current !== i) return;
      var r = targetRect(i);
      var key = r ? [r.top, r.left, r.width, r.height].map(Math.round).join() : "";
      if (key !== last) { last = key; place(r); }
      card.classList.add("in");
      if (++tries < 24) setTimeout(tick, 100);
    })();
  }

  var PAD = 6, GAP = 14;
  function place(r) {
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var cw = card.offsetWidth, ch = card.offsetHeight;
    if (!r || active) {
      spot.classList.remove("on");
      card.style.top = Math.max(16, sh - ch - 20) + "px";
      card.style.left = Math.max(16, (sw - cw) / 2) + "px";
      return;
    }
    spot.classList.add("on");
    spot.style.top = r.top - PAD + "px";
    spot.style.left = r.left - PAD + "px";
    spot.style.width = r.width + PAD * 2 + "px";
    spot.style.height = r.height + PAD * 2 + "px";
    var centered = Math.max(16, Math.min(r.left + r.width / 2 - cw / 2, sw - cw - 16));
    var top, left;
    if (sh - (r.top + r.height) - PAD - GAP >= ch + 16) { top = r.top + r.height + PAD + GAP; left = centered; }
    else if (r.top - PAD - GAP >= ch + 16) { top = r.top - PAD - GAP - ch; left = centered; }
    else if (r.left - PAD - GAP >= cw + 16) { top = Math.max(16, Math.min(r.top + r.height / 2 - ch / 2, sh - ch - 16)); left = r.left - PAD - GAP - cw; }
    else { top = sh - ch - 16; left = 16; }
    card.style.top = top + "px";
    card.style.left = left + "px";
  }

  // The scroll walk, on screens big enough to hold the whole window.
  var STICK = 16;
  function stepLength() { return Math.max(260, innerHeight * 0.45); }

  function onScroll() {
    if (!scrolling()) return;
    var into = STICK - tour.getBoundingClientRect().top;
    show(Math.min(STEPS.length - 1, Math.max(0, Math.floor(into / stepLength()))));
  }

  function go(i) {
    if (i < 0 || i >= STEPS.length) return;
    deactivate();
    if (scrolling()) {
      var top = tour.getBoundingClientRect().top + scrollY - STICK + i * stepLength() + 2;
      scrollTo({ top: top, behavior: reduced.matches ? "auto" : "smooth" });
    } else {
      show(i);
    }
  }
  backBtn.addEventListener("click", function () { go(current - 1); });
  nextBtn.addEventListener("click", function () {
    if (current === STEPS.length - 1) activate();
    else go(current + 1);
  });

  function layout() {
    tour.classList.toggle("is-tour", big.matches);
    tour.style.setProperty("--tour-steps", String(STEPS.length - 1));
    if (scrolling()) onScroll();
    if (current < 0) show(0);
    else show(current, true);
  }

  var queued = false;
  addEventListener("scroll", function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; onScroll(); });
  }, { passive: true });
  if (big.addEventListener) big.addEventListener("change", layout);
  addEventListener("resize", function () { onScroll(); if (current >= 0) place(targetRect(current)); });
  layout();
})();
