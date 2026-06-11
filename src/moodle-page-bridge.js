(() => {
  "use strict";

  const script = document.currentScript;
  let blocking = script?.dataset.initialBlocking === "true";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === "tameuow:set-moodle-blocking") {
      blocking = Boolean(event.data.blocking);
    }
  });

  const notifyBlocked = (id, method) => {
    window.postMessage({
      type: "tameuow:moodle-popup-blocked",
      id,
      method
    }, location.origin);
  };

  const override = (bm) => {
    if (!bm?.ClosePopup || bm.__tameuowClosePopupWrapped) return true;

    const original = bm.ClosePopup;
    bm.ClosePopup = function closePopup(id = "dvOuter") {
      const el = document.getElementById(id);
      if (!el) return original.call(this, id);

      const target = el.id === "dvBlueTasksPrompt"
        ? el
        : el.closest?.("#dvBlueTasksPrompt") || el.querySelector?.("#dvBlueTasksPrompt");

      if (blocking && target) {
        if (!target.id) target.id = `tameuow-blocked-popup-${Date.now()}`;
        notifyBlocked(target.id, "ClosePopup");
        return undefined;
      }

      return original.call(this, id);
    };

    bm.__tameuowClosePopupWrapped = true;
    return true;
  };

  let tries = 100;
  const timer = setInterval(() => {
    if (override(window.BLUE_MOODLE) || --tries <= 0) {
      clearInterval(timer);
    }
  }, 100);
})();
