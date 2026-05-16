# Further Beyond

A Chrome extension that adds a small active indicator, an in-page Further Beyond settings button, a configurable toolbar popup, and slot-based inventory tracking on D&D Beyond character sheets.

## Feature Names

- Inventory Manager: slot-based inventory tracking, container handling, coin weight rules, and related character-sheet summaries.
- Further Dice Roller: local dice rolling, dice-button interception, simple custom rolls, and Game Log output.

## Features

- Shows a small Further Beyond icon immediately to the left of the character name.
- Clicking the Further Beyond toolbar icon opens a settings popup for enabled features.
- Adds a `FURTHER BEYOND` action next to `MANAGE` on character pages and opens an in-page settings window.
- Adds an optional Further Dice Roller that uses D&D Beyond's dice button and custom simple-roll input, then shows the results in the Game Log.
- Adds a `Use Hit Die` action to the Short Rest sidebar so selected hit dice can be saved without taking a full short rest.
- Only runs on D&D Beyond character pages under `https://www.dndbeyond.com/characters/*`.
- Tracks inventory slots on the Inventory page.
- Sets the slot maximum to `8 + Strength score`.
- Counts each visible item row as 1 slot, including the Equipment section.
- Containers never spend slots themselves; only the items inside them count.
- Coins can be excluded from slot weight entirely or counted with a custom `coins per slot` ratio.
- Replaces the weight-carried overview with a compact slot `used / max` display.
- Extra slots above the maximum progressively push the summary toward red.
- Each slot above the maximum applies `-5 ft.` speed, and reaching `0 ft.` shows a warning.
- Uses the uploaded wizard icon for the page indicator.

## Installation

1. **Clone or download** this repository.
2. Open **Google Chrome** and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **"Load unpacked"** and select the root folder of this repository.
5. The **Further Beyond** extension icon will appear in your toolbar. Click it to configure item-slot behavior.

## Development

The page UI is still plain HTML, CSS, and JavaScript, and the Further Dice Roller bundle is built locally for the content script.

When you add or edit a feature, use this workflow:

1. Use the canonical feature name so the change is easy to reference.
2. Test on your own D&D Beyond character path.
3. Create or extend a small helper under dev/ so the feature has its own path to test and expand.
4. Use dev/browser-harness.md for live content-script testing.
5. For Further Dice Roller changes, run dev/further-dice-roller-test-plan.md before handing work off.
6. Rebuild the affected bundle before loading the extension.

```powershell
npm install
npm run build:sdk
```

After that bundle exists, you can load the repo unpacked in Chrome during development.

## Packaging

Before building a new extension package, increment the patch version in both manifest.json and package.json.

To create a distributable zip for Chrome, run the PowerShell build script from the project root:

```powershell
.\build.ps1
```

This creates a versioned zip file in `dist/`, for example `dist/further-beyond-0.0.66.zip`.

The build script also refreshes the local Further Dice bundle before packaging.

```
further-beyond/
├── build.ps1              # Creates a versioned extension zip in dist/
├── dist/                  # Generated build output (ignored by git)
├── manifest.json          # Extension manifest (Manifest V3)
├── content/
│   ├── content.js         # Injects the active indicator and inventory slot UI
│   ├── content.css        # Styles for the inline page UI
│   ├── page-bridge.js     # Reads character data from the page runtime
│   ├── popup.html         # Toolbar popup markup
│   ├── popup.css          # Toolbar popup styles
│   └── popup.js           # Toolbar popup settings logic
└── icons/                 # Extension icons (16, 32, 48, 128 px)
```

## Permissions

- **`storage`** – Persists feature settings for the toolbar popup.
- **`https://www.dndbeyond.com/characters/*`** – Injects the active indicator on D&D Beyond character sheets.