# Further Beyond

A Chrome extension that enhances your [D&D Beyond](https://www.dndbeyond.com) experience with quick-access tools for dice rolling, condition tracking, and spell slot management.

## Features

### 🎲 Dice Roller
- Roll any die: **d4, d6, d8, d10, d12, d20, d%**
- Set the number of dice and a modifier (+/−)
- See the full breakdown of each roll
- Automatic **Critical** and **Fumble** detection on d20 rolls
- Persistent roll history (last 20 rolls saved across sessions)

### ⚠️ Condition Tracker
- Toggle all 15 D&D 5e conditions on/off:
  - Blinded, Charmed, Deafened, Exhaustion, Frightened, Grappled, Incapacitated, Invisible, Paralyzed, Petrified, Poisoned, Prone, Restrained, Stunned, Unconscious
- State persists between browser sessions

### ✨ Spell Slot Tracker
- Track spell slots for all 9 spell levels
- Set your max slots per level and use/restore them with +/− buttons
- Visual pip indicators for remaining slots
- "Reset All Slots" restores everything to max

### ⚔ Floating Quick-Roll Button (D&D Beyond Only)
- A floating action button appears on every D&D Beyond page
- Click it to open a quick dice panel with d4–d20 and d%
- Critical and Fumble results are highlighted

## Installation

1. **Clone or download** this repository.
2. Open **Google Chrome** and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **"Load unpacked"** and select the root folder of this repository.
5. The **Further Beyond** extension icon will appear in your toolbar.

## Development

The extension is built with plain HTML, CSS, and JavaScript — no build step required.

```
further-beyond/
├── manifest.json          # Extension manifest (Manifest V3)
├── popup/
│   ├── popup.html         # Popup UI
│   ├── popup.css          # Popup styles
│   └── popup.js           # Dice roller, conditions, spell slots logic
├── content/
│   ├── content.js         # Content script injected on dndbeyond.com
│   └── content.css        # Styles for the floating quick-roll button
├── background/
│   └── service-worker.js  # Background service worker
└── icons/                 # Extension icons (16, 32, 48, 128 px)
```

## Permissions

- **`storage`** – Persists your roll history, active conditions, and spell slot counts.
- **`https://www.dndbeyond.com/*`** – Injects the floating quick-roll button on D&D Beyond pages.