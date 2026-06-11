(() => {
  "use strict";

  const SETTINGS_KEY = "tameUowSettings";
  const BRIDGE_EVENT = "tameuow:moodle-popup-blocked";

  let blocking = true;
  let pendingItems = [];
  let pendingTimer;

  const setBlocking = (value) => {
    blocking = Boolean(value);
    window.postMessage({ type: "tameuow:set-moodle-blocking", blocking }, location.origin);
  };

  const loadSettings = async () => {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    setBlocking(data[SETTINGS_KEY]?.moodlePopupBlockingEnabled !== false);
  };

  const describePopup = (el, method) => {
    const heading = el.querySelector("#bluePopupHeading, h1, h2, h3, h4, .modal-title")?.textContent?.trim();
    const text = el.textContent?.replace(/\s+/g, " ").trim() || "";
    return {
      kind: "moodle",
      title: heading || text.slice(0, 140) || "Unnamed Moodle popup",
      detail: text.slice(0, 500) || `Blocked by ${method}`,
      url: location.href,
      at: new Date().toISOString()
    };
  };

  const flushPendingItems = () => {
    const items = pendingItems;
    pendingItems = [];
    pendingTimer = undefined;
    if (!items.length) return;

    chrome.runtime.sendMessage({
      type: "record-blocked-items",
      kind: "moodle",
      items
    });
  };

  const recordPopup = (item) => {
    pendingItems.push(item);
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flushPendingItems, 500);
  };

  const blockPopup = (el, method) => {
    if (!el || !blocking) return;
    const item = describePopup(el, method);
    el.remove();
    recordPopup(item);
  };

  const observe = () => {
    new MutationObserver((mutations) => {
      if (!blocking) return;
      mutations.forEach((mutation) => {
        [...mutation.addedNodes].forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const el = node.id === "dvBlueTasksPrompt"
            ? node
            : node.closest?.("#dvBlueTasksPrompt") || node.querySelector?.("#dvBlueTasksPrompt");
          if (el) blockPopup(el, "mutation");
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  };

  const injectBridge = () => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/moodle-page-bridge.js");
    script.dataset.initialBlocking = String(blocking);
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  };

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    setBlocking(changes[SETTINGS_KEY].newValue?.moodlePopupBlockingEnabled !== false);
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type !== BRIDGE_EVENT || !blocking) return;
    const el = document.getElementById(event.data.id);
    blockPopup(el, event.data.method || "ClosePopup");
  });

  const init = async () => {
    await loadSettings();
    observe();
    injectBridge();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
