/* =============================================
   Further Beyond – Popup Script
   Dice Roller, Conditions Tracker, Spell Slots
   ============================================= */

const CONDITIONS = [
  "Blinded",
  "Charmed",
  "Deafened",
  "Exhaustion",
  "Frightened",
  "Grappled",
  "Incapacitated",
  "Invisible",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Restrained",
  "Stunned",
  "Unconscious",
];

const MAX_HISTORY = 20;

// rollDie() and getDefaultSpellSlots() are provided by shared/utils.js

function rollDice(sides, count, modifier) {
  const rolls = [];
  for (let i = 0; i < count; i++) {
    rolls.push(rollDie(sides));
  }
  const rawTotal = rolls.reduce((a, b) => a + b, 0);
  const total = rawTotal + modifier;
  return { rolls, rawTotal, total, sides, count, modifier };
}

function isCritical(result) {
  return result.count === 1 && result.sides === 20 && result.rolls[0] === 20;
}

function isFumble(result) {
  return result.count === 1 && result.sides === 20 && result.rolls[0] === 1;
}

// ---- Tab Navigation ----

function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      panels.forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

// ---- Dice Roller ----

async function initDiceRoller() {
  const dieButtons = document.querySelectorAll(".die-btn");
  const countInput = document.getElementById("dice-count");
  const modifierInput = document.getElementById("dice-modifier");
  const rollResult = document.getElementById("roll-result");
  const resultExpression = document.getElementById("result-expression");
  const resultTotal = document.getElementById("result-total");
  const resultBreakdown = document.getElementById("result-breakdown");
  const clearHistoryBtn = document.getElementById("clear-history");

  let history = [];

  // Load history from storage
  const stored = await chrome.storage.local.get("rollHistory");
  history = stored.rollHistory || [];
  renderHistory(history);

  dieButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sides = parseInt(btn.dataset.sides, 10);
      const count = Math.max(1, Math.min(20, parseInt(countInput.value, 10) || 1));
      const modifier = Math.max(-20, Math.min(20, parseInt(modifierInput.value, 10) || 0));

      // Animate button
      btn.classList.add("rolling");
      setTimeout(() => btn.classList.remove("rolling"), 350);

      const result = rollDice(sides, count, modifier);
      displayResult(result, rollResult, resultExpression, resultTotal, resultBreakdown);

      // Build history entry
      const label = buildLabel(count, sides, modifier);
      const breakdown = buildBreakdown(result.rolls, modifier);
      const entry = {
        label,
        total: result.total,
        breakdown,
        isCrit: isCritical(result),
        isFumble: isFumble(result),
        timestamp: Date.now(),
      };

      history.unshift(entry);
      if (history.length > MAX_HISTORY) history.pop();
      await chrome.storage.local.set({ rollHistory: history });
      renderHistory(history);
    });
  });

  clearHistoryBtn.addEventListener("click", async () => {
    history = [];
    await chrome.storage.local.set({ rollHistory: [] });
    renderHistory(history);
  });
}

function buildLabel(count, sides, modifier) {
  let label = `${count}d${sides}`;
  if (modifier > 0) label += ` + ${modifier}`;
  if (modifier < 0) label += ` − ${Math.abs(modifier)}`;
  return label;
}

function buildBreakdown(rolls, modifier) {
  let text = `[${rolls.join(", ")}]`;
  if (modifier !== 0) {
    text += modifier > 0 ? ` + ${modifier}` : ` − ${Math.abs(modifier)}`;
  }
  return text;
}

function displayResult(result, container, exprEl, totalEl, breakdownEl) {
  const label = buildLabel(result.count, result.sides, result.modifier);
  const breakdown = buildBreakdown(result.rolls, result.modifier);

  exprEl.textContent = label;
  totalEl.textContent = result.total;
  breakdownEl.textContent = breakdown;

  container.classList.remove("hidden", "critical", "fumble");
  if (isCritical(result)) {
    container.classList.add("critical");
    totalEl.style.color = "#ffd700";
  } else if (isFumble(result)) {
    container.classList.add("fumble");
    totalEl.style.color = "#ff6060";
  } else {
    totalEl.style.color = "";
  }
}

function renderHistory(history) {
  const list = document.getElementById("roll-history");
  list.innerHTML = "";

  if (history.length === 0) {
    const li = document.createElement("li");
    li.className = "roll-history-empty";
    li.textContent = "No rolls yet";
    list.appendChild(li);
    return;
  }

  history.forEach((entry) => {
    const li = document.createElement("li");

    const labelSpan = document.createElement("span");
    labelSpan.className = "hist-label";
    labelSpan.textContent = entry.label;

    const totalSpan = document.createElement("span");
    totalSpan.className = "hist-total";
    if (entry.isCrit) totalSpan.classList.add("crit");
    if (entry.isFumble) totalSpan.classList.add("fumble");
    totalSpan.textContent = entry.total;
    totalSpan.title = entry.breakdown;

    li.appendChild(labelSpan);
    li.appendChild(totalSpan);
    list.appendChild(li);
  });
}

// ---- Conditions Tracker ----

async function initConditions() {
  const grid = document.getElementById("conditions-grid");
  const clearBtn = document.getElementById("clear-conditions");

  const stored = await chrome.storage.local.get("conditions");
  const activeConditions = stored.conditions || {};

  // Build condition items
  CONDITIONS.forEach((name) => {
    const item = document.createElement("div");
    item.className = "condition-item" + (activeConditions[name] ? " active" : "");
    item.dataset.condition = name;

    const checkbox = document.createElement("div");
    checkbox.className = "condition-checkbox";
    checkbox.textContent = "✓";

    const label = document.createElement("span");
    label.className = "condition-name";
    label.textContent = name;

    item.appendChild(checkbox);
    item.appendChild(label);

    item.addEventListener("click", async () => {
      const current = await chrome.storage.local.get("conditions");
      const conditions = current.conditions || {};
      conditions[name] = !conditions[name];
      if (!conditions[name]) delete conditions[name];
      await chrome.storage.local.set({ conditions });
      item.classList.toggle("active", !!conditions[name]);
    });

    grid.appendChild(item);
  });

  clearBtn.addEventListener("click", async () => {
    await chrome.storage.local.set({ conditions: {} });
    document.querySelectorAll(".condition-item").forEach((el) => {
      el.classList.remove("active");
    });
  });
}

// ---- Spell Slots ----

async function initSpellSlots() {
  const list = document.getElementById("spell-slots-list");
  const resetBtn = document.getElementById("reset-slots");

  const stored = await chrome.storage.local.get("spellSlots");
  let spellSlots = stored.spellSlots || getDefaultSpellSlots();

  // Ensure all levels exist
  for (let level = 1; level <= 9; level++) {
    if (!spellSlots[level]) {
      spellSlots[level] = { max: 0, current: 0 };
    }
  }

  function renderSlots() {
    list.innerHTML = "";

    for (let level = 1; level <= 9; level++) {
      const slot = spellSlots[level];
      const row = document.createElement("div");
      row.className = "spell-slot-row";

      // Level label
      const levelLabel = document.createElement("div");
      levelLabel.className = "slot-level-label";
      levelLabel.textContent = `Level ${level}`;

      // Pips container
      const pips = document.createElement("div");
      pips.className = "slot-pips";
      pips.id = `pips-${level}`;

      // Use button (decrement current)
      const useBtn = document.createElement("button");
      useBtn.className = "slot-btn";
      useBtn.title = "Use a slot";
      useBtn.textContent = "−";

      // Current count
      const countEl = document.createElement("span");
      countEl.className = "slot-count";
      countEl.id = `slot-count-${level}`;

      // Restore button (increment current)
      const restoreBtn = document.createElement("button");
      restoreBtn.className = "slot-btn";
      restoreBtn.title = "Restore a slot";
      restoreBtn.textContent = "+";

      // Controls container
      const controls = document.createElement("div");
      controls.className = "slot-controls";
      controls.appendChild(useBtn);
      controls.appendChild(countEl);
      controls.appendChild(restoreBtn);

      // Max input
      const maxControls = document.createElement("div");
      maxControls.className = "slot-max-controls";

      const maxLabel = document.createElement("span");
      maxLabel.className = "slot-max-label";
      maxLabel.textContent = "Max";

      const maxInput = document.createElement("input");
      maxInput.type = "number";
      maxInput.className = "slot-max-input";
      maxInput.min = "0";
      maxInput.max = "9";
      maxInput.value = slot.max;
      maxInput.id = `slot-max-${level}`;

      maxControls.appendChild(maxLabel);
      maxControls.appendChild(maxInput);

      row.appendChild(levelLabel);
      row.appendChild(pips);
      row.appendChild(controls);
      row.appendChild(maxControls);
      list.appendChild(row);

      // Render pips
      updatePips(level, slot);
      updateCount(level, slot);

      function updateButtonStates() {
        useBtn.disabled = spellSlots[level].current <= 0;
        restoreBtn.disabled = spellSlots[level].current >= spellSlots[level].max;
      }

      updateButtonStates();

      // Events
      useBtn.addEventListener("click", async () => {
        if (spellSlots[level].current > 0) {
          spellSlots[level].current -= 1;
          await saveSlots(spellSlots);
          updatePips(level, spellSlots[level]);
          updateCount(level, spellSlots[level]);
          updateButtonStates();
        }
      });

      restoreBtn.addEventListener("click", async () => {
        if (spellSlots[level].current < spellSlots[level].max) {
          spellSlots[level].current += 1;
          await saveSlots(spellSlots);
          updatePips(level, spellSlots[level]);
          updateCount(level, spellSlots[level]);
          updateButtonStates();
        }
      });

      maxInput.addEventListener("change", async () => {
        const newMax = Math.max(0, Math.min(9, parseInt(maxInput.value, 10) || 0));
        maxInput.value = newMax;
        spellSlots[level].max = newMax;
        if (spellSlots[level].current > newMax) {
          spellSlots[level].current = newMax;
        }
        await saveSlots(spellSlots);
        updatePips(level, spellSlots[level]);
        updateCount(level, spellSlots[level]);
        updateButtonStates();
      });
    }
  }

  resetBtn.addEventListener("click", async () => {
    for (let level = 1; level <= 9; level++) {
      spellSlots[level].current = spellSlots[level].max;
    }
    await saveSlots(spellSlots);
    renderSlots();
  });

  renderSlots();
}

function updatePips(level, slot) {
  const pipsContainer = document.getElementById(`pips-${level}`);
  if (!pipsContainer) return;
  pipsContainer.innerHTML = "";

  for (let i = 0; i < slot.max; i++) {
    const pip = document.createElement("div");
    pip.className = "slot-pip" + (i < slot.current ? " filled" : "");
    pipsContainer.appendChild(pip);
  }
}

function updateCount(level, slot) {
  const countEl = document.getElementById(`slot-count-${level}`);
  if (countEl) {
    countEl.textContent = `${slot.current}/${slot.max}`;
  }
}

async function saveSlots(spellSlots) {
  await chrome.storage.local.set({ spellSlots });
}

// ---- Init ----

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initDiceRoller();
  initConditions();
  initSpellSlots();
});
