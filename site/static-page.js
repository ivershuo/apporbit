import { bindChrome } from "./shared.js";
bindChrome();

document.querySelectorAll("[data-copy-command]").forEach((button) => {
  button.addEventListener("click", async () => {
    const command = button.parentElement?.querySelector("code")?.textContent?.trim();
    if (!command) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(command);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }
    window.setTimeout(() => { button.textContent = "Copy command"; }, 2000);
  });
});
