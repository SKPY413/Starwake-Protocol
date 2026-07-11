STARWAKE PROTOCOL - SEPARATE FILE VERSION

Files:
  index.html  - page structure
  styles.css  - all visual styling
  game.js     - gameplay, procedural audio, enemies, upgrades, and effects

Run:
  Open index.html in Firefox, Chrome, or Chromium.

If your browser blocks local audio or storage features, run a local server in this folder:
  python3 -m http.server 8000
Then open:
  http://localhost:8000

Keep all three main files in the same folder.


BALANCE PASS
------------
Easy: very gentle early waves, delayed advanced enemies, cheaper upgrades, and higher point rewards.
Medium: smoother baseline progression with slightly reduced opening pressure.
Hard: strong but fair scaling with the standard upgrade economy.
Impossible: early advanced enemies, aggressive stat growth, high damage, and heavy spawn pressure.

Enemy counts, spawn cadence, stat growth, enemy unlock timing, reward multipliers, and upgrade costs are now tuned independently per difficulty.
