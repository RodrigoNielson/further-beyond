/* =============================================
   Further Beyond – Content Script
   Adds a floating quick-dice button on D&D Beyond
   ============================================= */

(function () {
  "use strict";

  // Prevent double injection
  if (document.getElementById("fb-dice-fab")) return;

  // ---- Floating Action Button ----

  const fab = document.createElement("button");
  fab.id = "fb-dice-fab";
  fab.title = "Further Beyond – Quick Dice Roll";
  fab.setAttribute("aria-label", "Further Beyond quick dice roller");
  fab.textContent = "⚔";

  // ---- Quick Panel ----

  const panel = document.createElement("div");
  panel.id = "fb-quick-panel";
  panel.className = "fb-hidden";
  panel.innerHTML = `
    <div class="fb-panel-header">
      <span class="fb-panel-title">⚔ Quick Roll</span>
      <button class="fb-panel-close" id="fb-close-panel" aria-label="Close">✕</button>
    </div>
    <div class="fb-dice-row">
      <button class="fb-die" data-sides="4">d4</button>
      <button class="fb-die" data-sides="6">d6</button>
      <button class="fb-die" data-sides="8">d8</button>
      <button class="fb-die" data-sides="10">d10</button>
      <button class="fb-die" data-sides="12">d12</button>
      <button class="fb-die fb-d20" data-sides="20">d20</button>
      <button class="fb-die" data-sides="100">d%</button>
    </div>
    <div class="fb-result-area" id="fb-result-area">
      <span class="fb-result-label">Click a die to roll</span>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  // ---- Toggle Panel ----

  let panelOpen = false;

  fab.addEventListener("click", () => {
    panelOpen = !panelOpen;
    panel.classList.toggle("fb-hidden", !panelOpen);
  });

  document.getElementById("fb-close-panel").addEventListener("click", (e) => {
    e.stopPropagation();
    panelOpen = false;
    panel.classList.add("fb-hidden");
  });

  // Close panel when clicking outside
  document.addEventListener("click", (e) => {
    if (panelOpen && !panel.contains(e.target) && e.target !== fab) {
      panelOpen = false;
      panel.classList.add("fb-hidden");
    }
  });

  // ---- Dice Rolling ----
  // rollDie() is provided by shared/utils.js loaded before this script

  panel.querySelectorAll(".fb-die").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const sides = parseInt(btn.dataset.sides, 10);
      const roll = rollDie(sides);
      const isCrit = sides === 20 && roll === 20;
      const isFumble = sides === 20 && roll === 1;

      fab.classList.add("fb-rolling");
      setTimeout(() => fab.classList.remove("fb-rolling"), 450);

      const area = document.getElementById("fb-result-area");
      let valueClass = "";
      if (isCrit) valueClass = "fb-crit";
      if (isFumble) valueClass = "fb-fumble";

      let detail = `d${sides}`;
      if (isCrit) detail = "Natural 20 – Critical!";
      if (isFumble) detail = "Natural 1 – Fumble!";

      area.innerHTML = `
        <span class="fb-result-label">Result</span>
        <span class="fb-result-value ${valueClass}">${roll}</span>
        <span class="fb-result-detail">${detail}</span>
      `;
    });
  });
})();
