/* =============================================
   Further Beyond – Content Script
   Adds an active indicator to D&D Beyond character sheets
   ============================================= */

(function () {
  "use strict";

  if (!window.location.pathname.startsWith("/characters/")) return;

  const INDICATOR_ID = "fb-active-indicator";
  const SLOT_SUMMARY_ID = "fb-slot-summary";
  const CONTAINER_BADGE_CLASS = "fb-container-slot-badge";
  const HEADING_SELECTORS = [
    "main .ddbc-character-tidbits__heading h1",
    "main h1.styles_characterName__2x8wQ",
    "main h1",
  ];

  function findCharacterHeading() {
    for (const selector of HEADING_SELECTORS) {
      const heading = document.querySelector(selector);
      if (heading) return heading;
    }

    return null;
  }

  function createIndicator() {
    const indicator = document.createElement("span");
    const icon = document.createElement("img");

    indicator.id = INDICATOR_ID;
    indicator.title = "Further Beyond is active";
    indicator.setAttribute("role", "img");
    indicator.setAttribute("aria-label", "Further Beyond is active");

    icon.src = chrome.runtime.getURL("icons/wizard.png");
    icon.alt = "";

    indicator.appendChild(icon);
    return indicator;
  }

  function mountIndicator() {
    const heading = findCharacterHeading();
    if (!heading) return false;

    let indicator = document.getElementById(INDICATOR_ID);
    if (!indicator) {
      indicator = createIndicator();
    }

    if (indicator.parentElement !== heading) {
      heading.prepend(indicator);
    }

    return true;
  }

  function parseInteger(text) {
    if (!text) return null;

    const match = text.replace(/,/g, "").match(/[+-]?\d+/);
    if (!match) return null;

    const value = parseInt(match[0], 10);
    return Number.isFinite(value) ? value : null;
  }

  function getStrengthCapacity() {
    const strengthSummary = Array.from(
      document.querySelectorAll(".ddbc-ability-summary")
    ).find((summary) => {
      const label = summary.querySelector(".ddbc-ability-summary__label");
      return label && label.textContent.trim().toLowerCase() === "strength";
    });

    if (!strengthSummary) return null;

    const score = parseInteger(
      strengthSummary.querySelector(".ddbc-ability-summary__secondary")?.textContent
    );

    if (!Number.isFinite(score)) {
      return null;
    }

    return score + 8;
  }

  function getContainerName(group) {
    const fallbackLabel = group.querySelector(".ct-equipment__container-name");
    if (!fallbackLabel) {
      return "";
    }

    const labelClone = fallbackLabel.cloneNode(true);

    labelClone
      .querySelectorAll(`.${CONTAINER_BADGE_CLASS}, .ct-equipment__container-quantity`)
      .forEach((element) => {
        element.remove();
      });

    const namedLabel = labelClone.querySelector(".styles_itemName__xLCwW");
    if (namedLabel) {
      return namedLabel.textContent.trim();
    }

    return labelClone.textContent.replace(/\s+/g, " ").trim();
  }

  function collectInventoryContainers() {
    return Array.from(document.querySelectorAll(".ct-equipment .ct-content-group"))
      .map((group) => {
        const name = getContainerName(group);
        if (!name) {
          return null;
        }

        const itemRows = Array.from(
          group.querySelectorAll(
            ".ct-content-group__content .ct-inventory__items > .ct-inventory-item"
          )
        );
        const countsContainer = false;

        return {
          group,
          name,
          itemCount: itemRows.length,
          countsContainer,
          slotCount: itemRows.length,
        };
      })
      .filter(Boolean);
  }

  function cloneContainerData(containers) {
    return containers.map((container) => ({
      name: container.name,
      itemCount: container.itemCount,
      countsContainer: container.countsContainer,
      slotCount: container.slotCount,
    }));
  }

  function getCharacterKey() {
    return window.location.pathname.split("/")[2] || "";
  }

  function isUnfilteredInventoryView(inventoryRoot) {
    const allFilter = inventoryRoot.querySelector('[data-testid="tab-filter-all"]');
    const searchInput = inventoryRoot.querySelector(".ct-inventory-filter__input");
    const isAllActive = !allFilter || allFilter.classList.contains("styles_active__oWpHc");
    const hasSearch = !!searchInput && searchInput.value.trim() !== "";

    return isAllActive && !hasSearch;
  }

  function mergeContainerSnapshots(cachedContainers, visibleContainers) {
    if (!cachedContainers.length) {
      return visibleContainers;
    }

    const visibleByName = new Map(
      visibleContainers.map((container) => [container.name, container])
    );
    const merged = cachedContainers.map(
      (container) => visibleByName.get(container.name) || container
    );

    visibleContainers.forEach((container) => {
      if (!cachedContainers.some((cached) => cached.name === container.name)) {
        merged.push(container);
      }
    });

    return merged;
  }

  function createSlotSummary() {
    const summary = document.createElement("div");
    const heading = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("span");
    const detail = document.createElement("div");
    const breakdown = document.createElement("div");

    summary.id = SLOT_SUMMARY_ID;
    summary.className = "fb-slot-summary";

    heading.className = "fb-slot-summary__heading";

    label.className = "fb-slot-summary__label";
    label.textContent = "Item Slots";

    value.className = "fb-slot-summary__value";

    detail.className = "fb-slot-summary__detail";

    breakdown.className = "fb-slot-summary__breakdown";

    heading.appendChild(label);
    heading.appendChild(value);
    summary.appendChild(heading);
    summary.appendChild(detail);
    summary.appendChild(breakdown);

    return summary;
  }

  function upsertContainerBadge(container) {
    const nameCell = container.group.querySelector(".ct-equipment__container-name");
    if (!nameCell) return;

    let badge = container.group.querySelector(`.${CONTAINER_BADGE_CLASS}`);
    if (!badge) {
      badge = document.createElement("span");
      badge.className = CONTAINER_BADGE_CLASS;
      nameCell.appendChild(badge);
    }

    badge.textContent = container.countsContainer
      ? `${container.slotCount} slots`
      : `${container.itemCount} slots`;

    badge.dataset.weightless = container.countsContainer ? "false" : "true";
    badge.title = container.countsContainer
      ? `${container.name} counts as 1 slot plus ${container.itemCount} stored item slots.`
      : `${container.name} is excluded from container-slot cost.`;
  }

  function mountInventorySlots() {
    const inventoryRoot = document.querySelector(".ct-equipment");
    if (!inventoryRoot) return false;

    const overview = inventoryRoot.querySelector(".ct-equipment__overview");
    if (!overview) return false;

    const capacity = getStrengthCapacity();
    if (!Number.isFinite(capacity)) return false;

    const visibleContainers = collectInventoryContainers();
    const characterKey = getCharacterKey();
    const isUnfiltered = isUnfilteredInventoryView(inventoryRoot);

    if (inventorySnapshot.characterKey !== characterKey) {
      inventorySnapshot.characterKey = characterKey;
      inventorySnapshot.containers = [];
    }

    if (isUnfiltered) {
      inventorySnapshot.containers = cloneContainerData(visibleContainers);
    }

    const containers = isUnfiltered
      ? visibleContainers
      : mergeContainerSnapshots(inventorySnapshot.containers, visibleContainers);
    const usedSlots = containers.reduce(
      (total, container) => total + container.slotCount,
      0
    );
    let summary = document.getElementById(SLOT_SUMMARY_ID);
    if (!summary) {
      summary = createSlotSummary();
      overview.insertAdjacentElement("afterend", summary);
    }

    summary.dataset.state =
      usedSlots > capacity ? "over" : usedSlots >= capacity ? "full" : "ok";

    const value = summary.querySelector(".fb-slot-summary__value");
    const detail = summary.querySelector(".fb-slot-summary__detail");
    const breakdown = summary.querySelector(".fb-slot-summary__breakdown");

    value.textContent = `${usedSlots} / ${capacity}`;
    detail.textContent =
      "Every item row counts, including Equipment. Containers do not spend slots themselves.";

    breakdown.replaceChildren();

    containers.forEach((container) => {
      const chip = document.createElement("span");
      chip.className = "fb-slot-summary__chip";
      chip.dataset.weightless = container.countsContainer ? "false" : "true";
      chip.textContent = `${container.name}: ${container.slotCount}`;
      breakdown.appendChild(chip);
    });

    visibleContainers.forEach((container) => {
      const cachedContainer = containers.find(
        (candidate) => candidate.name === container.name
      );

      upsertContainerBadge({
        ...container,
        itemCount: cachedContainer?.itemCount ?? container.itemCount,
        countsContainer:
          cachedContainer?.countsContainer ?? container.countsContainer,
        slotCount: cachedContainer?.slotCount ?? container.slotCount,
      });
    });

    return true;
  }

  const inventorySnapshot = {
    characterKey: getCharacterKey(),
    containers: [],
  };

  let refreshPending = false;

  function refreshUi() {
    refreshPending = false;
    mountIndicator();
    mountInventorySlots();
  }

  function scheduleRefresh() {
    if (refreshPending) return;
    refreshPending = true;
    window.requestAnimationFrame(refreshUi);
  }

  const observer = new MutationObserver(() => {
    scheduleRefresh();
  });

  scheduleRefresh();
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener(
    "pagehide",
    () => {
      observer.disconnect();
    },
    { once: true }
  );
})();
