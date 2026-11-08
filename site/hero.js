// The app window in the hero: the real app (/demo/) with sample data.
//
// - The demo sits behind a see-through shield, so the wheel and touch scroll the page, not the app.
//   Click (or tap) to use it; move the pointer out of the window, tap outside or press Done to give
//   the page its scroll back.
// - On big screens the window stays in view while the page scrolls past it, and the scroll walks the
//   demo through its screens. The page scrolls at its normal speed; nothing is taken over.
(function () {
  var STEPS = [
    { name: "Today", hash: "#/", text: "Recovery, weigh-in and the session that fits, each morning." },
    { name: "Plan", hash: "#/plan", text: "Twelve weeks laid out, recovery weeks built in." },
    { name: "Ride", hash: "#/ride", text: "ERG on your smart trainer. Try the simulated one." },
    { name: "Health", hash: "#/health", text: "Sleep, HRV and resting heart rate from your watch." },
    { name: "Progress", hash: "#/progress", text: "Fitness, fatigue and form, from an open engine." },
    { name: "Coach", hash: "#/", coach: true, text: "Ask why today is hard. It reads your numbers." },
  ];

  var tour = document.getElementById("tour");
  var win = document.getElementById("app-window");
  var frame = document.getElementById("app-live");
  var shield = document.getElementById("app-shield");
  var release = document.getElementById("app-release");
  var caption = document.getElementById("tour-caption");
  var stepsEl = document.getElementById("tour-steps");
  var loading = document.getElementById("app-loading");

  var ready = false;
  var active = false;
  var current = -1;

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

  // Using the demo.
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
    try { var el = frame.contentDocument.activeElement; if (el && el.blur) el.blur(); } catch (e) {}
  }
  shield.addEventListener("click", activate);
  release.addEventListener("click", function () { deactivate(); shield.focus(); });
  win.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") deactivate(); });
  document.addEventListener("pointerdown", function (e) { if (!win.contains(e.target)) deactivate(); });

  // Steps: a small strip in the window's title bar.
  STEPS.forEach(function (s, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tour-step";
    b.setAttribute("aria-label", s.name);
    b.title = s.name;
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
    caption.innerHTML = "";
    var b = document.createElement("b");
    b.textContent = STEPS[i].name;
    caption.appendChild(b);
    caption.appendChild(document.createTextNode(" " + STEPS[i].text));
  }

  // Shows step i in the demo (and in the strip).
  function show(i, force) {
    if (i === current && !force) return;
    var was = current;
    current = i;
    mark(i);
    if (!ready) return;
    try {
      var w = frame.contentWindow;
      if (was >= 0 && STEPS[was].coach && !STEPS[i].coach) w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
      var moved = w.location.hash !== STEPS[i].hash && !(STEPS[i].hash === "#/" && w.location.hash === "");
      if (moved) w.location.hash = STEPS[i].hash;
      w.scrollTo(0, 0);
      if (STEPS[i].coach) {
        // After a move, the screen redraws first; the drawer opens once it's there.
        setTimeout(function () {
          if (current !== i) return;
          w.dispatchEvent(new w.CustomEvent("coach:open", { detail: {} }));
          // The drawer puts the cursor in its message box; keep the page's keys on the page until someone clicks in.
          setTimeout(function () { if (!active) { var el = frame.contentDocument.activeElement; if (el && el.blur) el.blur(); } }, 120);
        }, moved ? 350 : 0);
      }
    } catch (e) {}
  }

  // The scroll walk, on screens big enough to hold the whole window.
  var big = matchMedia("(min-width: 900px) and (min-height: 640px)");
  var STICK = 16;
  function stepLength() { return Math.max(260, innerHeight * 0.45); }

  function onScroll() {
    if (!tour.classList.contains("is-tour")) return;
    var into = STICK - tour.getBoundingClientRect().top;
    var i = Math.min(STEPS.length - 1, Math.max(0, Math.floor(into / stepLength())));
    show(i);
  }

  function go(i) {
    if (tour.classList.contains("is-tour")) {
      var top = tour.getBoundingClientRect().top + scrollY - STICK + i * stepLength() + 2;
      deactivate();
      scrollTo({ top: top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } else {
      show(i);
    }
  }

  function layout() {
    var on = big.matches;
    tour.classList.toggle("is-tour", on);
    tour.style.setProperty("--tour-steps", String(STEPS.length - 1));
    if (on) onScroll();
    else if (current < 0) mark((current = 0));
  }

  var queued = false;
  addEventListener("scroll", function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; onScroll(); });
  }, { passive: true });
  if (big.addEventListener) big.addEventListener("change", layout);
  addEventListener("resize", onScroll);
  layout();

  // Keeps the strip in step when someone moves around the demo themselves.
  frame.addEventListener("load", function () {
    try {
      frame.contentWindow.addEventListener("hashchange", function () {
        if (!active) return;
        var h = frame.contentWindow.location.hash || "#/";
        for (var k = 0; k < STEPS.length; k++) if (!STEPS[k].coach && STEPS[k].hash === h) { current = k; mark(k); return; }
      });
    } catch (e) {}
  });
})();
