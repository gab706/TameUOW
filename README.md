# BetterUOW

BetterUOW is a standalone Chrome extension for University of Wollongong systems. It replaces the previous Tampermonkey setup with one unpacked extension that runs on SOLS and Moodle.

## Features

* **WAM Insight** - Adds a calculated WAM table to SOLS enrolment records.
* **Timetable Plus** - Replaces SOLS' overlapping timetable with a cleaner native-looking weekly grid, readable class cards, overlap switching, current date, highlighted current weekday, and week-aware class visibility backed by current-session IndexedDB metadata. Break periods show no classes.
* **Mail Sweep** - Automatically marks SOLSMail messages as read and records the messages it skipped.
* **Quiet Moodle** - Blocks Moodle popups and records every blocked popup.

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Pin the BetterUOW extension icon if you want quick access to the skipped-message list.

## Project Layout

* `manifest.json` - Chrome extension manifest.
* `src/background.js` - Stores blocked/skipped items, updates the badge, and shows notifications.
* `src/sols-wam.js` - SOLS enrolment WAM content script.
* `src/sols-auto-read.js` - SOLSMail auto-read content script.
* `src/better-timetable.js` - SOLS timetable replacement content script.
* `src/moodle-popups.js` - Moodle content script, blocking observer, and history reporting.
* `src/moodle-page-bridge.js` - Page-context bridge for Moodle's `BLUE_MOODLE.ClosePopup` hook.
* `src/popup.html` - Toolbar popup dashboard for settings, activity history, and build info.

## Changelog

### 2.1.1

* Renamed the extension to BetterUOW across the manifest, popup, content scripts, storage keys, DOM IDs, custom events, IndexedDB database, and Moodle bridge internals.
* Rebuilt the extension icon set for the BetterUOW identity.
* Updated build notes and documentation to reflect the new name.

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
