// The app window in the hero: the real app (/demo/) with sample data, shown as a short tour.
//
// - Each stop opens a screen of the demo, lights up the part it's about and explains it in a card,
//   like the app's own first-run tour. Back, Next and the step strip move it along.
// - Exit tour (or a click in the window) hands the demo over to explore; Take the tour brings it back.
// - Full screen (the title bar's button, "Ride a workout here" links and the last stop) fills the
//   window with the live app for a ride, on the visitor's own trainer or the simulated one.
// - The demo never takes the page's scroll: while the tour shows, or once the pointer leaves the
//   window (or someone taps outside it, or presses Done), a see-through shield covers it so the wheel
//   and touch scroll the page. A click puts it back in use.
(function () {
  var STEPS = [
    { title: "Today", hash: "#/", target: '[data-tour="today"]', body: "Where each day starts: today's workout and Start ride up top, with this morning's recovery beside it. After a ride it shows how you did against the plan." },
    { title: "Plan", hash: "#/plan", target: '[data-tour="plan"]', body: "Your weeks laid out, recovery weeks built in, and where your fitness lands at the end. Click a day to change it, or drag it to another." },
    { title: "Progress", hash: "#/progress", target: '[data-tour="progress"]', body: "Trends for fitness, fatigue, form and your power curve. Rides for every ride on a calendar or a list. Every number comes from an open engine." },
    { title: "Health", hash: "#/health", target: '[data-tour="health"]', body: "Last night up top: recovery, sleep, HRV and resting heart rate against your usual range. Then weight and more. Click any of them for its history." },
    { title: "Coach", hash: "#/", coach: true, target: "aside:not([inert])", body: "Ask why today is hard, or to move Saturday's ride. It reads your numbers and suggests changes for you to apply. Or ride without one." },
    { title: "Ride", hash: "#/ride", target: ['[data-tour="ride-player"]', '[data-tour="ride"]'], corner: true, body: "Ride a workout right here. Connect your trainer in Chrome or Edge, or use the simulated one. Your ride lands in the app like any other." },
  ];
  var win = document.getElementById("app-window");
  var stage = document.getElementById("app-stage");
  var frame = document.getElementById("app-live");
  var shield = document.getElementById("app-shield");
  var release = document.getElementById("app-release");
  var restart = document.getElementById("tour-restart");
  var stepsEl = document.getElementById("tour-steps");
  var loading = document.getElementById("app-loading");
  var spot = document.getElementById("tour-spot");
  var card = document.getElementById("tour-card");
  var countEl = document.getElementById("tour-count");
  var titleEl = document.getElementById("tour-title");
  var bodyEl = document.getElementById("tour-body");
  var backBtn = document.getElementById("tour-back");
  var nextBtn = document.getElementById("tour-next");
  var exitBtn = document.getElementById("tour-exit");
  var fullBtn = document.getElementById("app-full");
  var exitFullBtn = document.getElementById("app-exit-full");

  var ready = false;
  var touring = true; // the tour is showing
  var active = false; // someone is using the demo
  var current = 0;
  var full = false; // the live app fills the window
  var pending = null; // a screen to open once the demo is up

  function blurDemo() {
    try { var el = frame.contentDocument.activeElement; if (el && el.blur) el.blur(); } catch (e) {}
  }

  // Exploring: the tour steps aside and the demo takes clicks, keys and its own scroll.
  function activate() {
    if (touring) endTour();
    if (active) return;
    active = true;
    win.classList.add("is-active");
    release.hidden = false;
    frame.removeAttribute("tabindex");
    try { frame.contentWindow.focus(); } catch (e) {}
  }
  // Back to the page: the shield covers the demo again, so the wheel scrolls the page.
  function deactivate() {
    if (!active || full) return;
    active = false;
    win.classList.remove("is-active");
    release.hidden = true;
    frame.setAttribute("tabindex", "-1");
    blurDemo();
  }

  function endTour() {
    touring = false;
    win.classList.remove("is-touring");
    restart.hidden = false;
    spot.classList.remove("on");
    card.classList.remove("in");
    if (STEPS[current].coach) closeCoach();
  }
  function startTour() {
    deactivate();
    touring = true;
    win.classList.add("is-touring");
    restart.hidden = true;
    show(0, true);
    nextBtn.focus({ preventScroll: true });
  }

  // Full screen: the live app fills the window, ready to ride.
  function openFull(hash) {
    if (touring) endTour();
    full = true;
    win.classList.add("is-full");
    document.documentElement.classList.add("app-full-open");
    activate();
    if (!hash) return;
    if (!ready) { pending = hash; return; }
    try { frame.contentWindow.location.hash = hash; frame.contentWindow.scrollTo(0, 0); } catch (e) {}
  }
  function closeFull() {
    if (!full) return;
    full = false;
    win.classList.remove("is-full");
    document.documentElement.classList.remove("app-full-open");
    if (location.hash === "#ride") history.replaceState(null, "", location.pathname + location.search);
    deactivate();
    win.scrollIntoView({ block: "center" });
    fullBtn.focus({ preventScroll: true });
  }
  fullBtn.addEventListener("click", function () { openFull(null); });
  exitFullBtn.addEventListener("click", closeFull);
  // Escape leaves full screen, unless it is closing the download dialog.
  addEventListener("keydown", function (e) { if (e.key === "Escape" && full && !document.querySelector("dialog[open]")) closeFull(); });
  document.querySelectorAll("[data-ride]").forEach(function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); openFull("#/ride"); });
  });

  shield.addEventListener("click", activate);
  exitBtn.addEventListener("click", activate);
  restart.addEventListener("click", startTour);
  release.addEventListener("click", function () { deactivate(); restart.focus(); });
  win.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") deactivate(); });
  document.addEventListener("pointerdown", function (e) { if (!win.contains(e.target)) deactivate(); });
  card.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") go(current + 1);
    if (e.key === "ArrowLeft") go(current - 1);
    if (e.key === "Escape") { endTour(); restart.focus(); }
  });

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
    nextBtn.textContent = last ? "Ride it full screen" : "Next";
    exitBtn.hidden = last;
  }

  function closeCoach() {
    try { var w = frame.contentWindow; w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" })); } catch (e) {}
  }

  // Shows step i in the demo and the card.
  function show(i, force) {
    if (i === current && !force) return;
    var was = current;
    current = i;
    mark(i);
    // The last card goes at once; the new one fades in once its part has settled.
    card.style.transition = spot.style.transition = "none";
    card.classList.remove("in");
    spot.classList.remove("on");
    void card.offsetWidth;
    card.style.transition = spot.style.transition = "";
    if (!ready) return;
    try {
      var w = frame.contentWindow;
      if (was !== i && STEPS[was].coach) closeCoach();
      var moved = w.location.hash !== STEPS[i].hash && !(STEPS[i].hash === "#/" && w.location.hash === "");
      if (moved) w.location.hash = STEPS[i].hash;
      w.scrollTo(0, 0);
      if (STEPS[i].coach) {
        // After a move, the screen redraws first; the drawer opens once it's there.
        setTimeout(function () {
          if (current !== i || !touring) return;
          w.dispatchEvent(new w.CustomEvent("coach:open", { detail: {} }));
          // The drawer puts the cursor in its message box; keep the keys on the tour card.
          setTimeout(function () { if (!active) { blurDemo(); nextBtn.focus({ preventScroll: true }); } }, 150);
        }, moved ? 350 : 0);
      }
    } catch (e) {}
    follow(i);
  }

  function go(i) {
    if (i < 0 || i >= STEPS.length) return;
    if (!touring) startTour();
    show(i);
  }
  backBtn.addEventListener("click", function () { go(current - 1); });
  nextBtn.addEventListener("click", function () {
    if (current === STEPS.length - 1) openFull("#/ride");
    else go(current + 1);
  });

  // The part a step is about, in the stage's coordinates (null when it isn't on screen).
  function targetRect(i) {
    try {
      // The phone layout has the tabs twice (a bottom tab bar), so take the one that's showing.
      // A step can list fallbacks (the phone's Ride screen has no player until a workout is picked,
      // so the light goes to its Ride tab).
      var targets = [].concat(STEPS[i].target);
      var sw = stage.clientWidth, sh = stage.clientHeight;
      for (var t = 0; t < targets.length; t++) {
        var els = frame.contentDocument.querySelectorAll(targets[t]);
        for (var k = 0; k < els.length; k++) {
          var r = els[k].getBoundingClientRect();
          if (!r.width && els[k].firstElementChild) r = els[k].firstElementChild.getBoundingClientRect();
          var top = Math.max(0, r.top), left = Math.max(0, r.left);
          var bottom = Math.min(sh, r.bottom), right = Math.min(sw, r.right);
          if (bottom - top >= 8 && right - left >= 8) return { top: top, left: left, width: right - left, height: bottom - top };
        }
      }
      return null;
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
    var shown = false;
    // The card waits until the part has settled in place (two reads alike), so it doesn't land
    // somewhere else first and then jump; after a second and a half it shows wherever it can.
    (function tick() {
      if (run !== following || current !== i || !touring) return;
      var r = targetRect(i);
      var key = r ? [r.top, r.left, r.width, r.height].map(Math.round).join() : "";
      var settled = r && key === last;
      if (!shown && (settled || tries >= 15)) {
        // Straight to its spot, without sliding over from the last one.
        card.style.transition = spot.style.transition = "none";
        place(r);
        void card.offsetWidth;
        card.style.transition = spot.style.transition = "";
        card.classList.add("in");
        shown = true;
      } else if (shown && key !== last) {
        place(r);
      }
      last = key;
      if (++tries < 30) setTimeout(tick, 100);
    })();
  }

  var PAD = 6, GAP = 14;
  function place(r) {
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var cw = card.offsetWidth, ch = card.offsetHeight;
    if (!r) {
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
    // The Ride screen settles a moment after it opens (the gear panel shrinks once the sensors are
    // connected), so its card sits in the top corner, clear of the part, and only the light follows.
    if (STEPS[current].corner) { top = 16; left = sw - cw - 16; }
    else if (sh - (r.top + r.height) - PAD - GAP >= ch + 16) { top = r.top + r.height + PAD + GAP; left = centered; }
    else if (r.top - PAD - GAP >= ch + 16) { top = r.top - PAD - GAP - ch; left = centered; }
    else if (r.left - PAD - GAP >= cw + 16) { top = Math.max(16, Math.min(r.top + r.height / 2 - ch / 2, sh - ch - 16)); left = r.left - PAD - GAP - cw; }
    else { top = sh - ch - 16; left = 16; }
    card.style.top = top + "px";
    card.style.left = left + "px";
  }

  addEventListener("resize", function () { if (touring) place(targetRect(current)); });
  win.classList.add("is-touring");
  mark(0);

  // Loader: covers the demo until its page is up; from there the app shows the same loader until it has drawn.
  var done = function () {
    loading.hidden = true;
    if (ready) return;
    ready = true;
    if (pending) { var hash = pending; pending = null; openFull(hash); }
    else if (touring) show(current, true);
  };
  frame.addEventListener("load", done);
  addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.lactic === "ready") done();
    // The demo's "Great start." card: the download for this computer, from the page's own button.
    if (e.data.lactic === "download") { var dl = document.querySelector(".hero [data-download], [data-download]"); if (dl) dl.click(); }
  });
  // lactic.fit/#ride (and the old lactic.fit/ride) opens the live app on Ride.
  if (location.hash === "#ride") openFull("#/ride");
  try {
    // It may have loaded before this script ran.
    if (frame.contentDocument && frame.contentDocument.readyState === "complete" && frame.contentWindow.location.href !== "about:blank") done();
  } catch (e) {}
})();
