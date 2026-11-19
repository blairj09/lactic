// Floating Download / Try a ride bar: shows once the hero's buttons scroll out of view, and hides
// again near the closing Download band, while the live demo is in use, or back at the top.
(function () {
  var bar = document.getElementById("float-cta");
  var hero = document.querySelector(".hero-side .buttons");
  var band = document.getElementById("download");
  var demo = document.getElementById("app-window");
  if (!bar || !hero || !("IntersectionObserver" in window)) return;

  var pastHero = false;
  var bandInView = false;

  function update() {
    var show = pastHero && !bandInView && !(demo && demo.classList.contains("is-active"));
    bar.classList.toggle("is-on", show);
    if (show) bar.removeAttribute("inert"); else bar.setAttribute("inert", "");
  }

  new IntersectionObserver(function (entries) {
    var e = entries[0];
    pastHero = !e.isIntersecting && e.boundingClientRect.top < 0;
    update();
  }).observe(hero);

  if (band) new IntersectionObserver(function (entries) {
    bandInView = entries[0].isIntersecting;
    update();
  }, { rootMargin: "0px 0px -80px 0px" }).observe(band);

  if (demo && "MutationObserver" in window) new MutationObserver(update).observe(demo, { attributes: true, attributeFilter: ["class"] });
})();
