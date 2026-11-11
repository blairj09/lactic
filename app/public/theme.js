// The saved light or dark theme, set before the first paint. A file of its own (not inline in
// index.html) so the app's content security policy can allow scripts from the app only.
try {
  var t = localStorage.getItem("mycoach:theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
