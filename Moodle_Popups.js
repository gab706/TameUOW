// ==UserScript==
// @name         BLUE_MOODLE.Popup Hijacker + Toggle
// @namespace    https://moodle.uowplatform.edu.au/
// @version      4.0
// @description  Toggle and block Moodle popups with toast notifications, badge counter, mutation observer, and localStorage state.
// @author       Gabriel & Luke
// @match        https://moodle.uowplatform.edu.au/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const TOGGLE_KEY = 'popupVisibilityAllowed'; // Key for storing popup visibility toggle state in localStorage
    let blocking = localStorage.getItem(TOGGLE_KEY) === 'false'; // Determine initial blocking state
    let count = 0; // Counter for how many popups were blocked

    // Helper function to apply inline styles to an element
    const style = (el, styles) => Object.assign(el.style, styles);

    // Display a toast notification in the bottom-right corner
    const showToast = (msg) => {
        let toast = document.getElementById("popup-toast") || (() => {
            const el = document.createElement("div");
            el.id = "popup-toast";

            // Styling for the toast
            style(el, {
                position: "fixed", bottom: "20px", right: "20px", background: "#323232", color: "#fff",
                padding: "10px 15px", borderRadius: "6px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                fontSize: "13px", zIndex: 9999, opacity: 0, transition: "opacity 0.3s ease",
                maxWidth: "300px", wordWrap: "break-word", display: "flex",
                alignItems: "center", justifyContent: "space-between", gap: "10px",
            });

            const text = document.createElement("span");
            const close = document.createElement("span");
            close.textContent = "❌";
            close.title = "Dismiss";
            close.style.cursor = "pointer";
            close.style.fontSize = "12px";
            close.onclick = () => (el.style.opacity = "0", clearTimeout(el._timeout));
            el.append(text, close);
            el._text = text;
            document.body.appendChild(el);
            return el;
        })();

		// This Toast is a baller idea! solid work Gabriel.
        toast._text.textContent = msg;
        toast.style.opacity = "1";
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => (toast.style.opacity = "0"), 4000);
    };

    // Create toggle button with badge that appears in Moodle's top-right menu
    const createToggle = () => {
        const btn = document.createElement("button");
        btn.id = "popup-toggle-btn";
        btn.type = "button";
        btn.title = "Toggle popup visibility";

        const badge = document.createElement("span");
        badge.id = "popup-blocked-count";

        // Button styles
        style(btn, {
            position: "relative", padding: "6px 12px", fontSize: "13px",
            border: "1px solid #ccc", borderRadius: "6px", margin: "4px",
            cursor: "pointer", color: "#fff"
        });

        // Badge styles
        style(badge, {
            position: "absolute", top: "-4px", right: "-6px", background: "#f44336",
            color: "#fff", fontSize: "10px", padding: "2px 5px", borderRadius: "50%",
            display: "none", minWidth: "18px", textAlign: "center"
        });

        // Update toggle button appearance and text
        const update = () => {
            btn.textContent = `Popups: ${blocking ? "OFF" : "ON"}`;
            btn.style.background = blocking ? "#e53935" : "#43a047";
            btn.appendChild(badge);
        };

        // Toggle button click behavior
        btn.onclick = () => {
            blocking = !blocking;
            localStorage.setItem(TOGGLE_KEY, !blocking);
            count = 0;
            badge.textContent = "0";
            badge.style.display = "none";
            update();
            console.log(`[TM] Popups are now ${blocking ? "BLOCKED (OFF)" : "ALLOWED (ON)"}`);
        };

        update();

        // Inject toggle button into Moodle's existing menu
        const li = document.createElement("li");
        li.className = "rui-icon-menu-togglepopups";
        li.appendChild(btn);

        const ul = document.querySelector("ul.rui-icon-menu.rui-icon-menu--right.ml-auto");
        ul?.insertBefore(li, ul.firstChild) || console.warn("[TM] Header menu not found.");
        return badge;
    };

    // Logic for blocking and removing popup elements
    const blockPopup = (el, badge, method) => {
        const heading = el.querySelector("#bluePopupHeading")?.innerText?.trim() || "Unnamed Popup";
        el.remove();
        count++;
        badge.textContent = count;
        badge.style.display = "inline-block";
        console.log(`[TM] Popup #${count} blocked (${method})`);
        showToast(`Popup blocked: "${heading}"`);
    };

    // Use a MutationObserver to detect when popups are added to the DOM
    const observe = (badge) => {
        new MutationObserver(muts => {
            if (!blocking) return;
            muts.forEach(m => [...m.addedNodes].forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                const el = node.id === "dvBlueTasksPrompt"
                    ? node
                    : node.closest?.("#dvBlueTasksPrompt") || node.querySelector?.("#dvBlueTasksPrompt");
                if (el) blockPopup(el, badge, "mutation");
            }));
        }).observe(document.body, { childList: true, subtree: true });
    };

    // Override the native BLUE_MOODLE.ClosePopup function to intercept popups
    const override = (bm, badge) => {
        const original = bm.ClosePopup;
        bm.ClosePopup = (id = "dvOuter") => {
            const el = document.getElementById(id);
            if (!el) return console.warn(`[TM] Element '${id}' not found.`);

            if (blocking) {
                const target = el.id === "dvBlueTasksPrompt" ? el : el.closest?.("#dvBlueTasksPrompt");
                blockPopup(target || el, badge, "ClosePopup");
            } else {
                original?.call(bm, id);
                console.log(`[TM] Popup allowed (id: ${id})`);
                const outer = document.getElementById("dvOuter");
                if (outer?.children.length === 0) outer.remove(); // Clean up if no children left
            }
        };
        console.log("[TM] ClosePopup override applied.");
    };

    // Wait for BLUE_MOODLE object to become available, then override
    const waitForBM = (badge) => {
        let tries = 100;
        const interval = setInterval(() => {
            const bm = window.BLUE_MOODLE;
            if (!--tries || (bm?.ClosePopup && bm?.CommonPopUp)) {
                clearInterval(interval);
                bm?.ClosePopup ? override(bm, badge) : console.warn("[TM] BLUE_MOODLE.ClosePopup not found.");
            }
        }, 100);
    };

    // Run once the page fully loads
    window.addEventListener('load', () => {
        const badge = createToggle(); // Create UI toggle button
        observe(badge); // Start watching for popups
        waitForBM(badge); // Wait and hook into BLUE_MOODLE functions
    });
})();
