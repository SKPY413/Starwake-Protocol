STARWAKE PROTOCOL — PROJECT GUIDE

PLAY LOCALLY
------------
Open index.html in Firefox, Chrome, or Chromium.

If local audio or browser storage is restricted, run:
  python3 -m http.server 8000

Then open:
  http://localhost:8000


PUBLIC SITE FILES
-----------------
index.html             Main game page
credits.html           Credits and development access
privacy.html           Privacy policy
styles.css             Shared visual styling
game.js                Generated gameplay runtime
musicEngine.js         Procedural music engine
platformProfile.js     Desktop/mobile profile selection
consentManager.js      Google consent-message integration bridge
assets/                 Public images and asset manifest

These are the files Vercel serves to players. Do not delete them.


EDITABLE SOURCE
---------------
src/                    Modular gameplay source
src/manifest.json       Source order and line metadata
tools/build_game.py     Rebuilds game.js from src/

Do not edit game.js directly for lasting changes. Edit src/ and rebuild.


MAINTENANCE COMMANDS
--------------------
npm run build            Rebuild source manifest and game.js
npm run fingerprint      Refresh build_manifest.json
npm run verify           Run the complete project verification gate
npm run check            Build, fingerprint, and verify
npm run release:verify   Check release hygiene and fingerprints

Vercel should remain configured as a static site:
  Framework Preset: Other
  Build Command: empty
  Output Directory: .


ACTIVE DOCUMENTATION
--------------------
ADMIN.md                       Complete development/change record
ARCHITECTURE.md                Runtime structure and system contracts
CONSENT_READY_MONETIZATION.md  AdSense and consent setup
KNOWN_ISSUES.md                Current known problems
LORE_BIBLE.md                  Lore and mechanical intent
ROADMAP.md                     Planned development
SAVE_SYSTEM.md                 Save architecture and behavior
SOP.md                         Development procedure
TEST_REPORT.md                 Testing status and results

Historical phase reports and one-off changelog files were removed because their useful information is already represented in ADMIN.md, ARCHITECTURE.md, or the active source.
