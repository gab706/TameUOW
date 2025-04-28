// ==UserScript==
// @name         Moodle Overdue Notifications Blocker
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Hides "overdue" badges in Moodle
// @author       You
// @match        https://moodle.uowplatform.edu.au/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Function to hide overdue notifications
    function hideOverdueBadges() {
        // Get all overdue badges
        const overdueBadges = document.querySelectorAll('.badge-danger');
        
        // Hide each overdue badge
        overdueBadges.forEach(badge => {
            if (badge.textContent.toLowerCase().includes('overdue')) {
                badge.style.display = 'none';
            }
        });
    }

    // Initial call to hide existing badges
    hideOverdueBadges();
    
    // Set up a MutationObserver to handle dynamically loaded content
    const observer = new MutationObserver(function(mutations) {
        hideOverdueBadges();
    });
    
    // Start observing the document body for added nodes
    observer.observe(document.body, { childList: true, subtree: true });
})();
