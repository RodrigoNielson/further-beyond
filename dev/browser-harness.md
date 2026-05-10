# Browser Harness

This harness lets you test the live repo files on a real D&D Beyond page without packaging or installing the extension.

## What it does

- Loads `content/content.css`, `content/dddice-sdk.js`, and `content/content.js` from a local static server.
- Shims the `chrome.runtime` and `chrome.storage` APIs that the content script expects.
- Lets the page bridge load through the shimmed `chrome.runtime.getURL(...)` path.
- Persists shimmed storage in `localStorage` so refreshes behave more like the extension.

## Basic flow

1. Serve the repo root over HTTP.
2. Open a D&D Beyond character page.
3. Inject the harness script from the browser console.
4. Exercise the feature directly on the page.

## Example server commands

PowerShell with Python:

```powershell
python -m http.server 4173
```

PowerShell with Node:

```powershell
npx serve . -l 4173
```

If `content/dddice-sdk.js` is missing or stale, rebuild it first:

```powershell
npm install
npm run build:sdk
```

## Console loader

Paste this into the D&D Beyond page console after starting a local server:

```js
const script = document.createElement("script");
script.src = "http://127.0.0.1:4173/dev/browser-harness.js";
document.documentElement.appendChild(script);
```

If you need to point to a different host or port, change the URL in `script.src`.

## Roll target probe

To inspect D&D Beyond roll targets before writing intercept selectors, load the probe after the harness:

```js
const probe = document.createElement("script");
probe.src = "http://127.0.0.1:4173/dev/roll-probe.js";
document.documentElement.appendChild(probe);
```

Then hold `Alt+Shift` and click or right-click a rollable element. The probe logs the clicked node, nearest button, datasets, and a short selector chain to the console.

## Reset harness storage

The harness exposes a helper for clearing the shimmed storage state:

```js
window.__fbHarness.resetStorage();
```

## Current limitation

This harness is meant for content-script and page-bridge testing. It does not simulate the browser toolbar popup or packaged extension permissions.
