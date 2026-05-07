/* =============================================
   Further Beyond – Content Script
   Adds an active indicator and slot-based inventory tracking
   ============================================= */

(function () {
  "use strict";

  if (!window.location.pathname.startsWith("/characters/")) return;

  const INDICATOR_ID = "fb-active-indicator";
  const CONTAINER_BADGE_CLASS = "fb-container-slot-badge";
  const SPEED_PENALTY_ID = "fb-speed-penalty";
  const SPEED_WARNING_ID = "fb-speed-warning";
  const PAGE_BRIDGE_SCRIPT_ID = "fb-page-bridge";
  const INVENTORY_REQUEST_EVENT = "fb:inventory-request";
  const INVENTORY_RESPONSE_EVENT = "fb:inventory-response";
  const HEADING_SELECTORS = [
    "main .ddbc-character-tidbits__heading h1",
    "main h1.styles_characterName__2x8wQ",
    "main h1",
  ];
  const inventorySnapshot = {
    characterKey: getCharacterKey(),
    containers: [],
    usedSlots: null,
    capacity: null,
  };
  const pageBridgeState = {
    bridgePromise: null,
    listenerBound: false,
    pendingRequests: new Map(),
    activeInventoryPromise: null,
  };

  let refreshPending = false;

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

  function ensurePageBridge() {
    if (pageBridgeState.bridgePromise) {
      return pageBridgeState.bridgePromise;
    }

    pageBridgeState.bridgePromise = new Promise((resolve, reject) => {
      let script = document.getElementById(PAGE_BRIDGE_SCRIPT_ID);
      if (script?.dataset.loaded === "true") {
        resolve();
        return;
      }

      const handleLoad = () => {
        script.dataset.loaded = "true";
        resolve();
      };
      const handleError = () => {
        pageBridgeState.bridgePromise = null;
        reject(new Error("The page inventory bridge could not be injected."));
      };

      if (!script) {
        script = document.createElement("script");
        script.id = PAGE_BRIDGE_SCRIPT_ID;
        script.src = chrome.runtime.getURL("content/page-bridge.js");
        script.async = false;
        script.addEventListener("load", handleLoad, { once: true });
        script.addEventListener("error", handleError, { once: true });
        (document.documentElement || document.head || document.body).appendChild(
          script
        );
        return;
      }

      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });
    });

    return pageBridgeState.bridgePromise;
  }

  function handleInventorySnapshotResponse(event) {
    const detail = event.detail || {};
    const pending = pageBridgeState.pendingRequests.get(detail.requestId);
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    pageBridgeState.pendingRequests.delete(detail.requestId);

    if (detail.ok) {
      pending.resolve(detail.snapshot || null);
      return;
    }

    pending.reject(new Error(detail.error || "The inventory bridge failed."));
  }

  function ensureInventoryBridgeListener() {
    if (pageBridgeState.listenerBound) {
      return;
    }

    window.addEventListener(
      INVENTORY_RESPONSE_EVENT,
      handleInventorySnapshotResponse
    );
    pageBridgeState.listenerBound = true;
  }

  async function requestInventorySnapshot() {
    ensureInventoryBridgeListener();
    await ensurePageBridge();

    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timeoutId = window.setTimeout(() => {
        pageBridgeState.pendingRequests.delete(requestId);
        reject(new Error("The inventory bridge timed out."));
      }, 3000);

      pageBridgeState.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeoutId,
      });

      window.dispatchEvent(
        new CustomEvent(INVENTORY_REQUEST_EVENT, {
          detail: { requestId },
        })
      );
    });
  }

  async function getPageInventorySnapshot() {
    if (pageBridgeState.activeInventoryPromise) {
      return pageBridgeState.activeInventoryPromise;
    }

    pageBridgeState.activeInventoryPromise = requestInventorySnapshot().finally(() => {
      pageBridgeState.activeInventoryPromise = null;
    });

    return pageBridgeState.activeInventoryPromise;
  }

  function resetInventorySnapshot(characterKey) {
    inventorySnapshot.characterKey = characterKey;
    inventorySnapshot.containers = [];
    inventorySnapshot.usedSlots = null;
    inventorySnapshot.capacity = null;
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

  function createSlotOverview() {
    const content = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("span");
    const meta = document.createElement("span");

    content.className = "fb-slot-overview";

    label.className = "fb-slot-overview__label";
    label.textContent = "Item Slots";

    value.className = "fb-slot-overview__value";

    meta.className = "fb-slot-overview__meta";
    meta.hidden = true;

    content.appendChild(label);
    content.appendChild(value);
    content.appendChild(meta);

    return content;
  }

  function updateSlotOverviewButton(overview, usedSlots, capacity, overBy, speedPenaltyState) {
    const button = overview.querySelector(".styles_overviewPrimaryButton__j84A5, button");
    if (!button) return;

    button.classList.add("fb-slot-overview-button");

    let content = button.querySelector(".fb-slot-overview");
    if (!content) {
      content = createSlotOverview();
      button.replaceChildren(content);
    }

    const value = content.querySelector(".fb-slot-overview__value");
    const meta = content.querySelector(".fb-slot-overview__meta");
    const intensity = speedPenaltyState?.intensity ?? 0;

    value.textContent = `${usedSlots} / ${capacity}`;

    if (overBy > 0 && speedPenaltyState) {
      meta.hidden = false;
      meta.textContent =
        speedPenaltyState.adjustedSpeed === 0
          ? "0 ft. speed"
          : `-${speedPenaltyState.penalty} ft. speed`;
      button.style.setProperty(
        "--fb-slot-button-border",
        mixColor([221, 151, 14], [197, 49, 49], intensity, 0.62)
      );
      button.style.setProperty(
        "--fb-slot-button-bg-top",
        mixColor([255, 248, 237], [255, 230, 223], intensity, 1)
      );
      button.style.setProperty(
        "--fb-slot-button-bg-bottom",
        mixColor([244, 233, 213], [255, 214, 206], intensity, 0.98)
      );
      button.style.setProperty(
        "--fb-slot-button-value",
        mixColor([18, 24, 28], [151, 27, 27], intensity, 1)
      );
    } else {
      meta.hidden = true;
      meta.textContent = "";
      button.style.removeProperty("--fb-slot-button-border");
      button.style.removeProperty("--fb-slot-button-bg-top");
      button.style.removeProperty("--fb-slot-button-bg-bottom");
      button.style.removeProperty("--fb-slot-button-value");
    }

    button.dataset.fbSlotState =
      speedPenaltyState?.adjustedSpeed === 0 && overBy > 0
        ? "stopped"
        : usedSlots > capacity
          ? "over"
          : usedSlots >= capacity
            ? "full"
            : "ok";
    button.title =
      overBy > 0 && speedPenaltyState
        ? `${usedSlots} / ${capacity} slots. Speed penalty: -${speedPenaltyState.penalty} ft.`
        : `${usedSlots} / ${capacity} item slots used.`;
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

    speedBox.querySelector(`#${SPEED_PENALTY_ID}`)?.remove();
    speedBox.querySelector(`#${SPEED_WARNING_ID}`)?.remove();

    return {
      baseSpeed,
      adjustedSpeed,
      penalty,
      intensity,
    };
  }

  function applyStoredSpeedPenalty(characterKey) {
    if (inventorySnapshot.characterKey !== characterKey) {
      resetInventorySnapshot(characterKey);
      resetSpeedPenalty();
      return false;
    }

    if (
      !Number.isFinite(inventorySnapshot.usedSlots) ||
      !Number.isFinite(inventorySnapshot.capacity)
    ) {
      return false;
    }

    updateSpeedPenalty(
      Math.max(inventorySnapshot.usedSlots - inventorySnapshot.capacity, 0)
    );
    return true;
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

  async function mountInventorySlots() {
    const characterKey = getCharacterKey();
    if (inventorySnapshot.characterKey !== characterKey) {
      resetInventorySnapshot(characterKey);
    }

    let pageSnapshot = null;
    try {
      pageSnapshot = await getPageInventorySnapshot();
    } catch (error) {
      pageSnapshot = null;
    }

    if (pageSnapshot?.characterKey === characterKey) {
      inventorySnapshot.usedSlots = pageSnapshot.usedSlots;
      inventorySnapshot.capacity = pageSnapshot.capacity;
    }

    const inventoryRoot = document.querySelector(".ct-equipment");
    if (!inventoryRoot) {
      if (
        pageSnapshot?.characterKey === characterKey &&
        Number.isFinite(pageSnapshot.usedSlots) &&
        Number.isFinite(pageSnapshot.capacity)
      ) {
        updateSpeedPenalty(
          Math.max(pageSnapshot.usedSlots - pageSnapshot.capacity, 0)
        );
      } else {
        applyStoredSpeedPenalty(characterKey);
      }
      return false;
    }

    const overview = inventoryRoot.querySelector(".ct-equipment__overview");
    if (!overview) return false;

    const capacity = Number.isFinite(pageSnapshot?.capacity)
      ? pageSnapshot.capacity
      : getStrengthCapacity();
    if (!Number.isFinite(capacity)) {
      applyStoredSpeedPenalty(characterKey);
      return false;
    }

    const visibleContainers = collectInventoryContainers();
    const isUnfiltered = isUnfilteredInventoryView(inventoryRoot);

    if (isUnfiltered) {
      inventorySnapshot.containers = cloneContainerData(visibleContainers);
    }

    const containers = isUnfiltered
      ? visibleContainers
      : mergeContainerSnapshots(inventorySnapshot.containers, visibleContainers);
    const domUsedSlots = containers.reduce(
      (total, container) => total + container.slotCount,
      0
    );
    const usedSlots = Number.isFinite(pageSnapshot?.usedSlots)
      ? pageSnapshot.usedSlots
      : domUsedSlots;
    const overBy = Math.max(usedSlots - capacity, 0);
    const speedPenaltyState = updateSpeedPenalty(overBy);

    inventorySnapshot.usedSlots = usedSlots;
    inventorySnapshot.capacity = capacity;

    updateSlotOverviewButton(overview, usedSlots, capacity, overBy, speedPenaltyState);

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

  async function refreshUi() {
    refreshPending = false;
    mountIndicator();
    await mountInventorySlots();
  }

  function scheduleRefresh() {
    if (refreshPending) return;
    refreshPending = true;
    window.requestAnimationFrame(() => {
      Promise.resolve(refreshUi()).catch((error) => {
        refreshPending = false;
        console.error("[Further Beyond] UI refresh failed.", error);
      });
    });
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
      if (pageBridgeState.listenerBound) {
        window.removeEventListener(
          INVENTORY_RESPONSE_EVENT,
          handleInventorySnapshotResponse
        );
      }
    },
    { once: true }
  );
})();
