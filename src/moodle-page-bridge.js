(() => {
  "use strict";

  const script = document.currentScript;
  let blocking = script?.dataset.initialBlocking === "true";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === "betteruow:set-moodle-blocking") {
      blocking = Boolean(event.data.blocking);
    }
  });

  const notifyBlocked = (id, method) => {
    window.postMessage({
      type: "betteruow:moodle-popup-blocked",
      id,
      method
    }, location.origin);
  };

  const override = (bm) => {
    if (!bm?.ClosePopup || bm.__betteruowClosePopupWrapped) return true;

    const original = bm.ClosePopup;
    bm.ClosePopup = function closePopup(id = "dvOuter") {
      const el = document.getElementById(id);
      if (!el) return original.call(this, id);

      const target = el.id === "dvBlueTasksPrompt"
        ? el
        : el.closest?.("#dvBlueTasksPrompt") || el.querySelector?.("#dvBlueTasksPrompt");

      if (blocking && target) {
        if (!target.id) target.id = `betteruow-blocked-popup-${Date.now()}`;
        notifyBlocked(target.id, "ClosePopup");
        return undefined;
      }

      return original.call(this, id);
    };

    bm.__betteruowClosePopupWrapped = true;
    return true;
  };

  let tries = 100;
  const timer = setInterval(() => {
    if (override(window.BLUE_MOODLE) || --tries <= 0) {
      clearInterval(timer);
    }
  }, 100);
})();
