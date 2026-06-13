const STORAGE_KEY = "betterUowBlockedItems";
const SETTINGS_KEY = "betterUowSettings";
const UOW_DATES_URL = "https://www.uow.edu.au/student/dates/";
const MAX_ITEMS_PER_KIND = 100;

const NOTIFICATION_MESSAGES = {
  sols: (count) => `${count} SOLS message(s) skipped and marked as read.`,
  moodle: (count) => `${count} Moodle popup(s) blocked.`
};

const emptyState = () => ({
  sols: [],
  moodle: []
});

const defaultSettings = () => ({
  solsAutoReadEnabled: true,
  moodlePopupBlockingEnabled: true,
  betterTimetableEnabled: true
});

const readState = async () => {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return { ...emptyState(), ...(data[STORAGE_KEY] || {}) };
};

const readSettings = async () => {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...defaultSettings(), ...(data[SETTINGS_KEY] || {}) };
};

const writeSettings = async (settings) => {
  const nextSettings = { ...defaultSettings(), ...settings };
  await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
  return nextSettings;
};

const writeState = async (state) => {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  await updateBadge(state);
};

const getTotalCount = (state) =>
  Object.values(state).reduce((total, items) => total + items.length, 0);

const updateBadge = async (state) => {
  const total = getTotalCount(state);
  await chrome.action.setBadgeText({ text: total ? String(total) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
};

const normaliseItem = (message) => ({
  kind: message.kind,
  title: message.title || "Untitled item",
  detail: message.detail || "",
  url: message.url || "",
  at: message.at || new Date().toISOString()
});

const recordItems = async (items) => {
  const state = await readState();

  for (const item of items.map(normaliseItem)) {
    if (!state[item.kind]) continue;
    state[item.kind] = [item, ...state[item.kind]].slice(0, MAX_ITEMS_PER_KIND);
  }

  await writeState(state);
  return state;
};

const showNotification = async (kind, count) => {
  if (!count) return;

  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: "BetterUOW",
      message: `${NOTIFICATION_MESSAGES[kind]?.(count) || `${count} item(s) recorded.`} Click the extension icon to review the list.`
    });
  } catch (error) {
    console.warn("BetterUOW notification failed:", error);
  }
};

chrome.runtime.onInstalled.addListener(async () => {
  await updateBadge(await readState());
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge(await readState());
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "record-blocked-items") {
      const items = Array.isArray(message.items) ? message.items : [];
      const state = await recordItems(items);
      await showNotification(message.kind, items.length);
      sendResponse({ ok: true, state });
      return;
    }

    if (message?.type === "get-blocked-items") {
      sendResponse({ ok: true, state: await readState(), settings: await readSettings() });
      return;
    }

    if (message?.type === "update-settings") {
      const settings = await writeSettings(message.settings || {});
      sendResponse({ ok: true, settings });
      return;
    }

    if (message?.type === "clear-blocked-items") {
      const state = await readState();
      if (message.kind && state[message.kind]) {
        state[message.kind] = [];
        await writeState(state);
        sendResponse({ ok: true, state });
        return;
      }

      await writeState(emptyState());
      sendResponse({ ok: true, state: emptyState() });
      return;
    }

    if (message?.type === "fetch-uow-dates") {
      const response = await fetch(UOW_DATES_URL, { credentials: "omit" });
      if (!response.ok) {
        throw new Error(`UOW dates request failed: ${response.status}`);
      }
      sendResponse({ ok: true, url: response.url, html: await response.text() });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })().catch((error) => {
    console.warn("BetterUOW background message failed:", error);
    sendResponse({ ok: false, error: error?.message || String(error) });
  });

  return true;
});
