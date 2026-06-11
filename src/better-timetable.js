(() => {
  "use strict";

  const SETTINGS_KEY = "tameUowSettings";
  const FILTERS_KEY = "tameUowBetterTimetableFilters";
  const ROOT_ID = "tameuow-better-timetable";
  const STYLE_ID = "tameuow-better-timetable-style";
  const ORIGINAL_SELECTOR = "#toggle-table, #mobile-version, #desktop-version";

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const DAY_SHORT = {
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday"
  };

  let enabled = true;
  let filters = {
    hiddenKinds: [],
    hiddenSubjects: []
  };

  const cleanText = (value) => {
    const text = typeof value === "string" ? value : value?.textContent || "";
    return text.replace(/\s+/g, " ").trim();
  };

  const normaliseClassName = (value) =>
    cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "class";

  const getBaseClassType = (activity, fallback) => {
    const beforeColon = cleanText(activity.split(":")[0]) || fallback;
    const withoutBrackets = beforeColon.replace(/\s*[\[(].*?[\])]\s*/g, " ").trim();
    const withoutOptionSuffix = withoutBrackets
      .replace(/\s+(?:group|grp|stream|option|campus|class)\s+[a-z0-9]+$/i, "")
      .replace(/\s+[a-z]$/i, "")
      .replace(/\s+\d+$/i, "")
      .trim();
    return withoutOptionSuffix || beforeColon || fallback || "Class";
  };

  const minutesFromTime = (time) => {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return 0;
    return Number(match[1]) * 60 + Number(match[2]);
  };

  const formatTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = String(minutes % 60).padStart(2, "0");
    return `${String(hours).padStart(2, "0")}:${mins}`;
  };

  const getTodayName = () =>
    new Intl.DateTimeFormat("en-AU", { weekday: "long" }).format(new Date());

  const getTodayLabel = () =>
    new Intl.DateTimeFormat("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(new Date());

  const parseDetailLines = (text) =>
    text
      .split(/\n|(?=Time:)|(?=Location:)|(?=Weeks:)/)
      .map(cleanText)
      .filter(Boolean);

  const parseMobileTimetable = () => {
    const items = [...document.querySelectorAll("#mobile-version .list-group-item")];
    const events = [];
    let currentDay = "";

    items.forEach((item) => {
      const heading = cleanText(item.querySelector(".list-group-item-heading, h4"));
      if (DAYS.includes(heading)) {
        currentDay = heading;
        return;
      }

      const body = item.querySelector(".list-group-item-text");
      if (!heading || !body || !currentDay) return;

      const [status = "Class", subject = ""] = heading.split(" - ").map(cleanText);
      const lines = parseDetailLines(body.innerText || body.textContent || "");
      const activity = lines.find((line) => !line.startsWith("Time:") && !line.startsWith("Location:") && !line.startsWith("Weeks:")) || "";
      const classType = getBaseClassType(activity, status);
      const timeLine = lines.find((line) => line.startsWith("Time:")) || "";
      const location = (lines.find((line) => line.startsWith("Location:")) || "").replace(/^Location:\s*/i, "");
      const weeks = (lines.find((line) => line.startsWith("Weeks:")) || "").replace(/^Weeks:\s*/i, "");
      const timeMatch = timeLine.match(/Time:\s*(\w{3}),\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i);
      if (!timeMatch) return;

      const day = DAY_SHORT[timeMatch[1]] || currentDay;
      const start = minutesFromTime(timeMatch[2]);
      const end = minutesFromTime(timeMatch[3]);

      events.push({
        id: `${day}-${subject}-${activity}-${start}-${end}-${events.length}`,
        day,
        status,
        classType,
        subject,
        activity,
        location,
        weeks,
        start,
        end,
        duration: Math.max(30, end - start)
      });
    });

    return events;
  };

  const getVisibleEvents = (events) =>
    events.filter((event) =>
      !filters.hiddenKinds.includes(event.classType) &&
      !filters.hiddenSubjects.includes(event.subject)
    );

  const getUniqueValues = (events, key) =>
    [...new Set(events.map((event) => event[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const groupOverlaps = (events) => {
    const byDay = Object.fromEntries(DAYS.map((day) => [day, []]));
    const eventsByDay = Object.fromEntries(DAYS.map((day) => [day, []]));
    events.forEach((event) => eventsByDay[event.day]?.push(event));

    DAYS.forEach((day) => {
      let currentGroup = null;
      eventsByDay[day]
        .sort((a, b) => a.start - b.start || a.end - b.end)
        .forEach((event) => {
          if (!currentGroup || event.start >= currentGroup.end) {
            currentGroup = {
              id: `${day}-${event.start}-${byDay[day].length}`,
              start: event.start,
              end: event.end,
              events: [event]
            };
            byDay[day].push(currentGroup);
            return;
          }

          currentGroup.events.push(event);
          currentGroup.end = Math.max(currentGroup.end, event.end);
        });
    });

    return byDay;
  };

  const createEl = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  const createCheckbox = ({ value, checked, label, onChange }) => {
    const wrapper = createEl("label", "tuow-filter-option");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    wrapper.append(input, createEl("span", "", label));
    return wrapper;
  };

  const saveFilters = async () => {
    await chrome.storage.local.set({ [FILTERS_KEY]: filters });
  };

  const setFilter = async (group, value, visible) => {
    const values = new Set(filters[group]);
    if (visible) {
      values.delete(value);
    } else {
      values.add(value);
    }
    filters = { ...filters, [group]: [...values] };
    await saveFilters();
    apply();
  };

  const createFilterPanel = (allEvents, visibleEvents) => {
    const panel = createEl("div", "tuow-controls panel panel-default");
    const heading = createEl("div", "panel-heading tuow-controls-heading");
    heading.append(
      createEl("strong", "", "Better Timetable"),
      createEl("span", "tuow-date", `Today is ${getTodayLabel()}`)
    );

    const body = createEl("div", "panel-body tuow-controls-body");
    const summary = createEl(
      "div",
      "tuow-summary",
      `${visibleEvents.length} of ${allEvents.length} classes shown`
    );

    const kindGroup = createEl("div", "tuow-filter-group");
    kindGroup.append(createEl("div", "tuow-filter-title", "Class types"));
    getUniqueValues(allEvents, "classType").forEach((kind) => {
      kindGroup.append(createCheckbox({
        value: kind,
        checked: !filters.hiddenKinds.includes(kind),
        label: kind,
        onChange: (checked) => setFilter("hiddenKinds", kind, checked)
      }));
    });

    const subjectGroup = createEl("div", "tuow-filter-group");
    subjectGroup.append(createEl("div", "tuow-filter-title", "Subjects"));
    getUniqueValues(allEvents, "subject").forEach((subject) => {
      subjectGroup.append(createCheckbox({
        value: subject,
        checked: !filters.hiddenSubjects.includes(subject),
        label: subject,
        onChange: (checked) => setFilter("hiddenSubjects", subject, checked)
      }));
    });

    const reset = createEl("button", "btn btn-default btn-sm tuow-reset", "Show all");
    reset.type = "button";
    reset.addEventListener("click", async () => {
      filters = { hiddenKinds: [], hiddenSubjects: [] };
      await saveFilters();
      apply();
    });

    body.append(summary, kindGroup, subjectGroup, reset);
    panel.append(heading, body);
    return panel;
  };

  const fillEventDetails = (container, event) => {
    container.textContent = "";
    const title = createEl("strong", "tuow-event-title", `${event.classType} - ${event.subject}`);
    const details = createEl("div", "tuow-event-details");
    details.append(
      createEl("div", "", `${formatTime(event.start)} - ${formatTime(event.end)}`),
      createEl("div", "", event.activity),
      createEl("div", "", `Status: ${event.status}`),
      createEl("div", "", `Location: ${event.location || "No location listed"}`),
      createEl("div", "", `Weeks: ${event.weeks || "not listed"}`)
    );
    container.append(title, details);
  };

  const createEventCard = (event, minTime) => {
    const card = createEl("article", `tuow-event tuow-${normaliseClassName(event.classType)}`);
    const top = ((event.start - minTime) / 30) * 58 + 16;
    const height = Math.max(50, (event.duration / 30) * 58 - 8);
    card.style.top = `${top}px`;
    card.style.height = `${height}px`;
    card.style.left = "4px";
    card.style.width = "calc(100% - 8px)";

    fillEventDetails(card, event);
    return card;
  };

  const createOverlapCard = (group, minTime) => {
    const card = createEl("article", "tuow-event tuow-overlap");
    const top = ((group.start - minTime) / 30) * 58 + 16;
    const height = Math.max(72, ((group.end - group.start) / 30) * 58 - 8);
    card.style.top = `${top}px`;
    card.style.height = `${height}px`;
    card.style.left = "4px";
    card.style.width = "calc(100% - 8px)";

    const chooser = createEl("div", "tuow-overlap-tabs");
    const detail = createEl("div", "tuow-overlap-detail");

    const selectEvent = (selectedEvent, selectedButton) => {
      chooser.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("active", button === selectedButton);
      });
      fillEventDetails(detail, selectedEvent);
    };

    let firstButton = null;
    group.events.forEach((event, index) => {
      const button = createEl("button", "btn btn-default btn-xs", `${event.classType} ${event.subject}`);
      button.type = "button";
      button.addEventListener("click", () => selectEvent(event, button));
      chooser.append(button);
      if (index === 0) {
        firstButton = button;
      }
    });

    card.append(
      createEl("div", "tuow-overlap-title", `${group.events.length} overlapping classes`),
      chooser,
      detail
    );
    selectEvent(group.events[0], firstButton);
    return card;
  };

  const buildTimeline = (events) => {
    const earliest = events.length ? Math.min(...events.map((event) => event.start)) : 8 * 60;
    const latest = events.length ? Math.max(...events.map((event) => event.end)) : 18 * 60;
    const minTime = Math.max(7 * 60, Math.floor(earliest / 30) * 30);
    const maxTime = Math.min(22 * 60, Math.ceil(latest / 30) * 30);
    const slots = [];
    for (let time = minTime; time <= maxTime; time += 30) slots.push(time);
    return { minTime, maxTime, slots };
  };

  const renderEmptyDay = () => createEl("div", "tuow-empty-day", "No visible classes");

  const renderBetterTimetable = () => {
    const allEvents = parseMobileTimetable();
    if (!allEvents.length) return null;

    const visibleEvents = getVisibleEvents(allEvents);
    const { minTime, maxTime, slots } = buildTimeline(visibleEvents.length ? visibleEvents : allEvents);
    const byDay = groupOverlaps(visibleEvents);
    const today = getTodayName();
    const root = createEl("section", "");
    root.id = ROOT_ID;

    root.append(createFilterPanel(allEvents, visibleEvents));

    const table = createEl("div", "table-responsive tuow-table-wrap");
    const grid = createEl("div", "tuow-grid table table-striped table-bordered");

    const timeColumn = createEl("div", "tuow-time-column");
    timeColumn.append(createEl("div", "tuow-day-heading", "Time/Day"));
    const timeBody = createEl("div", "tuow-time-body");
    timeBody.style.height = `${((maxTime - minTime) / 30) * 58 + 16}px`;
    slots.slice(0, -1).forEach((slot) => {
      const label = createEl("div", "tuow-time-label", formatTime(slot));
      label.style.top = `${((slot - minTime) / 30) * 58 + 16}px`;
      timeBody.append(label);
    });
    timeColumn.append(timeBody);
    grid.append(timeColumn);

    DAYS.forEach((day) => {
      const dayColumn = createEl("section", `tuow-day ${day === today ? "tuow-today" : ""}`);
      dayColumn.append(createEl("h4", "tuow-day-heading", day));
      const dayBody = createEl("div", "tuow-day-body");
      dayBody.style.height = `${((maxTime - minTime) / 30) * 58 + 16}px`;
      slots.slice(0, -1).forEach((slot) => {
        const line = createEl("div", "tuow-slot-line");
        line.style.top = `${((slot - minTime) / 30) * 58 + 16}px`;
        dayBody.append(line);
      });
      if (byDay[day].length) {
        byDay[day].forEach((group) => {
          dayBody.append(group.events.length > 1
            ? createOverlapCard(group, minTime)
            : createEventCard(group.events[0], minTime));
        });
      } else {
        dayBody.append(renderEmptyDay());
      }
      dayColumn.append(dayBody);
      grid.append(dayColumn);
    });

    table.append(grid);
    root.append(table);
    return root;
  };

  const injectStyles = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        margin: 10px 0 20px;
      }
      #${ROOT_ID} .panel {
        border-radius: 4px;
      }
      .tuow-controls-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .tuow-date {
        color: #555;
        font-size: 13px;
        font-weight: 400;
      }
      .tuow-controls-body {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        flex-wrap: wrap;
      }
      .tuow-summary {
        min-width: 150px;
        padding: 6px 0;
        font-weight: 700;
      }
      .tuow-filter-group {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        max-width: 100%;
      }
      .tuow-filter-title {
        margin-right: 2px;
        color: #555;
        font-weight: 700;
      }
      .tuow-filter-option {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin: 0;
        padding: 4px 8px;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: #fff;
        font-size: 12px;
        font-weight: 400;
        cursor: pointer;
      }
      .tuow-filter-option input {
        margin: 0;
      }
      .tuow-reset {
        margin-left: auto;
      }
      .tuow-table-wrap {
        margin-top: 10px;
      }
      .tuow-grid {
        display: grid;
        grid-template-columns: 72px repeat(5, minmax(150px, 1fr));
        min-width: 100%;
        margin-bottom: 0;
        border-right: 0;
        border-bottom: 0;
      }
      .tuow-time-column,
      .tuow-day {
        border-right: 1px solid #ddd;
        background: #fff;
      }
      .tuow-day-heading {
        min-height: 38px;
        margin: 0;
        padding: 9px 8px;
        border-bottom: 1px solid #ddd;
        background: #f5f5f5;
        color: #333;
        font-size: 13px;
        font-weight: 700;
        text-align: center;
      }
      .tuow-today .tuow-day-heading {
        background: #d9edf7;
        color: #31708f;
      }
      .tuow-time-body,
      .tuow-day-body {
        position: relative;
        background: #fff;
      }
      .tuow-time-body {
        background: #f9f9f9;
      }
      .tuow-time-label {
        position: absolute;
        left: 0;
        right: 0;
        transform: translateY(-7px);
        color: #555;
        font-size: 12px;
        text-align: center;
      }
      .tuow-slot-line {
        position: absolute;
        left: 0;
        right: 0;
        border-top: 1px solid #eee;
      }
      .tuow-slot-line:nth-child(odd) {
        border-top-color: #ddd;
      }
      .tuow-event {
        position: absolute;
        z-index: 2;
        padding: 7px 8px;
        overflow: auto;
        border: 1px solid #bbb;
        border-left: 10px solid #9393c9;
        border-radius: 0;
        background: #fff;
        color: #333;
        line-height: 1.28;
        white-space: normal;
      }
      .tuow-lecture {
        border-left-color: #d8cdc9;
        background: #fafafa;
      }
      .tuow-overlap {
        border-left-color: #f0ad4e;
        background: #fcf8e3;
      }
      .tuow-overlap-title {
        margin-bottom: 5px;
        color: #8a6d3b;
        font-size: 12px;
        font-weight: 700;
      }
      .tuow-overlap-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 6px;
      }
      .tuow-overlap-tabs .btn {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tuow-overlap-tabs .btn.active {
        color: #fff;
        background: #337ab7;
        border-color: #2e6da4;
      }
      .tuow-event-title {
        display: block;
        padding-bottom: 4px;
        border-bottom: 2px solid currentColor;
        font-size: 13px;
        white-space: normal;
      }
      .tuow-event-details {
        margin-top: 5px;
        font-size: 12px;
      }
      .tuow-event-details div {
        overflow-wrap: anywhere;
      }
      .tuow-empty-day {
        padding: 12px;
        color: #777;
        font-size: 12px;
        text-align: center;
      }
      @media (max-width: 760px) {
        .tuow-controls-heading {
          align-items: flex-start;
          flex-direction: column;
        }
        .tuow-controls-body {
          display: grid;
        }
        .tuow-reset {
          margin-left: 0;
          width: max-content;
        }
        .tuow-grid {
          grid-template-columns: 68px repeat(5, minmax(170px, 1fr));
          min-width: 918px;
        }
      }
    `;
    document.head.append(style);
  };

  const setOriginalVisibility = (hide) => {
    document.querySelectorAll(ORIGINAL_SELECTOR).forEach((node) => {
      node.hidden = hide;
    });
  };

  const removeBetterTimetable = () => {
    document.getElementById(ROOT_ID)?.remove();
    setOriginalVisibility(false);
  };

  const apply = () => {
    removeBetterTimetable();
    if (!enabled) return;
    injectStyles();
    const better = renderBetterTimetable();
    if (!better) return;
    const content = document.getElementById("content") || document.body;
    const firstTimetableNode = document.getElementById("toggle-table")?.parentElement ||
      document.getElementById("mobile-version") ||
      document.getElementById("desktop-version");
    content.insertBefore(better, firstTimetableNode || content.firstChild);
    setOriginalVisibility(true);
  };

  const loadState = async () => {
    const data = await chrome.storage.local.get([SETTINGS_KEY, FILTERS_KEY]);
    enabled = data[SETTINGS_KEY]?.betterTimetableEnabled !== false;
    filters = {
      hiddenKinds: data[FILTERS_KEY]?.hiddenKinds || [],
      hiddenSubjects: data[FILTERS_KEY]?.hiddenSubjects || []
    };
  };

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    enabled = changes[SETTINGS_KEY].newValue?.betterTimetableEnabled !== false;
    apply();
  });

  const init = async () => {
    await loadState();
    apply();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
