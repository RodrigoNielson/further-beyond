/* =============================================
   Further Beyond – Content Script
   Adds an active indicator and slot-based inventory tracking
   ============================================= */

(function () {
  "use strict";

  if (!window.location.pathname.startsWith("/characters/")) return;

  const INDICATOR_ID = "fb-active-indicator";
  const CONTAINER_BADGE_CLASS = "fb-container-slot-badge";
  const ITEM_IGNORE_TOGGLE_CLASS = "fb-item-ignore-toggle";
  const SPEED_PENALTY_ID = "fb-speed-penalty";
  const SPEED_WARNING_ID = "fb-speed-warning";
  const PAGE_BRIDGE_SCRIPT_ID = "fb-page-bridge";
  const INVENTORY_REQUEST_EVENT = "fb:inventory-request";
  const INVENTORY_RESPONSE_EVENT = "fb:inventory-response";
  const IGNORE_WEIGHT_STORAGE_KEY_PREFIX = "fb:ignored-weight:";
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
    totalCoins: null,
    coinSlots: null,
  };
  const ignoreWeightState = {
    characterKey: getCharacterKey(),
    itemKeys: loadIgnoredItemKeys(getCharacterKey()),
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
    const characterKey = getCharacterKey();
    const ignoredItemKeys = ensureIgnoredWeightState(characterKey);
    const containerNameCounts = new Map();

    return Array.from(document.querySelectorAll(".ct-equipment .ct-content-group"))
      .map((group) => {
        const name = getContainerName(group);
        if (!name) {
          return null;
        }

        const normalizedContainerName = normalizeInventoryKeyPart(name) || "container";
        const containerOccurrence =
          (containerNameCounts.get(normalizedContainerName) || 0) + 1;
        containerNameCounts.set(normalizedContainerName, containerOccurrence);

        const key = `${normalizedContainerName}::${containerOccurrence}`;

        const itemRows = Array.from(
          group.querySelectorAll(
            ".ct-content-group__content .ct-inventory__items > .ct-inventory-item"
          )
        );
        const itemNameCounts = new Map();
        const items = itemRows.map((row) => {
          const itemName = getInventoryItemName(row);
          const normalizedItemName = normalizeInventoryKeyPart(itemName) || "item";
          const itemOccurrence = (itemNameCounts.get(normalizedItemName) || 0) + 1;
          const itemKey = buildInventoryItemKey(key, itemName, itemOccurrence);

          itemNameCounts.set(normalizedItemName, itemOccurrence);

          return {
            row,
            key: itemKey,
            ignored: ignoredItemKeys.has(itemKey),
          };
        });
        const countsContainer = false;
        const ignoredCount = items.filter((item) => item.ignored).length;

        items.forEach((item) => {
          upsertIgnoreWeightToggle(item, characterKey);
        });

        return {
          group,
          key,
          name,
          itemKeys: items.map((item) => item.key),
          ignoredCount,
          itemCount: itemRows.length,
          countsContainer,
          slotCount: itemRows.length - ignoredCount,
        };
      })
      .filter(Boolean);
  }

  function cloneContainerData(containers) {
    return containers.map((container) => ({
      key: container.key,
      name: container.name,
      ignoredCount: container.ignoredCount,
      itemCount: container.itemCount,
      countsContainer: container.countsContainer,
      slotCount: container.slotCount,
    }));
  }

  function pruneIgnoredItemKeys(characterKey, containers) {
    const ignoredItemKeys = ensureIgnoredWeightState(characterKey);
    const visibleItemKeys = new Set(
      containers.flatMap((container) => container.itemKeys || [])
    );
    let hasChanges = false;

    Array.from(ignoredItemKeys).forEach((itemKey) => {
      if (!visibleItemKeys.has(itemKey)) {
        ignoredItemKeys.delete(itemKey);
        hasChanges = true;
      }
    });

    if (hasChanges) {
      saveIgnoredItemKeys(characterKey, ignoredItemKeys);
    }
  }

  function getCharacterKey() {
    return window.location.pathname.split("/")[2] || "";
  }

  function normalizeInventoryKeyPart(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function getIgnoredWeightStorageKey(characterKey) {
    return `${IGNORE_WEIGHT_STORAGE_KEY_PREFIX}${characterKey}`;
  }

  function loadIgnoredItemKeys(characterKey) {
    if (!characterKey) {
      return new Set();
    }

    try {
      const rawValue = window.localStorage.getItem(
        getIgnoredWeightStorageKey(characterKey)
      );
      const parsedValue = rawValue ? JSON.parse(rawValue) : [];

      return new Set(Array.isArray(parsedValue) ? parsedValue : []);
    } catch (error) {
      return new Set();
    }
  }

  function saveIgnoredItemKeys(characterKey, itemKeys) {
    if (!characterKey) {
      return;
    }

    try {
      window.localStorage.setItem(
        getIgnoredWeightStorageKey(characterKey),
        JSON.stringify(Array.from(itemKeys).sort())
      );
    } catch (error) {
      console.warn("[Further Beyond] Could not save ignored weight items.", error);
    }
  }

  function ensureIgnoredWeightState(characterKey) {
    if (ignoreWeightState.characterKey !== characterKey) {
      ignoreWeightState.characterKey = characterKey;
      ignoreWeightState.itemKeys = loadIgnoredItemKeys(characterKey);
    }

    return ignoreWeightState.itemKeys;
  }

  function toggleIgnoredItemWeight(characterKey, itemKey) {
    if (!itemKey) {
      return;
    }

    const ignoredItemKeys = ensureIgnoredWeightState(characterKey);
    if (ignoredItemKeys.has(itemKey)) {
      ignoredItemKeys.delete(itemKey);
    } else {
      ignoredItemKeys.add(itemKey);
    }

    saveIgnoredItemKeys(characterKey, ignoredItemKeys);
    scheduleRefresh();
  }

  function handleIgnoreWeightToggleClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    toggleIgnoredItemWeight(
      button.dataset.characterKey || getCharacterKey(),
      button.dataset.itemKey || ""
    );
  }

  function getTextWithoutIgnoreToggle(element) {
    if (!element) {
      return "";
    }

    const clone = element.cloneNode(true);
    clone
      .querySelectorAll(`.${ITEM_IGNORE_TOGGLE_CLASS}`)
      .forEach((toggle) => toggle.remove());

    return clone.textContent.replace(/\s+/g, " ").trim();
  }

  function getInventoryItemName(itemRow) {
    const nameSelectors = [
      ".ct-inventory-item__name",
      ".styles_itemName__xLCwW",
      '[class*="itemName"]',
    ];

    for (const selector of nameSelectors) {
      const nameElement = itemRow.querySelector(selector);
      const text = getTextWithoutIgnoreToggle(nameElement);
      if (text) {
        return text;
      }
    }

    return getTextWithoutIgnoreToggle(itemRow);
  }

  function getInventoryItemToggleAnchor(itemRow) {
    const weightCell = itemRow.querySelector(
      ".ct-inventory-item__weight, [class*='weight']"
    );

    if (weightCell) {
      return {
        element: weightCell,
        replaceContents: true,
      };
    }

    return {
      element:
        itemRow.querySelector(
          ".ct-inventory-item__name, .ct-inventory-item__definition, .styles_itemName__xLCwW"
        ) || itemRow,
      replaceContents: false,
    };
  }

  function buildInventoryItemKey(containerKey, itemName, occurrence) {
    const normalizedItemName = normalizeInventoryKeyPart(itemName) || "item";
    return `${containerKey}::${normalizedItemName}::${occurrence}`;
  }

  function upsertIgnoreWeightToggle(item, characterKey) {
    const anchor = getInventoryItemToggleAnchor(item.row);
    if (!anchor?.element) {
      return;
    }

    let toggle = item.row.querySelector(`.${ITEM_IGNORE_TOGGLE_CLASS}`);
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = ITEM_IGNORE_TOGGLE_CLASS;
      toggle.addEventListener("click", handleIgnoreWeightToggleClick);
    }

    if (anchor.replaceContents) {
      if (toggle.parentElement !== anchor.element || anchor.element.childNodes.length !== 1) {
        anchor.element.replaceChildren(toggle);
      }
    } else if (toggle.parentElement !== anchor.element) {
      anchor.element.appendChild(toggle);
    }

    item.row.dataset.fbWeightIgnored = item.ignored ? "true" : "false";
    toggle.dataset.characterKey = characterKey;
    toggle.dataset.itemKey = item.key;
    toggle.dataset.ignored = item.ignored ? "true" : "false";
    toggle.setAttribute("aria-pressed", item.ignored ? "true" : "false");
    toggle.setAttribute(
      "aria-label",
      item.ignored ? "Item weight ignored" : "Item weight counted"
    );
    toggle.textContent = "";
    toggle.title = item.ignored
      ? "This item is ignored for slot weight. Click to count it again."
      : "This item counts toward slot weight. Click to ignore it.";
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
    inventorySnapshot.totalCoins = null;
    inventorySnapshot.coinSlots = null;
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
      visibleContainers.map((container) => [container.key, container])
    );
    const merged = cachedContainers.map(
      (container) => visibleByName.get(container.key) || container
    );

    visibleContainers.forEach((container) => {
      if (!cachedContainers.some((cached) => cached.key === container.key)) {
        merged.push(container);
      }
    });

    return merged;
  }

  function createSlotOverview() {
    const content = document.createElement("div");
    const heading = document.createElement("div");
    const label = document.createElement("span");
    const note = document.createElement("span");
    const noteIcon = document.createElement("span");
    const noteValue = document.createElement("span");
    const value = document.createElement("span");
    const meta = document.createElement("span");

    content.className = "fb-slot-overview";
    heading.className = "fb-slot-overview__heading";

    label.className = "fb-slot-overview__label";
    label.textContent = "Item Slots";

    note.className = "fb-slot-overview__note";
    note.hidden = true;
    noteIcon.className = "fb-slot-overview__coin-icon";
    noteIcon.setAttribute("aria-hidden", "true");
    noteValue.className = "fb-slot-overview__coin-value";
    note.appendChild(noteIcon);
    note.appendChild(noteValue);

    value.className = "fb-slot-overview__value";

    meta.className = "fb-slot-overview__meta";
    meta.hidden = true;

    heading.appendChild(label);
    heading.appendChild(note);
    content.appendChild(heading);
    content.appendChild(value);
    content.appendChild(meta);

    return content;
  }

  function formatCoinSlotNote(coinSlots) {
    if (!Number.isFinite(coinSlots)) {
      return "";
    }

    return `Coins: ${coinSlots} ${coinSlots === 1 ? "slot" : "slots"}`;
  }

  function formatCoinSlotTooltip(coinSlots, totalCoins) {
    if (!Number.isFinite(coinSlots)) {
      return "";
    }

    if (Number.isFinite(totalCoins)) {
      return `Coins are occupying ${coinSlots} ${coinSlots === 1 ? "slot" : "slots"}. ${totalCoins.toLocaleString()} total coins / 250 = ${coinSlots}.`;
    }

    return `Coins are occupying ${coinSlots} ${coinSlots === 1 ? "slot" : "slots"} at 250 coins per slot.`;
  }

  function updateSlotOverviewButton(
    overview,
    usedSlots,
    capacity,
    totalCoins,
    coinSlots,
    overBy,
    speedPenaltyState
  ) {
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
    const note = content.querySelector(".fb-slot-overview__note");
    const noteIcon = content.querySelector(".fb-slot-overview__coin-icon");
    const noteValue = content.querySelector(".fb-slot-overview__coin-value");
    const intensity = speedPenaltyState?.intensity ?? 0;
    const coinSlotNote = formatCoinSlotNote(coinSlots);
    const coinSlotTooltip = formatCoinSlotTooltip(coinSlots, totalCoins);

    value.textContent = `${usedSlots} / ${capacity}`;
    note.hidden = !coinSlotNote;
    noteValue.textContent = Number.isFinite(coinSlots) ? String(coinSlots) : "";

    if (coinSlotTooltip) {
      note.title = coinSlotTooltip;
      note.setAttribute("aria-label", coinSlotTooltip);
      noteIcon.title = coinSlotTooltip;
    } else {
      note.removeAttribute("title");
      note.removeAttribute("aria-label");
      noteIcon.removeAttribute("title");
    }

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
    button.title = [
      `${usedSlots} / ${capacity} item slots used.`,
      coinSlotNote ? `${coinSlotNote}.` : "",
      overBy > 0 && speedPenaltyState
        ? `Speed penalty: -${speedPenaltyState.penalty} ft.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
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

    badge.textContent = `${container.slotCount} slots`;

    badge.dataset.weightless = container.countsContainer ? "false" : "true";
    badge.title = container.countsContainer
      ? `${container.name} counts as 1 slot plus ${container.slotCount} stored item slots.`
      : container.ignoredCount > 0
        ? `${container.name} is excluded from container-slot cost. ${container.ignoredCount} item${container.ignoredCount === 1 ? "" : "s"} ignored for slot weight.`
        : `${container.name} is excluded from container-slot cost.`;
  }

  async function mountInventorySlots() {
    const characterKey = getCharacterKey();
    if (inventorySnapshot.characterKey !== characterKey) {
      resetInventorySnapshot(characterKey);
    }

    const ignoredItemCount = ensureIgnoredWeightState(characterKey).size;

    let pageSnapshot = null;
    try {
      pageSnapshot = await getPageInventorySnapshot();
    } catch (error) {
      pageSnapshot = null;
    }

    const snapshotUsedSlots = Number.isFinite(pageSnapshot?.usedSlots)
      ? Math.max(pageSnapshot.usedSlots - ignoredItemCount, 0)
      : null;

    if (pageSnapshot?.characterKey === characterKey) {
      inventorySnapshot.usedSlots = snapshotUsedSlots;
      inventorySnapshot.capacity = pageSnapshot.capacity;
      inventorySnapshot.totalCoins = Number.isFinite(pageSnapshot.totalCoins)
        ? pageSnapshot.totalCoins
        : null;
      inventorySnapshot.coinSlots = Number.isFinite(pageSnapshot.coinSlots)
        ? pageSnapshot.coinSlots
        : null;
    }

    const inventoryRoot = document.querySelector(".ct-equipment");
    if (!inventoryRoot) {
      // Calculate slots from the bridge on initial page load before Inventory has rendered.
      if (Number.isFinite(snapshotUsedSlots) && Number.isFinite(pageSnapshot?.capacity)) {
        updateSpeedPenalty(
          Math.max(snapshotUsedSlots - pageSnapshot.capacity, 0)
        );
        return false;
      }

      applyStoredSpeedPenalty(characterKey);
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
      pruneIgnoredItemKeys(characterKey, visibleContainers);
      inventorySnapshot.containers = cloneContainerData(visibleContainers);
    }

    const containers = isUnfiltered
      ? visibleContainers
      : mergeContainerSnapshots(inventorySnapshot.containers, visibleContainers);
    const itemSlots = containers.reduce(
      (total, container) => total + container.slotCount,
      0
    );
    const totalCoins = Number.isFinite(pageSnapshot?.totalCoins)
      ? pageSnapshot.totalCoins
      : inventorySnapshot.totalCoins;
    const coinSlots = Number.isFinite(pageSnapshot?.coinSlots)
      ? pageSnapshot.coinSlots
      : inventorySnapshot.coinSlots;
    const usedSlots = !isUnfiltered && !inventorySnapshot.containers.length && Number.isFinite(pageSnapshot?.usedSlots)
      ? Math.max(pageSnapshot.usedSlots - ignoredItemCount, 0)
      : itemSlots + (Number.isFinite(coinSlots) ? coinSlots : 0);
    const overBy = Math.max(usedSlots - capacity, 0);
    const speedPenaltyState = updateSpeedPenalty(overBy);

    inventorySnapshot.usedSlots = usedSlots;
    inventorySnapshot.capacity = capacity;
    inventorySnapshot.totalCoins = totalCoins;
    inventorySnapshot.coinSlots = coinSlots;

    updateSlotOverviewButton(
      overview,
      usedSlots,
      capacity,
      totalCoins,
      coinSlots,
      overBy,
      speedPenaltyState
    );

    visibleContainers.forEach((container) => {
      const cachedContainer = containers.find(
        (candidate) => candidate.key === container.key
      );

      upsertContainerBadge({
        ...container,
        key: cachedContainer?.key ?? container.key,
        ignoredCount: cachedContainer?.ignoredCount ?? container.ignoredCount,
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
