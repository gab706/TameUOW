(() => {
  "use strict";

  const SETTINGS_KEY = "betterUowSettings";
  const BUTTON_SELECTOR = 'input[type="submit"][value="I have read the Message"]:not(:disabled)';

  const cleanText = (value) => value?.replace(/\s+/g, " ").trim() || "";

  const findMessageContainer = (button) =>
    button.closest("form")?.closest("table, .panel, .row, div") ||
    button.closest("table, .panel, .row, div") ||
    document.body;

  const getMessageTitle = (container, index) => {
    const heading = container.querySelector("h1, h2, h3, h4, strong, b");
    const text = cleanText(heading?.textContent || container.textContent);
    const withoutAction = text.replace(/I have read the Message/gi, "").trim();
    return withoutAction.slice(0, 140) || `SOLSMail message ${index + 1}`;
  };

  const isEnabled = async () => {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    return data[SETTINGS_KEY]?.solsAutoReadEnabled !== false;
  };

  const recordSkippedMessages = (items) => {
    if (!items.length) return;
    chrome.runtime.sendMessage({
      type: "record-blocked-items",
      kind: "sols",
      items
    });
  };

  const run = async () => {
    if (!(await isEnabled())) return;
    if (!document.body.innerText.includes("SOLSMail Message")) return;

    const buttons = [...document.querySelectorAll(BUTTON_SELECTOR)];
    const items = buttons.map((button, index) => {
      const container = findMessageContainer(button);
      return {
        kind: "sols",
        title: getMessageTitle(container, index),
        detail: cleanText(container.textContent).slice(0, 500),
        url: location.href,
        at: new Date().toISOString()
      };
    });

    recordSkippedMessages(items);
    buttons.forEach((button) => button.click());
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
