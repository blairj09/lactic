// Downloads page: suggest the installer for this computer and fill in the version and sizes.
// Every link already works without this script (it points at /api/release?get=…).
(function () {
  var ua = navigator.userAgent || "";
  var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  var os = null;
  if (/android|iphone|ipad|ipod/i.test(ua) || (/mac/i.test(platform) && navigator.maxTouchPoints > 1)) os = "phone";
  else if (/mac/i.test(platform) || /Mac OS X/.test(ua)) os = "mac";
  else if (/win/i.test(platform) || /Windows/.test(ua)) os = "windows";
  else if (/linux|x11|cros/i.test(platform) || /Linux|X11/.test(ua)) os = "linux";

  var picks = {
    mac: { get: "mac", label: "Download for Mac", meta: "Apple silicon (M1 or later)" },
    windows: { get: "windows", label: "Download for Windows", meta: "Windows 10 or 11, 64-bit" },
    linux: { get: "appimage", label: "Download for Linux", meta: "AppImage, 64-bit" },
  };
  var pick = picks[os];
  var $ = function (id) { return document.getElementById(id); };

  if (os === "phone") $("dl-phone").hidden = false;
  if (pick) {
    $("dl-pick").hidden = false;
    $("dl-primary").href = "/api/release?get=" + pick.get;
    $("dl-primary-label").textContent = pick.label;
    $("dl-primary-meta").textContent = pick.meta;
    var card = document.querySelector('.dl-card[data-os="' + os + '"]');
    if (card) { card.classList.add("is-yours"); card.parentNode.insertBefore(card, card.parentNode.firstChild); }
  }

  function mb(bytes) { return Math.round(bytes / 1e6) + " MB"; }
  fetch("/api/release").then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (!data || !data.version) return;
    $("dl-version").textContent = "Version " + data.version + ".";
    if (data.notes) $("dl-notes").href = data.notes;
    var i = data.installers || {};
    document.querySelectorAll("[data-size]").forEach(function (el) {
      var a = i[el.getAttribute("data-size")];
      if (a) el.textContent = mb(a.size);
    });
    if (pick && i[pick.get]) $("dl-primary-meta").textContent = pick.meta + " · " + mb(i[pick.get].size);
  }).catch(function () {});
})();
