# Project Guidelines

## Workflow

- Always end with ask_user unless the user explicitly says "we are done".
- Whenever building a new version, increment the last version segment in both manifest.json and package.json.

## Feature Names

- Inventory Manager: slot-based inventory tracking, container handling, coin weight rules, and related character-sheet summaries.
- Further Dice Roller: local dice rolling, dice-button interception, simple custom rolls, and Game Log output.

## Feature Changes

- When adding or editing a feature, refer to it by its canonical feature name in docs, planning, and implementation notes.
- Keep a dedicated D&D Beyond test path for the feature on a character you control.
- Create or extend a small helper under dev/ so the feature has its own path to test, iterate on, and expand.
- Use dev/browser-harness.md as the default live-page testing flow for content-script changes.
- Run dev/further-dice-roller-test-plan.md after every Further Dice Roller change.
- After feature changes, rebuild the relevant bundles and build the extension before handing work off.
