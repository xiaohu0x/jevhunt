(function () {
  function set(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("jh-theme", theme); } catch { /* optional */ }
  }
  try { set(localStorage.getItem("jh-theme") === "light" ? "light" : "dark"); } catch { /* optional */ }
  document.getElementById("pageTheme")?.addEventListener("click", () => set(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
})();
