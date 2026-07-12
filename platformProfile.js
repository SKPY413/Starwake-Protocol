/*
 * STARWAKE PROTOCOL — PLATFORM PERFORMANCE PROFILE
 *
 * This file runs before the music and game scripts. It selects a conservative
 * mobile profile without forking gameplay into a separate codebase.
 *
 * URL overrides for testing:
 *   ?mobile=1  forces Mobile Performance Mode
 *   ?desktop=1 forces the desktop profile
 */
(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const forceMobile = params.get("mobile") === "1";
  const forceDesktop = params.get("desktop") === "1";
  const coarsePointer = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  const compactViewport = Math.min(window.innerWidth, window.innerHeight) <= 900;
  const isMobilePerformance = !forceDesktop && (forceMobile || (coarsePointer && (mobileUserAgent || compactViewport)));

  const profile = Object.freeze({
    name: isMobilePerformance ? "mobile" : "desktop",
    isMobilePerformance,
    renderEveryNFrames: isMobilePerformance ? 2 : 1,
    spawnMultiplier: isMobilePerformance ? 0.72 : 1,
    musicDetail: isMobilePerformance ? 0.58 : 1,
    limits: Object.freeze(isMobilePerformance ? {
      maxPointOrbs: 120,
      maxLifeStealOrbs: 36,
      maxParticles: 52,
      maxDamageNumbers: 28,
      maxBullets: 180,
      maxMissiles: 24,
      maxEnemyBullets: 110,
      maxCarrierMissiles: 32,
      maxExplosions: 18,
      maxEnemies: 46,
      minimapFrameSkip: 8,
      maxCrowdingPairs: 1300,
      maxSfxEventsPerSecond: 26,
      softVoiceLimit: 36,
      hardVoiceLimit: 48,
    } : {
      maxPointOrbs: 260,
      maxLifeStealOrbs: 90,
      maxParticles: 180,
      maxDamageNumbers: 120,
      maxBullets: 520,
      maxMissiles: 80,
      maxEnemyBullets: 320,
      maxCarrierMissiles: 100,
      maxExplosions: 64,
      maxEnemies: 120,
      minimapFrameSkip: 2,
      maxCrowdingPairs: 5000,
      maxSfxEventsPerSecond: 40,
      softVoiceLimit: 52,
      hardVoiceLimit: 68,
    }),
  });

  window.STARWAKE_PLATFORM_PROFILE = profile;
  document.documentElement.classList.toggle("mobile-performance", isMobilePerformance);
  document.documentElement.dataset.platformProfile = profile.name;
})();
