// Download buttons: start the installer for this computer and show its install steps in a popup.
// Without this script the buttons open the GitHub releases page.
(function () {
  var dialog = document.getElementById("download-dialog");
  if (!dialog || typeof dialog.showModal !== "function") return;

  var ua = navigator.userAgent || "";
  var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  var os = null;
  if (/android|iphone|ipad|ipod/i.test(ua) || (/mac/i.test(platform) && navigator.maxTouchPoints > 1)) os = "phone";
  else if (/mac/i.test(platform) || /Mac OS X/.test(ua)) os = "mac";
  else if (/win/i.test(platform) || /Windows/.test(ua)) os = "windows";
  else if (/linux|x11|cros/i.test(platform) || /Linux|X11/.test(ua)) os = "appimage";

  var NAMES = {
    mac: ["Mac", "Apple silicon or Intel, macOS 11 or later"],
    windows: ["Windows", "Windows 10 or 11, 64-bit"],
    appimage: ["Linux", "AppImage, 64-bit"],
    deb: ["Linux", "Debian and Ubuntu, 64-bit"],
  };
  var release = null;
  var $ = function (id) { return document.getElementById(id); };
  var url = function (get) { return "/api/release?get=" + get; };

  function show(get) {
    var known = NAMES[get];
    $("dl-title").textContent = known ? "Downloading Lactic for " + known[0] : os === "phone" ? "Lactic runs on your computer" : "Download Lactic";
    var meta = [];
    if (release && release.version) meta.push("Version " + release.version);
    if (known) meta.push(known[1]);
    var file = known && release && release.installers && release.installers[get];
    if (file) meta.push(Math.round(file.size / 1e6) + " MB");
    $("dl-meta").textContent = meta.join(" · ");
    dialog.querySelectorAll("[data-os]").forEach(function (el) { el.hidden = el.getAttribute("data-os") !== (known ? get : os); });
    dialog.querySelectorAll("[data-get]").forEach(function (a) { a.hidden = a.getAttribute("data-get") === get; });
    $("dl-again").hidden = !known;
    $("dl-again-link").href = url(get);
    $("dl-other-title").textContent = known ? "Other systems" : "Choose your system";
  }

  // Detected computers download straight away; phones and unknown systems pick in the popup.
  document.querySelectorAll("[data-download]").forEach(function (button) {
    if (NAMES[os]) button.href = url(os);
    button.addEventListener("click", function (event) {
      if (!NAMES[os]) event.preventDefault();
      show(NAMES[os] ? os : null);
      dialog.showModal();
    });
  });
  var label = document.querySelector("[data-download-label]");
  if (label && NAMES[os]) label.textContent = "Download for " + NAMES[os][0];

  dialog.querySelectorAll("[data-get]").forEach(function (a) {
    a.addEventListener("click", function () { show(a.getAttribute("data-get")); });
  });
  dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });

  fetch("/api/release").then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (!data) return;
    release = data;
    if (data.notes) $("dl-notes").href = data.notes;
  }).catch(function () {});
})();
