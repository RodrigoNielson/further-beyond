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
  const SLOT_WARNING_CLASS = "fb-slot-summary__warning";
  const SPEED_PENALTY_ID = "fb-speed-penalty";
  const SPEED_WARNING_ID = "fb-speed-warning";
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

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function mixColor(startColor, endColor, amount, alpha) {
    const intensity = clamp(amount, 0, 1);
    const channel = startColor.map((value, index) => {
      return Math.round(value + (endColor[index] - value) * intensity);
    });

    return `rgba(${channel[0]}, ${channel[1]}, ${channel[2]}, ${alpha})`;
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
    const warning = document.createElement("div");
    const breakdown = document.createElement("div");

    summary.id = SLOT_SUMMARY_ID;
    summary.className = "fb-slot-summary";

    heading.className = "fb-slot-summary__heading";

    label.className = "fb-slot-summary__label";
    label.textContent = "Item Slots";

    value.className = "fb-slot-summary__value";

    detail.className = "fb-slot-summary__detail";

    warning.className = SLOT_WARNING_CLASS;
    warning.hidden = true;

    breakdown.className = "fb-slot-summary__breakdown";

    heading.appendChild(label);
    heading.appendChild(value);
    summary.appendChild(heading);
    summary.appendChild(detail);
    summary.appendChild(warning);
    summary.appendChild(breakdown);

    return summary;
  }

  function getSpeedBoxState() {
    const speedBox = document.querySelector(".ct-speed-box");
    if (!speedBox) return null;

    const numberSpan = speedBox.querySelector(
      ".ct-speed-box__box-value .styles_numberDisplay__Rg1za > span"
    );
    if (!numberSpan) return null;

    if (!speedBox.dataset.fbBaseSpeed) {
      const baseSpeed = parseInteger(numberSpan.textContent);
      if (!Number.isFinite(baseSpeed)) {
        return null;
      }

      speedBox.dataset.fbBaseSpeed = String(baseSpeed);
    }

    const baseSpeed = parseInteger(speedBox.dataset.fbBaseSpeed);
    if (!Number.isFinite(baseSpeed)) {
      return null;
    }

    return {
      speedBox,
      numberSpan,
      baseSpeed,
    };
  }

  function resetSpeedPenalty() {
    const speedState = getSpeedBoxState();
    if (!speedState) return;

    const { speedBox, numberSpan, baseSpeed } = speedState;
    numberSpan.textContent = String(baseSpeed);
    speedBox.dataset.fbSpeedState = "ok";
    speedBox.style.removeProperty("--fb-speed-ring");
    speedBox.style.removeProperty("--fb-speed-color");

    speedBox.querySelector(`#${SPEED_PENALTY_ID}`)?.remove();
    speedBox.querySelector(`#${SPEED_WARNING_ID}`)?.remove();
  }

  function updateSpeedPenalty(overBy) {
    const speedState = getSpeedBoxState();
    if (!speedState) {
      return null;
    }

    const { speedBox, numberSpan, baseSpeed } = speedState;
    const extraSlots = Math.max(overBy, 0);

    if (extraSlots === 0) {
      resetSpeedPenalty();
      return {
        baseSpeed,
        adjustedSpeed: baseSpeed,
        penalty: 0,
        intensity: 0,
      };
    }

    const penalty = extraSlots * 5;
    const adjustedSpeed = Math.max(baseSpeed - penalty, 0);
    const stopThreshold = Math.max(Math.ceil(baseSpeed / 5), 1);
    const intensity = clamp(extraSlots / stopThreshold, 0, 1);
    const speedColor = mixColor([160, 82, 17], [179, 35, 24], intensity, 1);
    const ringColor = mixColor([221, 151, 14], [197, 49, 49], intensity, 0.42);

    numberSpan.textContent = String(adjustedSpeed);
    speedBox.dataset.fbSpeedState = adjustedSpeed === 0 ? "stopped" : "penalized";
    speedBox.style.setProperty("--fb-speed-ring", ringColor);
    speedBox.style.setProperty("--fb-speed-color", speedColor);

    let penaltyNote = speedBox.querySelector(`#${SPEED_PENALTY_ID}`);
    if (!penaltyNote) {
      penaltyNote = document.createElement("div");
      penaltyNote.id = SPEED_PENALTY_ID;
      penaltyNote.className = "fb-speed-box__penalty";
      speedBox.appendChild(penaltyNote);
    }

    penaltyNote.textContent = `-${penalty} ft. from ${extraSlots} extra ${
      extraSlots === 1 ? "slot" : "slots"
    }.`;

    let warning = speedBox.querySelector(`#${SPEED_WARNING_ID}`);
    if (adjustedSpeed === 0) {
      if (!warning) {
        warning = document.createElement("div");
        warning.id = SPEED_WARNING_ID;
        warning.className = "fb-speed-box__warning";
        speedBox.appendChild(warning);
      }

      warning.textContent = "Overencumbered: speed reduced to 0 ft.";
    } else {
      warning?.remove();
    }

    return {
      baseSpeed,
      adjustedSpeed,
      penalty,
      intensity,
    };
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
    if (!inventoryRoot) {
      resetSpeedPenalty();
      return false;
    }

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
    const overBy = Math.max(usedSlots - capacity, 0);
    const speedPenaltyState = updateSpeedPenalty(overBy);
    let summary = document.getElementById(SLOT_SUMMARY_ID);
    if (!summary) {
      summary = createSlotSummary();
      overview.insertAdjacentElement("afterend", summary);
    }

    summary.dataset.state =
      speedPenaltyState?.adjustedSpeed === 0 && overBy > 0
        ? "stopped"
        : usedSlots > capacity
          ? "over"
          : usedSlots >= capacity
            ? "full"
            : "ok";

    const value = summary.querySelector(".fb-slot-summary__value");
    const detail = summary.querySelector(".fb-slot-summary__detail");
    const warning = summary.querySelector(`.${SLOT_WARNING_CLASS}`);
    const breakdown = summary.querySelector(".fb-slot-summary__breakdown");

    value.textContent = `${usedSlots} / ${capacity}`;
    if (overBy > 0 && speedPenaltyState) {
      detail.textContent = `Over max by ${overBy}. Speed penalty: -${speedPenaltyState.penalty} ft.`;
    } else {
      detail.textContent =
        "Every item row counts, including Equipment. Containers do not spend slots themselves.";
    }

    if (speedPenaltyState && overBy > 0) {
      summary.style.setProperty(
        "--fb-summary-border-color",
        mixColor([221, 151, 14], [197, 49, 49], speedPenaltyState.intensity, 0.58)
      );
      summary.style.setProperty(
        "--fb-summary-bg-top",
        mixColor([255, 248, 237], [255, 230, 223], speedPenaltyState.intensity, 0.98)
      );
      summary.style.setProperty(
        "--fb-summary-bg-bottom",
        mixColor([244, 233, 213], [255, 214, 206], speedPenaltyState.intensity, 0.95)
      );
      summary.style.setProperty(
        "--fb-summary-value-color",
        mixColor([18, 24, 28], [151, 27, 27], speedPenaltyState.intensity, 1)
      );
    } else {
      summary.style.removeProperty("--fb-summary-border-color");
      summary.style.removeProperty("--fb-summary-bg-top");
      summary.style.removeProperty("--fb-summary-bg-bottom");
      summary.style.removeProperty("--fb-summary-value-color");
    }

    if (warning) {
      if (speedPenaltyState?.adjustedSpeed === 0 && overBy > 0) {
        warning.hidden = false;
        warning.textContent = "Overencumbered: speed reduced to 0 ft.";
      } else {
        warning.hidden = true;
        warning.textContent = "";
      }
    }

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
