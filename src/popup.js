const state = {
  activeKind: "sols",
  activeView: "settings",
  items: {
    sols: [],
    moodle: []
  },
  settings: {
    solsAutoReadEnabled: true,
    moodlePopupBlockingEnabled: true,
    betterTimetableEnabled: true
  }
};

const labels = {
  sols: "SOLS",
  moodle: "Moodle"
};

const settingKeys = [
  "solsAutoReadEnabled",
  "moodlePopupBlockingEnabled",
  "betterTimetableEnabled"
];

const send = (message) => chrome.runtime.sendMessage(message);

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
};

const renderBuildInfo = () => {
  const manifest = chrome.runtime.getManifest();
  document.getElementById("build-name").textContent = manifest.name || "TameUOW";
  document.getElementById("build-version").textContent = manifest.version || "-";
  document.getElementById("build-date").textContent = "Local unpacked build";
};

const renderViews = () => {
  document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === state.activeView);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${state.activeView}-view`);
  });
};

const renderSettings = () => {
  document.getElementById("sols-toggle").checked = state.settings.solsAutoReadEnabled;
  document.getElementById("moodle-toggle").checked = state.settings.moodlePopupBlockingEnabled;
  document.getElementById("timetable-toggle").checked = state.settings.betterTimetableEnabled;

  const enabledCount = settingKeys.filter((key) => state.settings[key]).length;
  document.getElementById("enabled-count").textContent = `${enabledCount}/${settingKeys.length}`;
};

const renderHistory = () => {
  document.getElementById("sols-count").textContent = state.items.sols.length;
  document.getElementById("moodle-count").textContent = state.items.moodle.length;

  document.querySelectorAll(".history-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.kind === state.activeKind);
  });

  const items = state.items[state.activeKind] || [];
  const list = document.getElementById("items");
  const empty = document.getElementById("empty-state");
  list.textContent = "";
  empty.style.display = items.length ? "none" : "block";
  empty.textContent = `No ${labels[state.activeKind]} items recorded yet.`;

  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "item";

    const title = document.createElement("p");
    title.className = "item-title";
    title.textContent = item.title || "Untitled item";

    const detail = document.createElement("p");
    detail.className = "item-detail";
    detail.textContent = item.detail || "";

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = formatDate(item.at);

    li.append(title, detail, meta);
    list.appendChild(li);
  });
};

const render = () => {
  renderViews();
  renderSettings();
  renderHistory();
  renderBuildInfo();
};

const load = async () => {
  const response = await send({ type: "get-blocked-items" });
  if (response?.ok) {
    state.items = { ...state.items, ...response.state };
    state.settings = { ...state.settings, ...response.settings };
  }
  render();
};

const updateSettings = async (nextSettings) => {
  state.settings = { ...state.settings, ...nextSettings };
  render();
  const response = await send({
    type: "update-settings",
    settings: state.settings
  });
  if (response?.ok) {
    state.settings = { ...state.settings, ...response.settings };
    render();
  }
};

document.querySelectorAll(".view-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeView = tab.dataset.view;
    render();
  });
});

document.querySelectorAll(".history-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeKind = tab.dataset.kind;
    render();
  });
});

document.getElementById("clear-all").addEventListener("click", async () => {
  const response = await send({ type: "clear-blocked-items" });
  if (response?.ok) {
    state.items = { ...state.items, ...response.state };
    render();
  }
});

document.getElementById("sols-toggle").addEventListener("change", (event) => {
  updateSettings({ solsAutoReadEnabled: event.target.checked });
});

document.getElementById("moodle-toggle").addEventListener("change", (event) => {
  updateSettings({ moodlePopupBlockingEnabled: event.target.checked });
});

document.getElementById("timetable-toggle").addEventListener("change", (event) => {
  updateSettings({ betterTimetableEnabled: event.target.checked });
});

load();
