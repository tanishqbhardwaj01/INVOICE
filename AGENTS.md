# AGENTS.md

## Cursor Cloud specific instructions

Invoice Studio is a **client-only static web app** — plain `index.html` + `styles.css` + `app.js`, no backend, no database, no build step, and no package manager (there is no `package.json`, lockfile, or dependency manifest). See `README.md` for the canonical run commands.

- **Run (dev):** serve the folder statically, e.g. `python3 -m http.server 8080` (or `npx --yes serve .`), then open the served URL. There is no separate "build" vs "dev" mode — serving the raw files IS development.
- **No install step:** nothing to `npm install`/`pip install`. `python3` and `node`/`npx` are preinstalled in the environment; the update script is intentionally a no-op.
- **No tests / no lint / no build:** the repo ships no test suite, linter config, or build pipeline. "Testing" means manually exercising the editor in a browser and confirming the live preview updates.
- **External CDNs (optional):** `qrcodejs` (cdnjs) powers the UPI QR, and Manrope loads from Google Fonts. Without internet the app still runs; the QR shows "QR unavailable" and fonts fall back to system defaults.
- **State is in-memory only:** nothing persists to a server or localStorage; a page reload resets to demo defaults.
- **Harmless console noise:** a `404` for `favicon.ico` appears in the browser console and does not affect functionality.
