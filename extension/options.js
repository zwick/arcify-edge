const menuDefaults = { copyUrlsMenu: false, splitSelectedMenu: true };

(async () => {
  const settings = await chrome.storage.sync.get(menuDefaults);
  for (const key of Object.keys(menuDefaults)) {
    const input = document.getElementById(key);
    input.checked = settings[key];
    input.addEventListener("change", () => chrome.storage.sync.set({ [key]: input.checked }));
  }
})();
