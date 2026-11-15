// The saved light or dark theme, set before the first paint. A file of its own (not inline in
// index.html) so the app's content security policy can allow scripts from the app only.
try {
  var t = localStorage.getItem("mycoach:theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  // High contrast: "high", or unset (System) with the OS's Increase contrast on. See web/lib/theme.ts.
  var c = localStorage.getItem("lactic:contrast");
  if (c === "high" || (c !== "standard" && matchMedia("(prefers-contrast: more)").matches)) document.documentElement.dataset.contrast = "more";
} catch (e) {}
