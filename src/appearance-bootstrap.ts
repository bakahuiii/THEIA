try {
  const stored = localStorage.getItem("theia-appearance-v1");
  const mode = ["light", "dark", "system"].includes(stored || "")
    ? stored!
    : "system";
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.dataset.appearance = mode;
} catch {
  // React applies the default system mode once it mounts.
}
