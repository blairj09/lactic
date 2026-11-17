// Vercel Web Analytics (cookieless) for every lactic.fit page. Download clicks are sent as visits
// to /download/<system> (download.js). Our own traffic is kept out of the numbers:
//   - lactic.fit/?count=off (any page) stops counting this browser for good; ?count=on undoes it.
//   - automated browsers (Playwright, headless Chrome, Lighthouse, crawlers) are never counted.
//   - only lactic.fit itself counts: pull request previews and local copies don't.
(function () {
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  try {
    var c = new URLSearchParams(location.search).get("count");
    if (c === "off") localStorage.setItem("va-disable", "1");
    if (c === "on") localStorage.removeItem("va-disable");
  } catch (e) {}

  function optedOut() {
    try { return Boolean(localStorage.getItem("va-disable")); } catch (e) { return false; }
  }
  var robot = navigator.webdriver === true || /HeadlessChrome|Lighthouse|PTST|bot\b|crawl|spider|slurp|preview/i.test(navigator.userAgent || "");
  var live = /^(www\.)?lactic\.fit$/.test(location.hostname);
  if (!live || robot || optedOut()) return;

  window.va("beforeSend", function (event) { return optedOut() ? null : event; });
  var s = document.createElement("script");
  s.defer = true;
  s.src = "/_vercel/insights/script.js";
  document.head.appendChild(s);
})();
