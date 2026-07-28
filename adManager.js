"use strict";

/**
 * Starwake Protocol manual AdSense placement controller.
 *
 * Player-experience contract:
 * - The unit is requested only after the main menu is visible and measurable.
 * - The AdSense push occurs at most once per page load.
 * - The entire placement collapses when Google reports it as unfilled.
 * - Active gameplay never contains an ad because the unit lives inside startMenu.
 */
(() => {
    const REQUEST_TIMEOUT_MS = 15000;
    let initialized = false;
    let statusObserver = null;
    let requestTimeout = null;

    function elements() {
        return {
            menu: document.getElementById("startMenu"),
            container: document.getElementById("mainMenuAd"),
            unit: document.getElementById("mainMenuAdUnit"),
        };
    }

    function collapse(container, reason) {
        if (!container) return;
        container.hidden = true;
        container.classList.remove("is-loading", "is-filled");
        container.classList.add("is-collapsed");
        if (reason) console.info(`[Starwake ads] Placement collapsed: ${reason}`);
    }

    function handleAdStatus(container, unit) {
        const status = unit?.getAttribute("data-ad-status");
        if (status === "filled") {
            if (requestTimeout) window.clearTimeout(requestTimeout);
            container.hidden = false;
            container.classList.remove("is-loading", "is-collapsed");
            container.classList.add("is-filled");
        } else if (status === "unfilled") {
            if (requestTimeout) window.clearTimeout(requestTimeout);
            collapse(container, "Google returned no ad inventory");
        }
    }

    function initializeMainMenuAd() {
        if (initialized) return;
        const { menu, container, unit } = elements();
        if (!menu || !container || !unit) return;
        if (getComputedStyle(menu).display === "none" || menu.getBoundingClientRect().width < 1) return;

        initialized = true;
        container.hidden = false;
        container.classList.remove("is-collapsed", "is-filled");
        container.classList.add("is-loading");

        statusObserver = new MutationObserver(() => handleAdStatus(container, unit));
        statusObserver.observe(unit, { attributes: true, attributeFilter: ["data-ad-status"] });

        requestTimeout = window.setTimeout(() => {
            if (!unit.getAttribute("data-ad-status")) {
                collapse(container, "ad request timed out or was blocked");
            }
        }, REQUEST_TIMEOUT_MS);

        // Two animation frames ensure the formerly hidden menu has completed layout.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            try {
                (window.adsbygoogle = window.adsbygoogle || []).push({});
            } catch (error) {
                collapse(container, "AdSense initialization failed");
                console.warn("[Starwake ads] AdSense initialization error:", error);
            }
        }));
    }

    function watchMenuVisibility() {
        const { menu } = elements();
        if (!menu) return;
        const observer = new MutationObserver(initializeMainMenuAd);
        observer.observe(menu, { attributes: true, attributeFilter: ["style", "class"] });
        document.addEventListener("starwake:main-menu-open", initializeMainMenuAd);
        initializeMainMenuAd();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", watchMenuVisibility, { once: true });
    } else {
        watchMenuVisibility();
    }

    window.addEventListener("pagehide", () => {
        statusObserver?.disconnect();
        if (requestTimeout) window.clearTimeout(requestTimeout);
    }, { once: true });
})();
