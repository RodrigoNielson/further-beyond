# Further Dice Roller Test Plan

Run this checklist after every Further Dice Roller change.

## Preconditions

1. Use your dedicated D&D Beyond character test path for Further Dice Roller work.
2. Use the live-page flow in `dev/browser-harness.md` or load the unpacked extension.
3. Clear the harness storage before testing if you are using the harness:

```js
window.__fbHarness.resetStorage();
```

4. Enable Further Dice Roller and keep `diceSuppressNativeDice` enabled.
5. Start with the Game Log closed unless a step says otherwise.

## Mandatory Smoke Suite

1. Repeat roll regression
   Click the same skill roll target twice in a row.
   Expected: both rolls go through Further Dice Roller, the second click is not ignored, and D&D Beyond does not take over.

2. One save
   Roll one saving throw from the sheet, for example Strength Save.
   Expected: Further Dice Roller toast when Game Log is closed, and one new roll-history entry.

3. One skill check
   Roll one skill check from the sheet, for example Acrobatics.
   Expected: Further Dice Roller toast when Game Log is closed, and one new roll-history entry.

4. One attack roll
   Roll one attack `to hit` button from the Actions tab.
   Expected: the label matches the attack, the roll uses Further Dice Roller, and D&D Beyond native dice does not open.

5. One damage roll
   Roll one attack damage button from the Actions tab.
   Expected: the label matches the damage action, the roll uses Further Dice Roller, and D&D Beyond native dice does not open.

6. One custom dice roll
   Open Further Dice Roller from the bottom-left D&D Beyond dice button, enter `d20`, and roll it.
   Expected: the native `Roll Dice` UI does not open, the Further Dice Roller panel opens, and the result lands in roll history.

7. Game Log mount and sizing
   Open Game Log, then perform one roll from the sheet.
   Expected: the Further Dice Roller log panel mounts in the Game Log area, stays height-bounded with scrolling, and does not stretch the sidebar.

8. Toast suppression when Game Log is open
   With Game Log still open, perform one roll.
   Expected: the log updates, and the toast does not cover the screen while the log is visible.

9. Bottom-left override
   Click the bottom-left D&D Beyond dice button twice.
   Expected: it opens Further Dice Roller both times and never opens D&D Beyond's native `Roll Dice` UI.

## Record Keeping

Write down the exact character path, the roll targets used, and any mismatch between Further Dice Roller behavior and D&D Beyond native dice behavior before handing work off.