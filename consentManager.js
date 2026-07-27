/*
 * Starwake Protocol consent bridge.
 *
 * This file does not create its own cookie banner and does not store consent.
 * Once the Google AdSense site tag and a published Privacy & messaging message
 * are active, it opens Google's certified consent-revocation interface through
 * the official googlefc callback queue.
 */
(() => {
    'use strict';

    window.googlefc = window.googlefc || {};
    window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];

    function showStatus(message) {
        let status = document.getElementById('consentStatusToast');
        if (!status) {
            status = document.createElement('div');
            status.id = 'consentStatusToast';
            status.className = 'consent-status-toast';
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            document.body.appendChild(status);
        }
        status.textContent = message;
        status.hidden = false;
        window.clearTimeout(showStatus.timer);
        showStatus.timer = window.setTimeout(() => { status.hidden = true; }, 7000);
    }

    function openPrivacyChoices() {
        if (typeof window.googlefc.showRevocationMessage === 'function') {
            window.googlefc.callbackQueue.push(window.googlefc.showRevocationMessage);
            return;
        }

        showStatus(
            'Privacy choices are prepared but not live yet. They will activate after the AdSense site tag is added and the Google Privacy & messaging consent message is published.'
        );
    }

    document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-consent-settings]');
        if (!trigger) return;
        event.preventDefault();
        openPrivacyChoices();
    });

    window.StarwakeConsent = Object.freeze({ openPrivacyChoices });
})();
