# Consent-Ready Monetization Foundation

This build prepares Starwake Protocol for Google's AdSense Consent Management Platform without inventing an AdSense publisher ID or loading advertisements before an account is ready.

## Already implemented in the site

- `consentManager.js` initializes Google's `googlefc.callbackQueue` safely.
- Privacy Settings controls appear on the game menu, credits page, and privacy policy.
- Those controls call Google's official consent-revocation flow once the Google CMP is live.
- Before activation, the controls display an honest setup-status message instead of pretending consent was recorded.
- Every public HTML page contains a clearly marked location for the exact AdSense site tag supplied by Google.
- The privacy policy describes the planned Google CMP and the user's ability to change a prior choice.

## Steps that require the owner's AdSense account

1. Add the Starwake domain to AdSense and complete site ownership/review.
2. Copy the exact AdSense site tag from the approved account into the marked `<head>` location on `index.html`, `credits.html`, and `privacy.html`.
3. In AdSense, open **Privacy & messaging** and create a **European regulations** message.
4. Select the Starwake site and provide the full public URL of `privacy.html`.
5. Configure clear choices for **Consent**, **Do not consent**, and **Manage options**.
6. Publish the message.
7. Test from an eligible region or using Google's available message-testing tools.

## Important boundary

The repository cannot contain a working certified Google CMP before the publisher account, site, message configuration, and genuine Google tag exist. This build supplies the site-side bridge and disclosure surfaces; Google supplies and operates the actual consent message.

## Version 1.0 AdSense integration

Publisher ID: `pub-8843081403115565`

The official AdSense site tag is installed once in the `<head>` of `index.html`, `credits.html`, and `privacy.html`. The root `ads.txt` authorizes this publisher account.

### Player-experience launch settings

For the initial launch, keep **Auto ads disabled** until the site is approved and a deliberate ad placement is created. This prevents Google from placing overlays or in-page ads over the canvas, menus, pause screen, or upgrade interface. When monetization is enabled, start with one responsive display ad outside active gameplay and test it on desktop and mobile.

If Auto ads are tested later:

- disable Anchor ads;
- disable Vignette ads;
- disable Ad intents;
- use the AdSense preview to exclude the game canvas and interactive menu regions;
- exclude `privacy.html` from Auto ads;
- verify the European regulations message is published with consent, refusal, and manage-options choices.

The current build intentionally contains no fabricated ad-slot ID and no ad unit inside gameplay.

## Live manual placement (Version 1.0.1)

The approved responsive display unit uses publisher `ca-pub-8843081403115565` and slot `6071429762`. It is mounted only inside the main menu. `adManager.js` waits for a measurable menu, requests the unit once, and collapses the placement when AdSense reports `unfilled` or the request is blocked/times out. Do not duplicate the unit or call `adsbygoogle.push()` elsewhere.

