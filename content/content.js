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
  const CONFIG_TRIGGER_ID = "fb-config-trigger";
  const CONFIG_MODAL_ID = "fb-config-modal";
  const PAGE_BRIDGE_SCRIPT_ID = "fb-page-bridge";
  const INVENTORY_REQUEST_EVENT = "fb:inventory-request";
  const INVENTORY_RESPONSE_EVENT = "fb:inventory-response";
  const SHORT_REST_REQUEST_EVENT = "fb:short-rest-request";
  const SHORT_REST_RESPONSE_EVENT = "fb:short-rest-response";
  const IGNORE_WEIGHT_STORAGE_KEY_PREFIX = "fb:ignored-weight:";
  const EXTENSION_SETTINGS_STORAGE_KEY = "fb:settings";
  const SHORT_REST_ACTION_CLASS = "fb-short-rest-action";
  const SHORT_REST_USE_BUTTON_CLASS = "fb-short-rest-use-hit-die";
  const SHORT_REST_STATUS_CLASS = "fb-short-rest-status";
  const SHORT_REST_CUSTOM_GROUP_CLASS = "fb-short-rest-hitdie-group";
  const SHORT_REST_CUSTOM_MANAGER_CLASS = "fb-short-rest-hitdie-manager";
  const SHORT_REST_CUSTOM_SLOT_CLASS = "fb-short-rest-hitdie-slot";
  const SHORT_REST_CUSTOM_SLOT_INPUT_CLASS = "fb-short-rest-hitdie-slot-input";
  const SHORT_REST_NATIVE_MANAGER_HIDDEN_ATTR = "data-fb-short-rest-native-hidden";
  const DEFAULT_EXTENSION_SETTINGS = Object.freeze({
    itemSlotsEnabled: true,
    coinsHaveWeight: true,
    coinsPerSlot: 250,
    shortRestHitDiceEnabled: true,
  });
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
    shortRestListenerBound: false,
    pendingShortRestRequests: new Map(),
    activeShortRestPromise: null,
  };
  const extensionSettingsState = {
    value: { ...DEFAULT_EXTENSION_SETTINGS },
    loadPromise: null,
    loaded: false,
    listenerBound: false,
  };
  const shortRestUiState = {
    characterKey: "",
    pendingUsage: {},
    dirty: false,
  };

  let refreshPending = false;
  let settingsStatusTimeoutId = null;
  let shortRestStatusTimeoutId = null;

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

  function findManageButton() {
    const candidates = Array.from(
      document.querySelectorAll("main button, main a, main [role='button']")
    ).filter((element) => {
      if (element.id === CONFIG_TRIGGER_ID) {
        return false;
      }

      return (
        isElementVisible(element) &&
        normalizeText(element.textContent).toUpperCase() === "MANAGE"
      );
    });

    if (!candidates.length) {
      return null;
    }

    candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();

      if (leftRect.top !== rightRect.top) {
        return leftRect.top - rightRect.top;
      }

      return leftRect.left - rightRect.left;
    });

    return candidates[0];
  }

  function handleConfigTriggerClick(event) {
    event.preventDefault();
    event.stopPropagation();
    openConfigModal();
  }

  function createConfigTrigger(manageButton) {
    const tagName = manageButton?.tagName?.toLowerCase() === "a" ? "a" : "button";
    const trigger = document.createElement(tagName);
    const content = document.createElement("span");
    const label = document.createElement("span");

    trigger.id = CONFIG_TRIGGER_ID;
    trigger.className = manageButton?.className || "";
    trigger.dataset.fbConfigTrigger = "true";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", CONFIG_MODAL_ID);
    trigger.setAttribute("aria-expanded", "false");
    trigger.title = "Open Further Beyond settings";

    if (tagName === "button") {
      trigger.type = "button";
    } else {
      trigger.href = "#";
      trigger.setAttribute("role", "button");
    }

    content.className = "fb-config-trigger__content";

    label.className = "fb-config-trigger__label";
    label.textContent = "FURTHER BEYOND";

    content.appendChild(label);
    trigger.replaceChildren(content);
    trigger.addEventListener("click", handleConfigTriggerClick);

    return trigger;
  }

  function mountConfigTrigger() {
    const manageButton = findManageButton();
    if (!manageButton) {
      return false;
    }

    let trigger = document.getElementById(CONFIG_TRIGGER_ID);
    if (!trigger) {
      trigger = createConfigTrigger(manageButton);
    }

    if (trigger.previousElementSibling !== manageButton) {
      manageButton.insertAdjacentElement("afterend", trigger);
    }

    return true;
  }

  function getConfigModal() {
    return document.getElementById(CONFIG_MODAL_ID);
  }

  function setConfigStatus(message, state) {
    const modal = getConfigModal();
    const status = modal?.querySelector(".fb-config-modal__status");
    if (!status) {
      return;
    }

    window.clearTimeout(settingsStatusTimeoutId);
    settingsStatusTimeoutId = null;
    status.textContent = message || "";

    if (state) {
      status.dataset.state = state;
    } else {
      delete status.dataset.state;
    }

    if (message && state !== "error") {
      settingsStatusTimeoutId = window.setTimeout(() => {
        setConfigStatus("", "");
      }, 1400);
    }
  }

  function updateConfigFormDisabledState(settings) {
    const modal = getConfigModal();
    if (!modal) {
      return;
    }

    const coinSettings = modal.querySelector(".fb-config-modal__coin-settings");
    const coinsHaveWeight = modal.querySelector("#fb-settings-coins-have-weight");
    const coinsPerSlot = modal.querySelector("#fb-settings-coins-per-slot");
    const itemSlotsEnabled = !!settings.itemSlotsEnabled;
    const coinsEnabled = itemSlotsEnabled && !!settings.coinsHaveWeight;

    if (coinSettings) {
      coinSettings.setAttribute("aria-disabled", itemSlotsEnabled ? "false" : "true");
    }

    if (coinsHaveWeight) {
      coinsHaveWeight.disabled = !itemSlotsEnabled;
    }

    if (coinsPerSlot) {
      coinsPerSlot.disabled = !coinsEnabled;
    }
  }

  function syncConfigForm(settings) {
    const modal = getConfigModal();
    if (!modal) {
      return;
    }

    const itemSlotsEnabled = modal.querySelector("#fb-settings-item-slots-enabled");
    const coinsHaveWeight = modal.querySelector("#fb-settings-coins-have-weight");
    const coinsPerSlot = modal.querySelector("#fb-settings-coins-per-slot");
    const shortRestHitDiceEnabled = modal.querySelector(
      "#fb-settings-short-rest-hit-dice-enabled"
    );

    if (itemSlotsEnabled) {
      itemSlotsEnabled.checked = !!settings.itemSlotsEnabled;
    }

    if (coinsHaveWeight) {
      coinsHaveWeight.checked = !!settings.coinsHaveWeight;
    }

    if (coinsPerSlot) {
      coinsPerSlot.value = String(settings.coinsPerSlot);
    }

    if (shortRestHitDiceEnabled) {
      shortRestHitDiceEnabled.checked = !!settings.shortRestHitDiceEnabled;
    }

    updateConfigFormDisabledState(settings);
  }

  function readConfigFormSettings() {
    const modal = getConfigModal();
    return normalizeExtensionSettings({
      itemSlotsEnabled:
        modal?.querySelector("#fb-settings-item-slots-enabled")?.checked ??
        DEFAULT_EXTENSION_SETTINGS.itemSlotsEnabled,
      coinsHaveWeight:
        modal?.querySelector("#fb-settings-coins-have-weight")?.checked ??
        DEFAULT_EXTENSION_SETTINGS.coinsHaveWeight,
      coinsPerSlot:
        modal?.querySelector("#fb-settings-coins-per-slot")?.value ??
        DEFAULT_EXTENSION_SETTINGS.coinsPerSlot,
      shortRestHitDiceEnabled:
        modal?.querySelector("#fb-settings-short-rest-hit-dice-enabled")
          ?.checked ?? DEFAULT_EXTENSION_SETTINGS.shortRestHitDiceEnabled,
    });
  }

  async function handleConfigFormChange() {
    const settings = readConfigFormSettings();
    syncConfigForm(settings);

    try {
      await saveExtensionSettings(settings);
      setConfigStatus("Saved.", "ok");
      scheduleRefresh();
    } catch (error) {
      console.error("[Further Beyond] Could not save extension settings.", error);
      setConfigStatus("Could not save settings.", "error");
      syncConfigForm(getExtensionSettings());
    }
  }

  function closeConfigModal() {
    const modal = getConfigModal();
    const trigger = document.getElementById(CONFIG_TRIGGER_ID);
    if (!modal) {
      return;
    }

    modal.hidden = true;
    document.body.classList.remove("fb-config-modal-open");

    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
      trigger.focus();
    }
  }

  function handleConfigModalClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (
      target.matches("[data-fb-config-close='true']") ||
      target.classList.contains("fb-config-modal")
    ) {
      closeConfigModal();
    }
  }

  function handleConfigModalKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfigModal();
    }
  }

  function createConfigModal() {
    const modal = document.createElement("div");

    modal.id = CONFIG_MODAL_ID;
    modal.className = "fb-config-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="fb-config-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="fb-config-modal-title" tabindex="-1">
        <button type="button" class="fb-config-modal__close" data-fb-config-close="true" aria-label="Close settings">x</button>
        <header class="fb-config-modal__header">
          <p class="fb-config-modal__eyebrow">Further Beyond</p>
          <h2 id="fb-config-modal-title">Feature Settings</h2>
          <p class="fb-config-modal__intro">Changes save automatically and apply immediately.</p>
        </header>
        <form class="fb-config-modal__form">
          <section class="fb-config-modal__card">
            <label class="fb-config-modal__toggle" for="fb-settings-item-slots-enabled">
              <span class="fb-config-modal__copy">
                <span class="fb-config-modal__label">Use item slots</span>
                <span class="fb-config-modal__description">Shows slot totals, inventory badges, and speed penalties.</span>
              </span>
              <input id="fb-settings-item-slots-enabled" type="checkbox" />
            </label>
          </section>
          <section class="fb-config-modal__card fb-config-modal__coin-settings">
            <label class="fb-config-modal__toggle" for="fb-settings-coins-have-weight">
              <span class="fb-config-modal__copy">
                <span class="fb-config-modal__label">Coins have weight</span>
                <span class="fb-config-modal__description">Counts carried coins toward slot usage.</span>
              </span>
              <input id="fb-settings-coins-have-weight" type="checkbox" />
            </label>
            <label class="fb-config-modal__field" for="fb-settings-coins-per-slot">
              <span class="fb-config-modal__label">Coins per slot</span>
              <input id="fb-settings-coins-per-slot" type="number" inputmode="numeric" min="1" step="1" />
            </label>
            <p class="fb-config-modal__hint">Set how many total coins equal one slot when coin weight is enabled.</p>
          </section>
          <section class="fb-config-modal__card">
            <label class="fb-config-modal__toggle" for="fb-settings-short-rest-hit-dice-enabled">
              <span class="fb-config-modal__copy">
                <span class="fb-config-modal__label">Custom short rest hit dice</span>
                <span class="fb-config-modal__description">Replaces D&amp;D Beyond's hit-die checkboxes with the Further Beyond persistent version and adds the Use Hit Die action.</span>
              </span>
              <input id="fb-settings-short-rest-hit-dice-enabled" type="checkbox" />
            </label>
          </section>
        </form>
        <p class="fb-config-modal__status" role="status" aria-live="polite"></p>
      </div>
    `;

    modal.addEventListener("click", handleConfigModalClick);
    modal.addEventListener("keydown", handleConfigModalKeydown);
    modal.querySelector(".fb-config-modal__form")?.addEventListener(
      "change",
      handleConfigFormChange
    );

    return modal;
  }

  function ensureConfigModal() {
    let modal = getConfigModal();
    if (!modal) {
      modal = createConfigModal();
      document.body.appendChild(modal);
    }

    syncConfigForm(getExtensionSettings());
    return modal;
  }

  function openConfigModal() {
    const modal = ensureConfigModal();
    const dialog = modal.querySelector(".fb-config-modal__dialog");
    const firstField = modal.querySelector("#fb-settings-item-slots-enabled");

    syncConfigForm(getExtensionSettings());
    setConfigStatus("", "");
    modal.hidden = false;
    document.body.classList.add("fb-config-modal-open");
    document.getElementById(CONFIG_TRIGGER_ID)?.setAttribute("aria-expanded", "true");

    window.requestAnimationFrame(() => {
      if (firstField instanceof HTMLElement) {
        firstField.focus();
        return;
      }

      if (dialog instanceof HTMLElement) {
        dialog.focus();
      }
    });
  }
  function findShortRestUi() {
    const buttons = Array.from(document.querySelectorAll("button")).filter(
      (button) => isElementVisible(button)
    );
    const takeShortRestButton = buttons.find((button) =>
      normalizeText(button.textContent).toUpperCase().includes("TAKE SHORT REST")
    );

    if (!takeShortRestButton) {
      return null;
    }

    const takeShortRestAction = takeShortRestButton.closest(".ct-reset-pane__action");
    const actionsContainer = takeShortRestAction?.parentElement || null;
    const resetButton = actionsContainer
      ? Array.from(actionsContainer.querySelectorAll("button")).find(
          (button) =>
            button !== takeShortRestButton &&
            normalizeText(button.textContent).toUpperCase() === "RESET"
        ) || null
      : null;
    const hitDiePanels = Array.from(
      document.querySelectorAll(".ct-reset-pane__hitdie")
    );

    return {
      takeShortRestButton,
      takeShortRestAction,
      actionsContainer,
      resetButton,
      hitDiePanels,
    };
  }

  function buildShortRestUsageMap(classes, key) {
    return (Array.isArray(classes) ? classes : []).reduce((usage, characterClass) => {
      const classId = String(characterClass?.id || "").trim();
      if (!classId) {
        return usage;
      }

      usage[classId] = parsePositiveInteger(characterClass?.[key] ?? 0, 0);
      return usage;
    }, {});
  }

  function syncShortRestUiState(snapshot, force) {
    const classes = Array.isArray(snapshot?.classes) ? snapshot.classes : [];
    const characterKey = snapshot?.characterKey || "";
    const effectiveUsage = buildShortRestUsageMap(classes, "effectiveUsedHitDice");

    if (
      force ||
      shortRestUiState.characterKey !== characterKey ||
      !shortRestUiState.dirty
    ) {
      shortRestUiState.characterKey = characterKey;
      shortRestUiState.pendingUsage = effectiveUsage;
      shortRestUiState.dirty = false;
      return shortRestUiState.pendingUsage;
    }

    shortRestUiState.characterKey = characterKey;
    shortRestUiState.pendingUsage = classes.reduce((usage, characterClass) => {
      const classId = String(characterClass?.id || "").trim();
      const minimum = parsePositiveInteger(characterClass?.currentUsedHitDice ?? 0, 0);
      const maximum = parsePositiveInteger(characterClass?.totalHitDice ?? minimum, minimum);

      usage[classId] = clamp(
        parsePositiveInteger(shortRestUiState.pendingUsage[classId] ?? minimum, minimum),
        minimum,
        maximum
      );
      return usage;
    }, {});

    return shortRestUiState.pendingUsage;
  }

  function getPendingShortRestUsage() {
    return { ...shortRestUiState.pendingUsage };
  }

  function hasShortRestUsageDifference(leftUsage, rightUsage) {
    const keys = new Set([
      ...Object.keys(leftUsage || {}),
      ...Object.keys(rightUsage || {}),
    ]);

    for (const key of keys) {
      if (
        parsePositiveInteger(leftUsage?.[key] ?? 0, 0) !==
        parsePositiveInteger(rightUsage?.[key] ?? 0, 0)
      ) {
        return true;
      }
    }

    return false;
  }

  function hasPendingShortRestChanges(snapshot) {
    const effectiveUsage = buildShortRestUsageMap(
      snapshot?.classes,
      "effectiveUsedHitDice"
    );

    return hasShortRestUsageDifference(
      effectiveUsage,
      shortRestUiState.pendingUsage
    );
  }

  function countNativeCheckedShortRestSlots(slotManager) {
    if (!slotManager) {
      return 0;
    }

    const checkedInputCount = slotManager.querySelectorAll(
      'input[type="checkbox"]:checked'
    ).length;

    if (checkedInputCount > 0) {
      return checkedInputCount;
    }

    return slotManager.querySelectorAll(
      '[role="checkbox"][aria-checked="true"]'
    ).length;
  }

  function getNativeShortRestUsage(shortRestUi, snapshot) {
    const classes = Array.isArray(snapshot?.classes) ? snapshot.classes : [];

    return shortRestUi.hitDiePanels.reduce((usage, panel, index) => {
      const classId = String(classes[index]?.id || "").trim();
      const nativeSlots = panel.querySelector(
        ".ct-reset-pane__hitdie-manager .ct-slot-manager"
      );

      if (!classId) {
        return usage;
      }

      usage[classId] = countNativeCheckedShortRestSlots(nativeSlots);
      return usage;
    }, {});
  }

  function getShortRestStatusElement() {
    return document.querySelector(`.${SHORT_REST_STATUS_CLASS}`);
  }

  function setShortRestStatus(message, state) {
    const status = getShortRestStatusElement();
    if (!status) {
      return;
    }

    window.clearTimeout(shortRestStatusTimeoutId);
    shortRestStatusTimeoutId = null;
    status.textContent = message || "";
    status.hidden = !message;

    if (state) {
      status.dataset.state = state;
    } else {
      delete status.dataset.state;
    }

    if (message && state !== "error") {
      shortRestStatusTimeoutId = window.setTimeout(() => {
        setShortRestStatus("", "");
      }, 1600);
    }
  }

  function handleTakeShortRestCapture() {
    if (!getExtensionSettings().shortRestHitDiceEnabled) {
      return;
    }

    syncShortRestBridgeState(getPendingShortRestUsage());
    shortRestUiState.dirty = false;
  }

  function cleanupShortRestEnhancements() {
    document
      .querySelectorAll(`.${SHORT_REST_CUSTOM_MANAGER_CLASS}`)
      .forEach((element) => {
        element.remove();
      });

    document
      .querySelectorAll(`[${SHORT_REST_NATIVE_MANAGER_HIDDEN_ATTR}]`)
      .forEach((element) => {
        element.removeAttribute(SHORT_REST_NATIVE_MANAGER_HIDDEN_ATTR);
      });

    document.querySelectorAll(`.${SHORT_REST_ACTION_CLASS}`).forEach((element) => {
      element.remove();
    });

    shortRestUiState.pendingUsage = {};
    shortRestUiState.dirty = false;
  }

  function bindTakeShortRestButton(button) {
    if (!button || button.dataset.fbTakeShortRestBound === "true") {
      return;
    }

    button.addEventListener("click", handleTakeShortRestCapture, true);
    button.dataset.fbTakeShortRestBound = "true";
  }

  function handleShortRestHitDieToggle(event) {
    const checkbox = event.currentTarget;
    const classId = checkbox.dataset.classId || "";
    const slotIndex = parsePositiveInteger(checkbox.dataset.slotIndex ?? 0, 0);
    const currentUsed = parsePositiveInteger(checkbox.dataset.currentUsed ?? 0, 0);
    const totalHitDice = parsePositiveInteger(checkbox.dataset.totalHitDice ?? 0, 0);
    const nextUsedCount = checkbox.checked ? slotIndex + 1 : slotIndex;

    shortRestUiState.pendingUsage = {
      ...shortRestUiState.pendingUsage,
      [classId]: clamp(nextUsedCount, currentUsed, totalHitDice),
    };
    shortRestUiState.dirty = true;
    syncShortRestBridgeState(getPendingShortRestUsage());
    scheduleRefresh();
  }

  function createShortRestCustomManager(characterClass) {
    const manager = document.createElement("div");
    const summary = document.createElement("div");
    const slots = document.createElement("div");
    const classId = String(characterClass?.id || "").trim();
    const totalHitDice = parsePositiveInteger(characterClass?.totalHitDice ?? 0, 0);
    const currentUsed = parsePositiveInteger(
      characterClass?.currentUsedHitDice ?? 0,
      0
    );
    const pendingUsed = clamp(
      parsePositiveInteger(
        shortRestUiState.pendingUsage[classId] ??
          characterClass?.effectiveUsedHitDice ??
          currentUsed,
        currentUsed
      ),
      currentUsed,
      totalHitDice
    );
    const renderSignature = [classId, totalHitDice, currentUsed, pendingUsed].join(":");

    manager.className = SHORT_REST_CUSTOM_MANAGER_CLASS;
    manager.dataset.fbRenderSignature = renderSignature;
    summary.className = `${SHORT_REST_CUSTOM_GROUP_CLASS}__summary`;
    summary.textContent = `${pendingUsed} / ${totalHitDice} used`;

    slots.className = `${SHORT_REST_CUSTOM_GROUP_CLASS}__slots`;

    for (let slotIndex = 0; slotIndex < totalHitDice; slotIndex += 1) {
      const slot = document.createElement("label");
      const input = document.createElement("input");
      const marker = document.createElement("span");

      slot.className = SHORT_REST_CUSTOM_SLOT_CLASS;
      input.className = SHORT_REST_CUSTOM_SLOT_INPUT_CLASS;
      input.type = "checkbox";
      input.checked = slotIndex < pendingUsed;
      input.disabled = slotIndex < currentUsed;
      input.dataset.classId = classId;
      input.dataset.slotIndex = String(slotIndex);
      input.dataset.currentUsed = String(currentUsed);
      input.dataset.totalHitDice = String(totalHitDice);
      input.addEventListener("change", handleShortRestHitDieToggle);

      marker.className = `${SHORT_REST_CUSTOM_SLOT_CLASS}__marker`;

      slot.appendChild(input);
      slot.appendChild(marker);
      slots.appendChild(slot);
    }

    manager.appendChild(summary);
    manager.appendChild(slots);
    return manager;
  }

  function upsertShortRestCustomManagers(shortRestUi, snapshot) {
    const classes = Array.isArray(snapshot?.classes) ? snapshot.classes : [];

    shortRestUi.hitDiePanels.forEach((panel, index) => {
      const nativeManager = panel.querySelector(".ct-reset-pane__hitdie-manager");
      const nativeSlots = nativeManager?.querySelector(".ct-slot-manager");
      const characterClass = classes[index];

      if (!nativeManager || !nativeSlots || !characterClass) {
        return;
      }

      nativeSlots.setAttribute(SHORT_REST_NATIVE_MANAGER_HIDDEN_ATTR, "true");

      const customManager = panel.querySelector(
        `.${SHORT_REST_CUSTOM_MANAGER_CLASS}`
      );
      const nextManager = createShortRestCustomManager(characterClass);
      const nextSignature = nextManager.dataset.fbRenderSignature || "";

      if (customManager?.dataset.fbRenderSignature === nextSignature) {
        if (customManager.previousElementSibling !== nativeSlots) {
          nativeSlots.insertAdjacentElement("afterend", customManager);
        }

        return;
      }

      if (customManager) {
        customManager.replaceWith(nextManager);
      } else {
        nativeSlots.insertAdjacentElement("afterend", nextManager);
      }
    });
  }

  async function handleUseHitDieClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    button.disabled = true;
    setShortRestStatus("Saving hit dice...", "pending");

    try {
      const snapshot = await saveShortRestBridgeState(getPendingShortRestUsage());
      syncShortRestUiState(snapshot, true);
      setShortRestStatus("Hit dice saved.", "ok");
      scheduleRefresh();
    } catch (error) {
      console.error("[Further Beyond] Could not save hit dice.", error);
      setShortRestStatus("Could not save hit dice.", "error");
      button.disabled = false;
    }
  }

  function createUseHitDieAction(templateButton) {
    const action = document.createElement("div");
    const button = document.createElement("button");
    const status = document.createElement("div");
    const normalizedClassName = (templateButton?.className || "")
      .replace(/\bct-button--confirm\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    action.className = `ct-reset-pane__action ${SHORT_REST_ACTION_CLASS}`;

    button.type = "button";
    button.className = normalizedClassName;
    button.classList.add(SHORT_REST_USE_BUTTON_CLASS);
    button.textContent = "Use Hit Die";
    button.title = "Save the selected hit dice without taking a short rest.";
    button.addEventListener("click", handleUseHitDieClick);

    status.className = SHORT_REST_STATUS_CLASS;
    status.hidden = true;

    action.appendChild(button);
    action.appendChild(status);
    return action;
  }

  function updateUseHitDieAction(snapshot) {
    const button = document.querySelector(`.${SHORT_REST_USE_BUTTON_CLASS}`);
    if (!button) {
      return;
    }

    const canUseHitDice = hasPendingShortRestChanges(snapshot);
    button.disabled = !canUseHitDice;
    button.dataset.state = canUseHitDice ? "ready" : "idle";
    button.title = canUseHitDice
      ? "Save the selected hit dice without taking a short rest."
      : "Change the Further Beyond hit-die checkboxes to save a new used total.";
  }

  async function mountShortRestUseHitDieAction() {
    if (!getExtensionSettings().shortRestHitDiceEnabled) {
      cleanupShortRestEnhancements();
      return false;
    }

    const shortRestUi = findShortRestUi();
    if (!shortRestUi?.actionsContainer || !shortRestUi.takeShortRestAction) {
      cleanupShortRestEnhancements();
      return false;
    }

    let snapshot = null;
    try {
      snapshot = await getShortRestBridgeSnapshot();
    } catch (error) {
      snapshot = null;
    }

    if (!snapshot) {
      return false;
    }

    syncShortRestUiState(snapshot, false);
    if (
      hasShortRestUsageDifference(
        getNativeShortRestUsage(shortRestUi, snapshot),
        shortRestUiState.pendingUsage
      )
    ) {
      syncShortRestBridgeState(getPendingShortRestUsage());
    }

    upsertShortRestCustomManagers(shortRestUi, snapshot);
    bindTakeShortRestButton(shortRestUi.takeShortRestButton);

    let action = shortRestUi.actionsContainer.querySelector(
      `.${SHORT_REST_ACTION_CLASS}`
    );
    if (!action) {
      action = createUseHitDieAction(
        shortRestUi.resetButton || shortRestUi.takeShortRestButton
      );
    }

    if (action.previousElementSibling !== shortRestUi.takeShortRestAction) {
      shortRestUi.takeShortRestAction.insertAdjacentElement("afterend", action);
    }

    updateUseHitDieAction(snapshot);
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

  function parsePositiveInteger(value, fallbackValue) {
    const parsedValue = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsedValue) && parsedValue > 0
      ? parsedValue
      : fallbackValue;
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isElementVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function normalizeExtensionSettings(value) {
    return {
      itemSlotsEnabled: value?.itemSlotsEnabled !== false,
      coinsHaveWeight: value?.coinsHaveWeight !== false,
      coinsPerSlot: parsePositiveInteger(
        value?.coinsPerSlot,
        DEFAULT_EXTENSION_SETTINGS.coinsPerSlot
      ),
      shortRestHitDiceEnabled: value?.shortRestHitDiceEnabled !== false,
    };
  }

  function loadExtensionSettings() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.sync?.get) {
        resolve({ ...DEFAULT_EXTENSION_SETTINGS });
        return;
      }

      try {
        chrome.storage.sync.get(EXTENSION_SETTINGS_STORAGE_KEY, (result) => {
          if (chrome.runtime?.lastError) {
            console.warn(
              "[Further Beyond] Could not load extension settings.",
              chrome.runtime.lastError
            );
            resolve({ ...DEFAULT_EXTENSION_SETTINGS });
            return;
          }

          resolve(
            normalizeExtensionSettings(result?.[EXTENSION_SETTINGS_STORAGE_KEY])
          );
        });
      } catch (error) {
        console.warn("[Further Beyond] Could not load extension settings.", error);
        resolve({ ...DEFAULT_EXTENSION_SETTINGS });
      }
    });
  }

  function saveExtensionSettings(settingsInput) {
    const normalizedSettings = normalizeExtensionSettings(settingsInput);

    return new Promise((resolve, reject) => {
      if (!chrome?.storage?.sync?.set) {
        extensionSettingsState.value = normalizedSettings;
        extensionSettingsState.loaded = true;
        resolve(normalizedSettings);
        return;
      }

      try {
        chrome.storage.sync.set(
          {
            [EXTENSION_SETTINGS_STORAGE_KEY]: normalizedSettings,
          },
          () => {
            if (chrome.runtime?.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }

            extensionSettingsState.value = normalizedSettings;
            extensionSettingsState.loaded = true;
            resolve(normalizedSettings);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  function getExtensionSettings() {
    return extensionSettingsState.value;
  }

  function handleExtensionSettingsChange(changes, areaName) {
    if (areaName !== "sync" || !changes[EXTENSION_SETTINGS_STORAGE_KEY]) {
      return;
    }

    extensionSettingsState.value = normalizeExtensionSettings(
      changes[EXTENSION_SETTINGS_STORAGE_KEY].newValue
    );
    extensionSettingsState.loaded = true;
    syncConfigForm(extensionSettingsState.value);
    scheduleRefresh();
  }

  function ensureExtensionSettingsListener() {
    if (
      extensionSettingsState.listenerBound ||
      !chrome?.storage?.onChanged?.addListener
    ) {
      return;
    }

    chrome.storage.onChanged.addListener(handleExtensionSettingsChange);
    extensionSettingsState.listenerBound = true;
  }

  async function ensureExtensionSettingsLoaded() {
    ensureExtensionSettingsListener();

    if (extensionSettingsState.loaded) {
      return extensionSettingsState.value;
    }

    if (extensionSettingsState.loadPromise) {
      return extensionSettingsState.loadPromise;
    }

    extensionSettingsState.loadPromise = loadExtensionSettings()
      .then((settings) => {
        extensionSettingsState.value = settings;
        extensionSettingsState.loaded = true;
        return settings;
      })
      .finally(() => {
        extensionSettingsState.loadPromise = null;
      });

    return extensionSettingsState.loadPromise;
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
      if (anchor.element.dataset.fbOriginalHtml === undefined) {
        anchor.element.dataset.fbOriginalHtml = anchor.element.innerHTML;
      }

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
          detail: {
            requestId,
            settings: getExtensionSettings(),
          },
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

  function handleShortRestBridgeResponse(event) {
    const detail = event.detail || {};
    const pending = pageBridgeState.pendingShortRestRequests.get(detail.requestId);
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    pageBridgeState.pendingShortRestRequests.delete(detail.requestId);

    if (detail.ok) {
      pending.resolve(detail.snapshot || null);
      return;
    }

    pending.reject(new Error(detail.error || "The short rest bridge failed."));
  }

  function ensureShortRestBridgeListener() {
    if (pageBridgeState.shortRestListenerBound) {
      return;
    }

    window.addEventListener(
      SHORT_REST_RESPONSE_EVENT,
      handleShortRestBridgeResponse
    );
    pageBridgeState.shortRestListenerBound = true;
  }

  async function requestShortRestBridge(action, hitDiceUsed) {
    ensureShortRestBridgeListener();
    await ensurePageBridge();

    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timeoutId = window.setTimeout(() => {
        pageBridgeState.pendingShortRestRequests.delete(requestId);
        reject(new Error("The short rest bridge timed out."));
      }, 3000);

      pageBridgeState.pendingShortRestRequests.set(requestId, {
        resolve,
        reject,
        timeoutId,
      });

      window.dispatchEvent(
        new CustomEvent(SHORT_REST_REQUEST_EVENT, {
          detail: {
            requestId,
            action,
            hitDiceUsed,
          },
        })
      );
    });
  }

  async function getShortRestBridgeSnapshot() {
    if (pageBridgeState.activeShortRestPromise) {
      return pageBridgeState.activeShortRestPromise;
    }

    pageBridgeState.activeShortRestPromise = requestShortRestBridge(
      "get-state"
    ).finally(() => {
      pageBridgeState.activeShortRestPromise = null;
    });

    return pageBridgeState.activeShortRestPromise;
  }

  async function saveShortRestBridgeState(hitDiceUsed) {
    pageBridgeState.activeShortRestPromise = null;
    return requestShortRestBridge("save-hit-dice", hitDiceUsed);
  }

  function syncShortRestBridgeState(hitDiceUsed) {
    const requestId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    window.dispatchEvent(
      new CustomEvent(SHORT_REST_REQUEST_EVENT, {
        detail: {
          requestId,
          action: "sync-hit-dice",
          hitDiceUsed,
        },
      })
    );
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

  function formatCoinSlotTooltip(coinSlots, totalCoins, coinsPerSlot) {
    if (!Number.isFinite(coinSlots)) {
      return "";
    }

    const normalizedCoinsPerSlot = parsePositiveInteger(
      coinsPerSlot,
      DEFAULT_EXTENSION_SETTINGS.coinsPerSlot
    );

    if (Number.isFinite(totalCoins)) {
      return `Coins are occupying ${coinSlots} ${coinSlots === 1 ? "slot" : "slots"}. ${totalCoins.toLocaleString()} total coins / ${normalizedCoinsPerSlot.toLocaleString()} = ${coinSlots}.`;
    }

    return `Coins are occupying ${coinSlots} ${coinSlots === 1 ? "slot" : "slots"} at ${normalizedCoinsPerSlot.toLocaleString()} coins per slot.`;
  }

  function updateSlotOverviewButton(
    overview,
    usedSlots,
    capacity,
    totalCoins,
    coinSlots,
    overBy,
    speedPenaltyState,
    coinsPerSlot
  ) {
    const button = overview.querySelector(".styles_overviewPrimaryButton__j84A5, button");
    if (!button) return;

    if (button.dataset.fbOriginalHtml === undefined) {
      button.dataset.fbOriginalHtml = button.innerHTML;
      button.dataset.fbOriginalTitle = button.title || "";
    }

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
    const coinSlotTooltip = formatCoinSlotTooltip(
      coinSlots,
      totalCoins,
      coinsPerSlot
    );

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

  function clearSlotOverviewButton(button) {
    button.classList.remove("fb-slot-overview-button");
    button.removeAttribute("data-fb-slot-state");
    button.style.removeProperty("--fb-slot-button-border");
    button.style.removeProperty("--fb-slot-button-bg-top");
    button.style.removeProperty("--fb-slot-button-bg-bottom");
    button.style.removeProperty("--fb-slot-button-value");

    if (button.dataset.fbOriginalHtml !== undefined) {
      button.innerHTML = button.dataset.fbOriginalHtml;
      delete button.dataset.fbOriginalHtml;
    } else {
      button.querySelector(".fb-slot-overview")?.remove();
    }

    if (button.dataset.fbOriginalTitle) {
      button.title = button.dataset.fbOriginalTitle;
    } else {
      button.removeAttribute("title");
    }

    delete button.dataset.fbOriginalTitle;
  }

  function clearInventorySlotUi() {
    resetSpeedPenalty();

    document
      .querySelectorAll(
        ".ct-equipment__overview .fb-slot-overview-button, .ct-equipment__overview .styles_overviewPrimaryButton__j84A5[data-fb-original-html]"
      )
      .forEach((button) => {
        clearSlotOverviewButton(button);
      });

    document
      .querySelectorAll(".ct-equipment [data-fb-original-html]")
      .forEach((element) => {
        if (element.closest(".ct-equipment__overview")) {
          return;
        }

        element.innerHTML = element.dataset.fbOriginalHtml;
        delete element.dataset.fbOriginalHtml;
      });

    document.querySelectorAll(`.${CONTAINER_BADGE_CLASS}`).forEach((badge) => {
      badge.remove();
    });

    document.querySelectorAll(`.${ITEM_IGNORE_TOGGLE_CLASS}`).forEach((toggle) => {
      toggle.remove();
    });

    document.querySelectorAll("[data-fb-weight-ignored]").forEach((row) => {
      row.removeAttribute("data-fb-weight-ignored");
    });
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

    const settings = getExtensionSettings();
    if (!settings.itemSlotsEnabled) {
      resetInventorySnapshot(characterKey);
      clearInventorySlotUi();
      return false;
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
      speedPenaltyState,
      settings.coinsPerSlot
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
    await ensureExtensionSettingsLoaded();
    mountConfigTrigger();
    await mountShortRestUseHitDieAction();
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
      if (pageBridgeState.shortRestListenerBound) {
        window.removeEventListener(
          SHORT_REST_RESPONSE_EVENT,
          handleShortRestBridgeResponse
        );
      }
      if (
        extensionSettingsState.listenerBound &&
        chrome?.storage?.onChanged?.removeListener
      ) {
        chrome.storage.onChanged.removeListener(handleExtensionSettingsChange);
      }
      window.clearTimeout(settingsStatusTimeoutId);
      window.clearTimeout(shortRestStatusTimeoutId);
    },
    { once: true }
  );
})();
