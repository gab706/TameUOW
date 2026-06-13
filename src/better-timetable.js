(() => {
  "use strict";

  const SETTINGS_KEY = "tameUowSettings";
  const FILTERS_KEY = "tameUowBetterTimetableFilters";
  const SELECTED_WEEK_KEY = "tameUowBetterTimetableSelectedWeek";
  const DB_NAME = "TameUOW";
  const DB_VERSION = 1;
  const SESSION_STORE = "sessionDates";
  const SESSION_CACHE_KEY = "uow-session-dates";
  const ROOT_ID = "tameuow-better-timetable";
  const STYLE_ID = "tameuow-better-timetable-style";
  const ORIGINAL_SELECTOR = "#toggle-table, #mobile-version, #desktop-version";
  const MONTHS = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11
  };

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const DAY_SHORT = {
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday"
  };

  let enabled = true;
  let sessionCache = null;
  let sessionStatus = "loading";
  let sessionStatusDetail = "";
  let selectedWeekState = null;
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

  const toDateOnly = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const toISODate = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");

  const fromISODate = (value) => {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const addDays = (date, days) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };

  const isWithinRange = (date, range) =>
    Boolean(range?.start && range?.end &&
      date >= fromISODate(range.start) &&
      date <= fromISODate(range.end));

  const openTimetableDB = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const readSessionCache = async () => {
    const db = await openTimetableDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(SESSION_STORE, "readonly").objectStore(SESSION_STORE).get(SESSION_CACHE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  };

  const writeSessionCache = async (cache) => {
    const db = await openTimetableDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE, "readwrite");
      tx.objectStore(SESSION_STORE).put({ ...cache, id: SESSION_CACHE_KEY });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
  };

  const hasRequiredSessionFields = (cache) =>
    cache?.year &&
    cache?.semester &&
    cache?.semesterStart &&
    Array.isArray(cache?.semesterCutoffs) &&
    cache?.semesterEnd &&
    Array.isArray(cache?.teachingRanges) &&
    cache?.periods &&
    Array.isArray(cache?.periods?.exams);

  const fetchDatesHtml = async () => {
    const response = await chrome.runtime.sendMessage({ type: "fetch-uow-dates" });
    if (response?.ok && response.html) {
      return response.html;
    }
    const direct = await fetch("https://www.uow.edu.au/student/dates/", { credentials: "omit" });
    if (!direct.ok) {
      throw new Error(response?.error || `Unable to fetch UOW dates page: ${direct.status}`);
    }
    return direct.text();
  };

  const parseWeekRange = (activity) => {
    const match = cleanText(activity).match(/weeks?\s+(\d+)\s*[–-]\s*(\d+)/i);
    if (!match) return null;
    return {
      startWeek: Number(match[1]),
      endWeek: Number(match[2])
    };
  };

  const parseDatePart = (part, fallbackMonth, fallbackYear) => {
    const match = cleanText(part).match(/(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
    if (!match) return null;
    const month = MONTHS[match[2].toLowerCase()] ?? fallbackMonth;
    const year = Number(match[3] || fallbackYear);
    if (!Number.isFinite(year) || month === undefined) return null;
    return new Date(year, month, Number(match[1]));
  };

  const parseDateRange = (value, fallbackYear) => {
    const text = cleanText(value).replace(/\u00a0/g, " ");
    const parts = text.split(/\s+[–-]\s+/);
    if (parts.length === 1) {
      const date = parseDatePart(parts[0], undefined, fallbackYear);
      return date ? { start: date, end: date } : null;
    }

    const end = parseDatePart(parts[1], undefined, fallbackYear);
    if (!end) return null;
    const start = parseDatePart(parts[0], end.getMonth(), end.getFullYear());
    if (!start) return null;
    if (end < start) end.setFullYear(end.getFullYear() + 1);
    return { start, end };
  };

  const extractSessionDates = (html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const sessions = [];

    [...doc.querySelectorAll('[role="tab"], .tabs-title a')].forEach((tab) => {
      const label = cleanText(tab);
      const sessionMatch = label.match(/^(Autumn|Spring|Summer)\s+Session\s+(\d{4})(?:\/(\d{4}))?/i);
      if (!sessionMatch) return;

      const semester = sessionMatch[1].toLowerCase();
      const year = Number(sessionMatch[2]);
      const panel = doc.querySelector(tab.getAttribute("href"));
      if (!panel) return;

      const teachingRanges = [];
      const periods = {
        midSessionRecesses: [],
        studyRecesses: [],
        exams: [],
        endSessionBreaks: []
      };

      panel.querySelectorAll("tbody tr").forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 2) return;
        const activity = cleanText(cells[0]);
        const dateText = cleanText(cells[1]);
        const dateRange = parseDateRange(dateText, year);
        if (!dateRange) return;

        if (/Lectures Commence|Lectures Recommence/i.test(activity)) {
          const weekRange = parseWeekRange(activity);
          if (weekRange) {
            teachingRanges.push({
              ...weekRange,
              start: toISODate(dateRange.start),
              end: toISODate(dateRange.end)
            });
          }
        } else if (/Mid-Session Recess/i.test(activity)) {
          periods.midSessionRecesses.push({
            start: toISODate(dateRange.start),
            end: toISODate(dateRange.end)
          });
        } else if (/Study Recess/i.test(activity)) {
          periods.studyRecesses.push({
            start: toISODate(dateRange.start),
            end: toISODate(dateRange.end)
          });
        } else if (/Exams?/i.test(activity)) {
          periods.exams.push({
            start: toISODate(dateRange.start),
            end: toISODate(dateRange.end)
          });
        } else if (/End of session break|Mid-Year Recess/i.test(activity)) {
          periods.endSessionBreaks.push({
            start: toISODate(dateRange.start),
            end: toISODate(dateRange.end)
          });
        }
      });

      if (!teachingRanges.length) return;
      teachingRanges.sort((a, b) => a.startWeek - b.startWeek);
      Object.values(periods).forEach((ranges) => ranges.sort((a, b) => a.start.localeCompare(b.start)));
      const endSessionBreak = periods.endSessionBreaks[0] || null;
      const finalExam = periods.exams[periods.exams.length - 1] || null;
      const finalStudyRecess = periods.studyRecesses[periods.studyRecesses.length - 1] || null;
      const activeEnd = endSessionBreak
        ? toISODate(addDays(fromISODate(endSessionBreak.start), -1))
        : finalExam?.end || finalStudyRecess?.end || teachingRanges[teachingRanges.length - 1].end;
      sessions.push({
        key: `${semester}-${year}`,
        year,
        semester,
        semesterStart: teachingRanges[0].start,
        semesterCutoffs: periods.midSessionRecesses,
        semesterEnd: activeEnd,
        teachingRanges,
        periods,
        endSessionBreak
      });
    });

    return sessions;
  };

  const chooseCurrentSession = (sessions, date = new Date()) => {
    const today = toDateOnly(date);
    const sorted = [...sessions].sort((a, b) => a.semesterStart.localeCompare(b.semesterStart));
    const current = sorted.find((session) =>
      today >= fromISODate(session.semesterStart) &&
      today <= fromISODate(session.semesterEnd)
    );
    if (current) return current;

    const previous = [...sorted].reverse().find((session) => today > fromISODate(session.semesterEnd));
    const next = sorted.find((session) => today < fromISODate(session.semesterStart));
    return {
      year: next?.year || previous?.year || today.getFullYear(),
      semester: "break",
      semesterStart: previous?.semesterEnd || toISODate(today),
      semesterCutoffs: [],
      semesterEnd: next?.semesterStart || toISODate(today),
      teachingRanges: [],
      periods: {
        midSessionRecesses: [],
        studyRecesses: [],
        exams: [],
        endSessionBreaks: previous?.endSessionBreak ? [previous.endSessionBreak] : []
      },
      endSessionBreak: previous?.endSessionBreak || null,
      periodLabel: "End of session break",
      breakBetween: {
        previous: previous ? { year: previous.year, semester: previous.semester, semesterEnd: previous.semesterEnd } : null,
        next: next ? { year: next.year, semester: next.semester, semesterStart: next.semesterStart } : null
      }
    };
  };

  const getSessionCache = async () => {
    const cached = await readSessionCache();
    if (hasRequiredSessionFields(cached)) {
      sessionStatus = "cached";
      sessionStatusDetail = "Using cached UOW dates.";
      return cached;
    }

    const sessions = extractSessionDates(await fetchDatesHtml());
    const current = chooseCurrentSession(sessions);
    if (!current) throw new Error("No UOW Autumn, Spring, or Summer session dates found.");

    const cache = {
      year: current.year,
      semester: current.semester,
      semesterStart: current.semesterStart,
      semesterCutoffs: current.semesterCutoffs,
      semesterEnd: current.semesterEnd,
      teachingRanges: current.teachingRanges,
      periods: current.periods,
      endSessionBreak: current.endSessionBreak || null,
      periodLabel: current.periodLabel || null,
      breakBetween: current.breakBetween || null,
      storedAt: new Date().toISOString()
    };
    await writeSessionCache(cache);
    sessionStatus = "fetched";
    sessionStatusDetail = "Fetched and cached UOW dates.";
    return cache;
  };

  const getEventSession = (event) => {
    const sessionName = event.session?.toLowerCase();
    if (!["autumn", "spring", "summer"].includes(sessionName)) return null;
    return {
      semester: sessionName,
      year: event.sessionYear
    };
  };

  const isSameSession = (eventSession, activeSession) =>
    Boolean(eventSession && activeSession &&
      eventSession.semester === activeSession.semester &&
      eventSession.year === activeSession.year);

  const getCurrentTeachingWeek = (session, date = new Date()) => {
    const today = toDateOnly(date);
    for (const range of session.teachingRanges) {
      const start = fromISODate(range.start);
      const end = fromISODate(range.end);
      if (today < start || today > end) continue;
      const weeksSinceStart = Math.floor((today - start) / (7 * 24 * 60 * 60 * 1000));
      return range.startWeek + weeksSinceStart;
    }
    return null;
  };

  const getDisplayTeachingWeek = (session, date = new Date()) => {
    const today = toDateOnly(date);
    const ranges = [...session.teachingRanges].sort((a, b) => a.startWeek - b.startWeek);
    const activeWeek = getCurrentTeachingWeek(session, today);
    if (activeWeek) return activeWeek;

    const nextRange = ranges.find((range) => today < fromISODate(range.start));
    if (nextRange) return nextRange.startWeek;
    return null;
  };

  const getSessionKey = (session) =>
    session?.semester && session?.year ? `${session.semester}-${session.year}` : "";

  const formatSessionName = (session) =>
    session?.semester ? `${session.semester[0].toUpperCase()}${session.semester.slice(1)} ${session.year}` : "";

  const formatDateRangeDate = (date) =>
    new Intl.DateTimeFormat("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(date);

  const getMaxTeachingWeek = (session) =>
    Math.max(...(session?.teachingRanges || []).map((range) => range.endWeek), 0);

  const getSelectedWeek = (session) => {
    if (!session || session.semester === "break") return null;
    const maxWeek = getMaxTeachingWeek(session);
    if (!maxWeek) return null;
    const sessionKey = getSessionKey(session);
    if (selectedWeekState?.sessionKey === sessionKey) {
      const selectedValue = selectedWeekState?.value;
      if (selectedValue && !/^\d+$/.test(String(selectedValue))) return null;
      const selectedWeek = Number(selectedValue || selectedWeekState?.week);
      if (selectedWeek >= 1 && selectedWeek <= maxWeek) {
        return selectedWeek;
      }
    }
    return getDisplayTeachingWeek(session) || maxWeek;
  };

  const normaliseDateRange = (range) => {
    if (!range?.start || !range?.end) return null;
    return {
      start: fromISODate(range.start),
      end: fromISODate(range.end)
    };
  };

  const getSelectableDateRanges = (session) => {
    if (!session || session.semester === "break") return [];
    const ranges = [];
    const maxWeek = getMaxTeachingWeek(session);
    for (let week = 1; week <= maxWeek; week += 1) {
      const dateRange = getTeachingWeekDateRange(session, week);
      if (dateRange) ranges.push({ value: String(week), week, ...dateRange });
    }

    [
      ...(session.periods?.midSessionRecesses || []),
      ...(session.periods?.studyRecesses || []),
      ...(session.periods?.exams || [])
    ].forEach((period, index) => {
      const dateRange = normaliseDateRange(period);
      if (!dateRange) return;
      ranges.push({
        value: `period-${index}-${period.start}`,
        week: null,
        ...dateRange
      });
    });

    return ranges.sort((a, b) => a.start - b.start);
  };

  const getSelectedDateRangeOption = (session) => {
    const ranges = getSelectableDateRanges(session);
    if (!ranges.length) return null;
    const sessionKey = getSessionKey(session);
    if (selectedWeekState?.sessionKey === sessionKey && selectedWeekState?.value) {
      const selected = ranges.find((range) => range.value === String(selectedWeekState.value));
      if (selected) return selected;
    }
    const today = toDateOnly(new Date());
    const currentRange = ranges.find((range) => today >= toDateOnly(range.start) && today <= toDateOnly(range.end));
    if (currentRange) return currentRange;
    const selectedWeek = getSelectedWeek(session);
    return ranges.find((range) => range.week === selectedWeek) || ranges[ranges.length - 1];
  };

  const getTeachingWeekDateRange = (session, week) => {
    const range = (session?.teachingRanges || []).find((item) => week >= item.startWeek && week <= item.endWeek);
    if (!range) return null;
    const start = addDays(fromISODate(range.start), (week - range.startWeek) * 7);
    return {
      start,
      end: addDays(start, 4)
    };
  };

  const getTeachingWeekDateRangeLabel = (session, week) => {
    const range = getTeachingWeekDateRange(session, week);
    if (!range) return "";
    return `${formatDateRangeDate(range.start)} - ${formatDateRangeDate(range.end)}`;
  };

  const getCurrentPeriodLabel = (session, date = new Date()) => {
    if (!session) return "";
    if (session.semester === "break") return session.periodLabel || "End of session break";

    const today = toDateOnly(date);
    if ((session.periods?.midSessionRecesses || []).some((range) => isWithinRange(today, range))) {
      return "mid-session recess";
    }
    if ((session.periods?.studyRecesses || []).some((range) => isWithinRange(today, range))) {
      return "study recess";
    }
    if ((session.periods?.exams || []).some((range) => isWithinRange(today, range))) {
      return "exam period";
    }
    return "teaching period";
  };

  const saveSelectedWeek = async (value) => {
    const numericWeek = Number(value);
    selectedWeekState = {
      sessionKey: getSessionKey(sessionCache),
      value: String(value),
      week: Number.isFinite(numericWeek) && numericWeek > 0 ? numericWeek : null
    };
    await chrome.storage.local.set({ [SELECTED_WEEK_KEY]: selectedWeekState });
  };

  const parseWeeks = (value) => {
    const weeks = new Set();
    cleanText(value).split(",").forEach((part) => {
      const match = part.trim().match(/^(\d+)(?:\s*[–-]\s*(\d+))?$/);
      if (!match) return;
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      for (let week = start; week <= end; week += 1) weeks.add(week);
    });
    return weeks;
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
    const subjectSessions = getSubjectSessions();
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
      const sessionInfo = subjectSessions.get(subject) || {};
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
        session: sessionInfo.session || "",
        sessionYear: sessionInfo.year || new Date().getFullYear(),
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

  const getSubjectSessions = () => {
    const sessions = new Map();
    document.querySelectorAll(".timetable .available, .timetable .not-available, .timetable .full, .timetable .enrolled, .timetable .lecture")
      .forEach((cell) => {
        const text = cleanText(cell);
        const match = text.match(/\b(Autumn|Spring|Summer|Annual)\s*-\s*([A-Z]{2,}\d{3})\b/i);
        if (!match) return;
        sessions.set(match[2], {
          session: match[1],
          year: new Date().getFullYear()
        });
      });
    return sessions;
  };

  const getCurrentWeekEvents = (events) =>
    events.filter(shouldShowThisWeek);

  const getFilteredEvents = (events) =>
    events.filter((event) =>
      !filters.hiddenKinds.includes(event.classType) &&
      !filters.hiddenSubjects.includes(event.subject)
    );

  const shouldShowThisWeek = (event) => {
    if (!sessionCache) return true;
    if (sessionCache.semester === "break") return false;
    const eventSession = getEventSession(event);
    const activeSession = sessionCache;

    if (eventSession && activeSession && !isSameSession(eventSession, activeSession)) return false;
    if (!event.weeks) return true;

    const selectedWeek = getSelectedWeek(activeSession);
    if (!selectedWeek) return false;
    return parseWeeks(event.weeks).has(selectedWeek);
  };

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

  const createWeekSelector = (session) => {
    const ranges = getSelectableDateRanges(session);
    if (!ranges.length) return null;
    const selected = getSelectedDateRangeOption(session);

    const wrapper = createEl("label", "tuow-week-picker");
    const label = createEl("span", "", "Show");
    const select = document.createElement("select");
    select.className = "form-control input-sm tuow-week-select";
    select.value = selected?.value || ranges[0].value;

    ranges.forEach((range) => {
      const option = document.createElement("option");
      option.value = range.value;
      option.textContent = `${formatDateRangeDate(range.start)} - ${formatDateRangeDate(range.end)}`;
      select.append(option);
    });

    select.value = selected?.value || ranges[0].value;
    select.addEventListener("change", async () => {
      await saveSelectedWeek(select.value);
      apply();
    });
    wrapper.append(label, select);
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

  const createFilterPanel = (weekEvents, visibleEvents) => {
    const panel = createEl("div", "tuow-controls panel panel-default");
    const heading = createEl("div", "panel-heading tuow-controls-heading");
    heading.append(
      createEl("strong", "", "Timetable Plus"),
      createEl("span", "tuow-date", `Today is ${getTodayLabel()}`)
    );

    const body = createEl("div", "panel-body tuow-controls-body");
    const activeSession = sessionCache?.semester === "break" ? null : sessionCache;
    const selectedRange = activeSession ? getSelectedDateRangeOption(activeSession) : null;
    const periodLabel = getCurrentPeriodLabel(sessionCache);
    const selectedWeekRange = selectedRange
      ? `${formatDateRangeDate(selectedRange.start)} - ${formatDateRangeDate(selectedRange.end)}`
      : "";
    const sessionLabel = activeSession
      ? selectedWeekRange || formatSessionName(activeSession)
      : periodLabel;
    const weekStatusText = sessionStatus === "failed"
      ? sessionStatusDetail
      : sessionCache
        ? sessionLabel
        : "Showing all scheduled weeks while UOW dates load.";
    const weekStatus = createEl("div", `tuow-week-status tuow-week-status-${sessionStatus}`, weekStatusText);
    body.append(weekStatus);
    const weekPicker = activeSession ? createWeekSelector(activeSession) : null;
    if (weekPicker) body.append(weekPicker);

    if (!weekEvents.length) {
      panel.append(heading, body);
      return panel;
    }

    const summary = createEl(
      "div",
      "tuow-summary",
      `${visibleEvents.length} of ${weekEvents.length} classes shown`
    );

    const kindGroup = createEl("div", "tuow-filter-group");
    kindGroup.append(createEl("div", "tuow-filter-title", "Class types"));
    getUniqueValues(weekEvents, "classType").forEach((kind) => {
      kindGroup.append(createCheckbox({
        value: kind,
        checked: !filters.hiddenKinds.includes(kind),
        label: kind,
        onChange: (checked) => setFilter("hiddenKinds", kind, checked)
      }));
    });

    const subjectGroup = createEl("div", "tuow-filter-group");
    subjectGroup.append(createEl("div", "tuow-filter-title", "Subjects"));
    getUniqueValues(weekEvents, "subject").forEach((subject) => {
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

    body.prepend(summary);
    body.append(kindGroup, subjectGroup, reset);
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
      createEl("div", "", `Location: ${event.location || "No location listed"}`)
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

  const renderEmptyDay = () => createEl(
    "div",
    "tuow-empty-day",
    sessionCache?.semester === "break" ? "End of session break" : "No visible classes"
  );

  const renderBetterTimetable = () => {
    const allEvents = parseMobileTimetable();
    if (!allEvents.length) return null;

    const weekEvents = getCurrentWeekEvents(allEvents);
    const visibleEvents = getFilteredEvents(weekEvents);
    const { minTime, maxTime, slots } = buildTimeline(visibleEvents.length ? visibleEvents : weekEvents);
    const byDay = groupOverlaps(visibleEvents);
    const today = getTodayName();
    const root = createEl("section", "");
    root.id = ROOT_ID;

    root.append(createFilterPanel(weekEvents, visibleEvents));

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
      .tuow-week-status {
        padding: 6px 0;
        color: #666;
        font-size: 12px;
      }
      .tuow-week-status-failed {
        color: #a94442;
      }
      .tuow-week-picker {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        margin: 0;
        color: #555;
        font-size: 12px;
        font-weight: 400;
        white-space: nowrap;
      }
      .tuow-week-select {
        width: auto;
        min-width: 275px;
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
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
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
    const data = await chrome.storage.local.get([SETTINGS_KEY, FILTERS_KEY, SELECTED_WEEK_KEY]);
    enabled = data[SETTINGS_KEY]?.betterTimetableEnabled !== false;
    filters = {
      hiddenKinds: data[FILTERS_KEY]?.hiddenKinds || [],
      hiddenSubjects: data[FILTERS_KEY]?.hiddenSubjects || []
    };
    selectedWeekState = data[SELECTED_WEEK_KEY] || null;
  };

  const loadSessionCache = async () => {
    try {
      sessionCache = await getSessionCache();
      apply();
    } catch (error) {
      console.warn("Timetable Plus could not load UOW session dates:", error);
      sessionCache = null;
      sessionStatus = "failed";
      sessionStatusDetail = `Could not load UOW dates: ${error?.message || error}`;
      apply();
    }
  };

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    enabled = changes[SETTINGS_KEY].newValue?.betterTimetableEnabled !== false;
    apply();
  });

  const init = async () => {
    await loadState();
    apply();
    if (enabled) loadSessionCache();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
