/* =============================================
   Further Beyond – Shared Utilities
   Common dice rolling functions used by both
   the popup and the content script.
   ============================================= */

/**
 * Roll a single die with the given number of sides.
 * @param {number} sides - Number of sides on the die (e.g. 20)
 * @returns {number} Result between 1 and sides (inclusive)
 */
function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Return the default spell slot configuration for a level 17 full caster
 * (e.g. Wizard / Cleric). Each entry has `max` and `current` counts.
 * @returns {{ [level: number]: { max: number, current: number } }}
 */
function getDefaultSpellSlots() {
  const defaults = { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1 };
  const slots = {};
  for (let level = 1; level <= 9; level++) {
    const max = defaults[level];
    slots[level] = { max, current: max };
  }
  return slots;
}
