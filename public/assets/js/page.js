(function () {
  function set(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("jh-theme", theme); } catch { /* optional */ }
  }
  let theme = "light";
  try { theme = localStorage.getItem("jh-theme") === "dark" ? "dark" : "light"; } catch { /* optional */ }
  set(theme);
  document.getElementById("pageTheme")?.addEventListener("click", () => set(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
})();
