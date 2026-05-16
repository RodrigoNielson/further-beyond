/* =============================================
   Further Beyond – Content Script
   Adds an active indicator and slot-based inventory tracking
   ============================================= */

(function () {
  "use strict";

  if (!window.location.pathname.startsWith("/characters/")) return;
  if (window.__fbContentScriptInstalled) return;

  window.__fbContentScriptInstalled = true;

  const INDICATOR_ID = "fb-active-indicator";
  const CONTAINER_BADGE_CLASS = "fb-container-slot-badge";
  const ITEM_IGNORE_TOGGLE_CLASS = "fb-item-ignore-toggle";
  const SPEED_PENALTY_ID = "fb-speed-penalty";
  const SPEED_WARNING_ID = "fb-speed-warning";
  const CONFIG_TRIGGER_ID = "fb-config-trigger";
  const CONFIG_MODAL_ID = "fb-config-modal";
  const DICE_CONFIG_TRIGGER_ID = "fb-dice-config-trigger";
  const DICE_CONFIG_MODAL_ID = "fb-dice-config-modal";
  const DICE_DRAWER_ID = "fb-dice-drawer";
  const DICE_NATIVE_PANEL_ID = "fb-dice-native-panel";
  const DICE_ROLLER_PANEL_ID = "fb-dice-roller-panel";
  const DICE_SCREEN_TRAY_ID = "fb-dice-screen-tray";
  const DICE_NOTIFICATION_STACK_ID = "fb-dice-notification-stack";
  const DICE_DRAWER_DOCK_CLASS = "fb-dice-dock";
  const DICE_SIDEBAR_LAYOUT_BODY_CLASS = "fb-dice-sidebar-layout";
  const DICE_SIDEBAR_ACTION_CLASS = "fb-dice-sidebar-action";
  const DICE_ROLL_HISTORY_LIMIT = 24;
  const DICE_VISUALIZER_AUTO_CLEAR_SECONDS = 2;
  const DICE_NOTIFICATION_DURATION_MS = 1600;
  const DICE_NOTIFICATION_FADE_MS = 220;
  const PAGE_BRIDGE_SCRIPT_ID = "fb-page-bridge";
  const INVENTORY_REQUEST_EVENT = "fb:inventory-request";
  const INVENTORY_RESPONSE_EVENT = "fb:inventory-response";
  const INTEGRATED_DICE_REQUEST_EVENT = "fb:integrated-dice-request";
  const INTEGRATED_DICE_RESPONSE_EVENT = "fb:integrated-dice-response";
  const SHORT_REST_REQUEST_EVENT = "fb:short-rest-request";
  const SHORT_REST_RESPONSE_EVENT = "fb:short-rest-response";
  const IGNORE_WEIGHT_STORAGE_KEY_PREFIX = "fb:ignored-weight:";
  const EXTENSION_SETTINGS_STORAGE_KEY = "fb:settings";
  const DICE_LOCAL_STATE_STORAGE_KEY = "fb:dice:local-state";
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
    diceEnabled: false,
    diceSuppressNativeDice: true,
  });
  const HEADING_SELECTORS = [
    "main .ddbc-character-tidbits__heading h1",
    "main h1.styles_characterName__2x8wQ",
    "main h1",
  ];
  const DICE_SKILL_NAMES = [
    "Acrobatics",
    "Animal Handling",
    "Arcana",
    "Athletics",
    "Deception",
    "History",
    "Insight",
    "Intimidation",
    "Investigation",
    "Medicine",
    "Nature",
    "Perception",
    "Performance",
    "Persuasion",
    "Religion",
    "Sleight of Hand",
    "Stealth",
    "Survival",
  ];
  const DICE_ABILITY_NAMES = [
    "Strength",
    "Dexterity",
    "Constitution",
    "Intelligence",
    "Wisdom",
    "Charisma",
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
    integratedDiceListenerBound: false,
    pendingIntegratedDiceRequests: new Map(),
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
  const diceUiState = {
    loaded: false,
    loadPromise: null,
    expanded: false,
    rollPending: false,
    connectionState: "idle",
    activeRoomSlug: "",
    activeRoomName: "",
    authKind: "guest",
    authToken: "",
    userName: "",
    userId: "",
    themeId: "",
    availableThemes: [],
    themeOptionsLoading: false,
    accountActivationCode: "",
    accountActivationExpiresAt: "",
    accountActivationPending: false,
    statusMessage: "",
    rollHistory: [],
  };
  const diceRuntimeState = {
    engine: null,
    engineToken: "",
    connectedRoomSlug: "",
    syncPending: false,
    visualizer: null,
    visualizerToken: "",
    visualizerThemeId: "",
    visualizerError: "",
    visualizerWarmupTimerId: null,
    visualizerWarmupActive: false,
    themeOptionsPromise: null,
    accountActivationSecret: "",
    accountActivationPollTimeoutId: null,
  };

  let refreshPending = false;
  let diceDrawerPlacementPending = false;
  let diceScreenTrayTimeoutId = null;
  const diceNotificationTimers = new WeakMap();
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

  function handleDiceConfigTriggerClick(event) {
    event.preventDefault();
    event.stopPropagation();
    openDiceConfigModal();
  }

  function createHeaderTrigger(manageButton, options) {
    const tagName = manageButton?.tagName?.toLowerCase() === "a" ? "a" : "button";
    const trigger = document.createElement(tagName);
    const content = document.createElement("span");
    const label = document.createElement("span");

    trigger.id = options.id;
    trigger.className = manageButton?.className || "";
    trigger.dataset.fbConfigTrigger = "true";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", options.modalId);
    trigger.setAttribute("aria-expanded", "false");
    trigger.title = options.title;
    trigger.setAttribute("aria-label", options.ariaLabel || options.title);

    if (tagName === "button") {
      trigger.type = "button";
    } else {
      trigger.href = "#";
      trigger.setAttribute("role", "button");
    }

    content.className = "fb-config-trigger__content";

    label.className = "fb-config-trigger__label";
    label.textContent = options.label;

    content.appendChild(label);
    trigger.replaceChildren(content);
    trigger.addEventListener("click", options.onClick);

    return trigger;
  }

  function createConfigTrigger(manageButton) {
    return createHeaderTrigger(manageButton, {
      id: CONFIG_TRIGGER_ID,
      modalId: CONFIG_MODAL_ID,
      title: "Open Further Beyond settings",
      ariaLabel: "Open Further Beyond settings",
      label: "Further Beyond",
      onClick: handleConfigTriggerClick,
    });
  }

  function createDiceConfigTrigger(manageButton) {
    return createHeaderTrigger(manageButton, {
      id: DICE_CONFIG_TRIGGER_ID,
      modalId: DICE_CONFIG_MODAL_ID,
      title: "Open Further Dice Roller settings",
      ariaLabel: "Open Further Dice Roller settings",
      label: "Dice",
      onClick: handleDiceConfigTriggerClick,
    });
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

    let diceTrigger = document.getElementById(DICE_CONFIG_TRIGGER_ID);
    if (!diceTrigger) {
      diceTrigger = createDiceConfigTrigger(manageButton);
    }

    if (trigger.previousElementSibling !== manageButton) {
      manageButton.insertAdjacentElement("afterend", trigger);
    }

    if (diceTrigger.previousElementSibling !== trigger) {
      trigger.insertAdjacentElement("afterend", diceTrigger);
    }

    return true;
  }

  function getConfigModal() {
    return document.getElementById(CONFIG_MODAL_ID);
  }

  function getDiceConfigTrigger() {
    return document.getElementById(DICE_CONFIG_TRIGGER_ID);
  }

  function getDiceConfigModal() {
    return document.getElementById(DICE_CONFIG_MODAL_ID);
  }

  function getDiceDrawer() {
    return getDiceRollerPanel() || document.getElementById(DICE_DRAWER_ID);
  }

  function getDiceNativePanel() {
    return document.getElementById(DICE_NATIVE_PANEL_ID);
  }

  function getDiceRollerPanel() {
    return document.getElementById(DICE_ROLLER_PANEL_ID);
  }

  function getDiceScreenTray() {
    return document.getElementById(DICE_SCREEN_TRAY_ID);
  }

  function getDiceNotificationStack() {
    return document.getElementById(DICE_NOTIFICATION_STACK_ID);
  }

  function getDiceConfigPanel() {
    const panel = getDiceConfigModal()?.querySelector('[data-fb-dice-role="config-panel"]');
    return panel instanceof HTMLElement ? panel : null;
  }

  function getDiceDiceButton() {
    return (
      Array.from(
        document.querySelectorAll('.dice-rolling-panel button[class*="DiceContainer_button__"]')
      ).find((element) => element instanceof HTMLButtonElement && isElementVisible(element)) ||
      null
    );
  }

  function getDiceDrawerDock() {
    return document.querySelector(`.${DICE_DRAWER_DOCK_CLASS}`);
  }

  function unwrapDiceDrawerDock(dock) {
    if (!(dock instanceof HTMLElement) || !(dock.parentElement instanceof HTMLElement)) {
      return;
    }

    const parent = dock.parentElement;
    while (dock.firstChild) {
      parent.insertBefore(dock.firstChild, dock);
    }
    dock.remove();
  }

  function resetDiceSidebarLayout() {
    document.body.classList.remove(DICE_SIDEBAR_LAYOUT_BODY_CLASS);
    document.body.style.removeProperty("--fb-dice-sidebar-reserve");
  }

  function getDiceVisualizerHost(preferredHost) {
    if (preferredHost instanceof HTMLElement) {
      return preferredHost;
    }

    return getDiceScreenTray() || getDiceRollerPanel() || getDiceDrawer();
  }

  function getDiceCanvas(host = getDiceVisualizerHost()) {
    return host?.querySelector('[data-fb-dice-role="canvas"]') || null;
  }

  function getDiceGameLogButton() {
    return Array.from(document.querySelectorAll('[aria-roledescription="Game Log"]')).find(
      (element) => element instanceof HTMLElement
    ) || null;
  }

  function getDiceGameLogPane() {
    const pane = document.querySelector('[data-testid="gamelog-pane"]');
    return pane instanceof HTMLElement ? pane : null;
  }

  function isDiceGameLogOpen() {
    const pane = getDiceGameLogPane();
    return pane instanceof HTMLElement && isElementVisible(pane);
  }

  function getDiceNativeSidebar() {
    const sidebar = document.querySelector('.ct-sidebar__inner');
    return sidebar instanceof HTMLElement ? sidebar : null;
  }

  function getDiceScreenTrayBoundsTarget() {
    const selectors = [
      ".ct-character-sheet",
      ".ct-character-sheet__inner",
      ".ct-character-sheet-desktop",
      "main",
    ];

    return selectors
      .map((selector) => document.querySelector(selector))
      .find((element) => element instanceof HTMLElement && isElementVisible(element)) || null;
  }

  function waitForNextAnimationFrame() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  function getDiceSdk() {
    const sdk = globalThis.__fbFurtherDiceSdk;

    if (
      !sdk ||
      typeof sdk.DiceRoll !== "function"
    ) {
      return null;
    }

    return sdk;
  }

  function normalizeDiceRoomSlug(value) {
    const rawValue = String(value || "").trim();
    if (!rawValue) {
      return "";
    }

    try {
      const parsedUrl = new URL(rawValue);
      const segments = parsedUrl.pathname.split("/").filter(Boolean);
      return String(segments[segments.length - 1] || rawValue).trim();
    } catch (_error) {
      return rawValue.replace(/^\/+|\/+$/g, "");
    }
  }

  function normalizeDiceRollHistoryEntry(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const values = Array.isArray(value.values)
      ? value.values
        .map((rollValue) => {
          if (!rollValue || typeof rollValue !== "object") {
            return null;
          }

          return {
            type: String(rollValue.type || "die").trim() || "die",
            display: String(rollValue.display || rollValue.value || "?").trim() || "?",
          };
        })
        .filter(Boolean)
      : [];

    const timestamp = Number.parseInt(value.timestamp, 10);

    return {
      id: String(value.id || `roll-${Date.now()}`).trim(),
      label: String(value.label || value.equation || "Further Dice Roll").trim(),
      equation: String(value.equation || "").trim(),
      total: String(value.total || "").trim(),
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
      values,
    };
  }

  function buildDiceRollHistoryEntry(roll) {
    if (!roll || typeof roll !== "object") {
      return null;
    }

    const values = Array.isArray(roll.values)
      ? roll.values
        .filter((value) => !value?.is_dropped && !value?.is_cleared)
        .map((value) => ({
          type: String(value?.type || "die").trim() || "die",
          display: formatDiceRollValueDisplay(value),
        }))
      : [];

    return normalizeDiceRollHistoryEntry({
      id: String(roll.uuid || roll.id || `roll-${Date.now()}`),
      label: String(roll.label || roll.equation || "Further Dice Roll").trim(),
      equation: String(roll.equation || "").trim(),
      total: formatDiceRollTotalValue(roll.total_value),
      timestamp: Date.now(),
      values,
    });
  }

  function getDiceConnectionState(rollPending = diceUiState.rollPending) {
    return rollPending ? "connecting" : "ready";
  }

  function normalizeDiceLocalState(value) {
    const rollHistory = Array.isArray(value?.rollHistory)
      ? value.rollHistory
        .map(normalizeDiceRollHistoryEntry)
        .filter(Boolean)
        .slice(0, DICE_ROLL_HISTORY_LIMIT)
      : [];

    return {
      expanded: value?.expanded === true,
      rollHistory,
    };
  }

  function loadDiceLocalState() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local?.get) {
        resolve(normalizeDiceLocalState(null));
        return;
      }

      try {
        chrome.storage.local.get(DICE_LOCAL_STATE_STORAGE_KEY, (result) => {
          if (chrome.runtime?.lastError) {
            console.warn(
              "[Further Beyond] Could not load Further Dice Roller local state.",
              chrome.runtime.lastError
            );
            resolve(normalizeDiceLocalState(null));
            return;
          }

          resolve(
            normalizeDiceLocalState(result?.[DICE_LOCAL_STATE_STORAGE_KEY])
          );
        });
      } catch (error) {
        console.warn("[Further Beyond] Could not load Further Dice Roller local state.", error);
        resolve(normalizeDiceLocalState(null));
      }
    });
  }

  function saveDiceLocalState() {
    const localState = normalizeDiceLocalState({
      expanded: diceUiState.expanded,
      rollHistory: diceUiState.rollHistory,
    });

    return new Promise((resolve) => {
      if (!chrome?.storage?.local?.set) {
        resolve(localState);
        return;
      }

      try {
        chrome.storage.local.set(
          {
            [DICE_LOCAL_STATE_STORAGE_KEY]: localState,
          },
          () => {
            if (chrome.runtime?.lastError) {
              console.warn(
                "[Further Beyond] Could not save Further Dice Roller local state.",
                chrome.runtime.lastError
              );
            }

            resolve(localState);
          }
        );
      } catch (error) {
        console.warn("[Further Beyond] Could not save Further Dice Roller local state.", error);
        resolve(localState);
      }
    });
  }

  async function ensureDiceLocalStateLoaded() {
    if (diceUiState.loaded) {
      return diceUiState;
    }

    if (diceUiState.loadPromise) {
      return diceUiState.loadPromise;
    }

    diceUiState.loadPromise = loadDiceLocalState()
      .then((localState) => {
        diceUiState.expanded = localState.expanded;
        diceUiState.rollHistory = localState.rollHistory;
        diceUiState.connectionState = getDiceConnectionState();
        diceUiState.loaded = true;
        return diceUiState;
      })
      .finally(() => {
        diceUiState.loadPromise = null;
      });

    return diceUiState.loadPromise;
  }

  function getDiceStateLabel() {
    if (diceUiState.connectionState === "connecting") {
      return "Rolling";
    }

    if (diceUiState.connectionState === "error") {
      return "Attention";
    }

    return "Ready";
  }

  function getDiceStatusMessage() {
    if (diceUiState.statusMessage) {
      return diceUiState.statusMessage;
    }

    if (diceUiState.connectionState === "connecting") {
      return "Rolling with Further Dice Roller...";
    }

    if (diceUiState.connectionState === "error") {
      return "Further Dice Roller needs attention before it can roll.";
    }

    if (!getDiceSdk()) {
      return "Local Further Dice Roller bundle is unavailable.";
    }

    return "Further Dice Roller is ready. Use D&D Beyond's dice button or enter a simple roll.";
  }

  function findDiceInfoSidebar() {
    return Array.from(document.querySelectorAll('[role="dialog"]')).find(
      (dialog) => dialog.id !== CONFIG_MODAL_ID && !dialog.closest(`#${CONFIG_MODAL_ID}`)
    );
  }

  function parseDiceSidebarModifier(text) {
    const normalizedText = normalizeText(text)
      .toLowerCase()
      .replace(/\bplus\b/g, "+")
      .replace(/\bminus\b/g, "-");
    const match = /([+-])\s*(\d+)/.exec(normalizedText);

    if (!match) {
      return null;
    }

    const value = Number.parseInt(match[2], 10);
    if (!Number.isFinite(value)) {
      return null;
    }

    return match[1] === "-" ? -value : value;
  }

  function formatDiceSidebarExpression(modifier) {
    if (!Number.isFinite(modifier)) {
      return "";
    }

    return modifier >= 0 ? `d20 + ${modifier}` : `d20 - ${Math.abs(modifier)}`;
  }

  function buildDiceSidebarRollDefinition(dialog) {
    if (!(dialog instanceof HTMLElement)) {
      return null;
    }

    const heading = dialog.querySelector("h1, h2");
    const headingText = normalizeText(heading?.textContent || "");
    const headingLower = headingText.toLowerCase();
    const modifier = parseDiceSidebarModifier(headingText);

    if (!headingText || !Number.isFinite(modifier)) {
      return null;
    }

    const skillName = DICE_SKILL_NAMES.find((name) =>
      headingLower.includes(name.toLowerCase())
    );
    if (skillName) {
      return {
        label: skillName,
        expression: formatDiceSidebarExpression(modifier),
      };
    }

    if (headingLower.includes("initiative")) {
      return {
        label: "Initiative",
        expression: formatDiceSidebarExpression(modifier),
      };
    }

    const abilityName = DICE_ABILITY_NAMES.find(
      (name) =>
        headingLower.includes(name.toLowerCase()) && headingLower.includes("saving")
    );
    if (abilityName) {
      return {
        label: `${abilityName} Save`,
        expression: formatDiceSidebarExpression(modifier),
      };
    }

    const abilityCheckName = DICE_ABILITY_NAMES.find((name) =>
      headingLower.includes(name.toLowerCase())
    );
    if (abilityCheckName) {
      return {
        label: `${abilityCheckName} Check`,
        expression: formatDiceSidebarExpression(modifier),
      };
    }

    return null;
  }

  function canUseDiceNativeRolls() {
    return (
      getExtensionSettings().diceEnabled &&
      diceUiState.loaded &&
      diceUiState.connectionState !== "connecting" &&
      !!getDiceSdk()
    );
  }

  function shouldSuppressDiceNativeDice() {
    return !!getExtensionSettings().diceSuppressNativeDice;
  }

  function getDiceNativeDiceButton(target) {
    if (!(target instanceof Element) || !canUseDiceNativeRolls()) {
      return null;
    }

    const customRollButton = target.closest(
      '.dice-rolling-panel button[class*="DiceContainer_button__"]'
    );
    if (customRollButton instanceof HTMLButtonElement) {
      return customRollButton;
    }

    const integratedDiceButton = target.closest("button.integrated-dice__container");
    return integratedDiceButton instanceof HTMLButtonElement ? integratedDiceButton : null;
  }

  function stopDiceNativeDiceEvent(event, preventDefault = true) {
    if (preventDefault) {
      event.preventDefault();
    }

    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  function resetDiceNativeButtonFocus(button = document.activeElement) {
    if (!(button instanceof HTMLElement)) {
      return;
    }

    if (
      button.closest("button.integrated-dice__container") ||
      button.closest('.dice-rolling-panel button[class*="DiceContainer_button__"]')
    ) {
      button.blur();
    }
  }

  function trimDiceAttackLabel(value) {
    const normalizedValue = normalizeText(value || "")
      .replace(/\*+$/g, "")
      .trim();

    if (!normalizedValue) {
      return "";
    }

    const suffixMatch = normalizedValue.match(
      /^(.*?)(?=(?:\bMelee Weapon\b|\bRanged Weapon\b|\bMelee Attack\b|\bRanged Attack\b|\bCustomized\b|\bMastery\b|\bAmmunition\b|\bReach\b|\bRange\b|\bHit\b|\bUse\b|\d+\s*ft\.?\b|$))/i
    );
    return normalizeText(suffixMatch?.[1] || normalizedValue)
      .replace(/\*+$/g, "")
      .trim();
  }

  function getDiceCombatAttackLabel(attackRow) {
    if (!(attackRow instanceof HTMLElement)) {
      return "";
    }

    const nameElement = attackRow.querySelector(".ddbc-combat-attack__name");
    if (!(nameElement instanceof HTMLElement)) {
      return "";
    }

    const directText = trimDiceAttackLabel(
      Array.from(nameElement.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
    );
    if (directText) {
      return directText;
    }

    const firstMeaningfulChildText = Array.from(nameElement.children)
      .map((child) => trimDiceAttackLabel(child.textContent || ""))
      .find(Boolean);
    if (firstMeaningfulChildText) {
      return firstMeaningfulChildText;
    }

    return trimDiceAttackLabel(nameElement.textContent || "");
  }

  function findDiceNativeSidebar() {
    const sidebars = Array.from(document.querySelectorAll(".ct-sidebar"));

    return sidebars.find((sidebar) => {
      if (!(sidebar instanceof HTMLElement)) {
        return false;
      }

      const rect = sidebar.getBoundingClientRect();
      const style = window.getComputedStyle(sidebar);
      return (
        rect.width >= 280 &&
        rect.height >= 320 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    }) || null;
  }

  function syncDiceDrawerPlacement(drawer) {
    if (!(drawer instanceof HTMLElement)) {
      return;
    }

    if (drawer.classList.contains("fb-dice-drawer--embedded")) {
      drawer.dataset.layout = "embedded";
      drawer.style.removeProperty("--fb-dice-sidebar-left");
      drawer.style.removeProperty("--fb-dice-sidebar-top");
      drawer.style.removeProperty("--fb-dice-sidebar-width");
      drawer.style.removeProperty("--fb-dice-sidebar-height");
      return;
    }

    if (drawer.classList.contains("fb-dice-drawer--roller")) {
      const diceButton = getDiceDiceButton();
      const buttonRect = diceButton?.getBoundingClientRect();
      const gap = 12;

      drawer.dataset.layout = "roller";
      if (!buttonRect) {
        return;
      }

      drawer.style.setProperty("--fb-dice-roller-left", `${Math.max(10, Math.round(buttonRect.left))}px`);
      drawer.style.setProperty(
        "--fb-dice-roller-bottom",
        `${Math.max(72, Math.round(window.innerHeight - buttonRect.top + gap))}px`
      );
      return;
    }

    const dock = getDiceDrawerDock();
    if (dock instanceof HTMLElement) {
      unwrapDiceDrawerDock(dock);
    }

    if (drawer.parentElement !== document.body) {
      document.body.appendChild(drawer);
    }

    const sidebar = findDiceNativeSidebar();
    const sidebarRect = sidebar?.getBoundingClientRect();
    const minimumViewportWidth = 1280;

    if (
      !(sidebar instanceof HTMLElement) ||
      !sidebarRect ||
      window.innerWidth < minimumViewportWidth
    ) {
      drawer.dataset.layout = "floating";
      drawer.style.removeProperty("--fb-dice-sidebar-left");
      drawer.style.removeProperty("--fb-dice-sidebar-top");
      drawer.style.removeProperty("--fb-dice-sidebar-width");
      drawer.style.removeProperty("--fb-dice-sidebar-height");
      resetDiceSidebarLayout();
      return;
    }

    const gap = 16;
    const panelWidth = Math.max(320, Math.min(360, Math.round(sidebarRect.width)));
    const panelLeft = Math.round(sidebarRect.left + window.scrollX - panelWidth - gap);
    const panelTop = Math.round(sidebarRect.top + window.scrollY);
    const panelHeight = Math.max(420, Math.round(sidebar.offsetHeight || sidebarRect.height));
    const sheetInner = document.querySelector(".ct-character-sheet__inner");
    const sheetInnerRect =
      sheetInner instanceof HTMLElement ? sheetInner.getBoundingClientRect() : null;

    if (panelLeft < 24) {
      drawer.dataset.layout = "floating";
      drawer.style.removeProperty("--fb-dice-sidebar-left");
      drawer.style.removeProperty("--fb-dice-sidebar-top");
      drawer.style.removeProperty("--fb-dice-sidebar-width");
      drawer.style.removeProperty("--fb-dice-sidebar-height");
      resetDiceSidebarLayout();
      return;
    }

    drawer.dataset.layout = "sidebar";
    drawer.style.setProperty("--fb-dice-sidebar-left", `${panelLeft}px`);
    drawer.style.setProperty("--fb-dice-sidebar-top", `${panelTop}px`);
    drawer.style.setProperty("--fb-dice-sidebar-width", `${panelWidth}px`);
    drawer.style.setProperty("--fb-dice-sidebar-height", `${panelHeight}px`);

    const reserveWidth = sheetInnerRect
      ? Math.max(
        panelWidth + gap,
        Math.ceil(sheetInnerRect.right - (panelLeft - window.scrollX) + 24)
      )
      : panelWidth + gap;

    document.body.classList.add(DICE_SIDEBAR_LAYOUT_BODY_CLASS);
    document.body.style.setProperty(
      "--fb-dice-sidebar-reserve",
      `${reserveWidth}px`
    );
  }

  function scheduleDiceDrawerPlacement() {
    if (diceDrawerPlacementPending) {
      return;
    }

    diceDrawerPlacementPending = true;
    window.requestAnimationFrame(() => {
      diceDrawerPlacementPending = false;
      syncDiceDrawerPlacement(getDiceRollerPanel() || getDiceDrawer());
      syncDiceScreenTray();
    });
  }

  function getDiceIntegratedDiceContext(button) {
    if (!(button instanceof HTMLButtonElement)) {
      return null;
    }

    const attackRow = button.closest(".ddbc-combat-attack");
    if (attackRow instanceof HTMLElement) {
      const attackName = getDiceCombatAttackLabel(attackRow);
      const labelBase = attackName || "Attack";
      const actionCell = button.closest(
        ".ddbc-combat-attack__action, .ddbc-combat-attack__damage, .ddbc-combat-item-attack__damage"
      );

      if (actionCell?.classList.contains("ddbc-combat-attack__action")) {
        return {
          kind: "modifier",
          label: `${labelBase} To Hit`,
        };
      }

      if (
        actionCell?.classList.contains("ddbc-combat-attack__damage") ||
        actionCell?.classList.contains("ddbc-combat-item-attack__damage")
      ) {
        return {
          kind: "damage",
          labelBase,
        };
      }
    }

    const abilityCard = button.closest(".ddbc-ability-summary");
    if (abilityCard instanceof HTMLElement) {
      const abilityName = normalizeText(
        abilityCard.querySelector(".ddbc-ability-summary__label")?.textContent || ""
      );
      if (abilityName) {
        return {
          kind: "modifier",
          label: `${abilityName} Check`,
        };
      }
    }

    const savingThrowCard = button.closest(".ddbc-saving-throws-summary__ability");
    if (savingThrowCard instanceof HTMLElement) {
      const saveName = normalizeText(
        savingThrowCard.querySelector("h3")?.textContent || ""
      ).replace(/Saving Throw/i, "Save");
      if (saveName) {
        return {
          kind: "modifier",
          label: saveName,
        };
      }
    }

    const skillRow = button.closest(".ct-skills__item");
    if (skillRow instanceof HTMLElement) {
      const skillName = normalizeText(
        skillRow.querySelector(".ct-skills__col--skill")?.textContent || ""
      );
      if (skillName) {
        return {
          kind: "modifier",
          label: skillName,
        };
      }
    }

    const initiativeCard = button.closest(
      ".ct-combat-tablet__extra--initiative, .styles_box__PLQui"
    );
    if (initiativeCard instanceof HTMLElement) {
      const initiativeLabel = normalizeText(
        initiativeCard.querySelector(".styles_label__6xv1b, h2")?.textContent ||
        initiativeCard.textContent ||
        ""
      );
      if (/initiative/i.test(initiativeLabel)) {
        return {
          kind: "modifier",
          label: "Initiative",
        };
      }
    }

    return null;
  }

  function formatDiceActionEffectLabel(labelBase, damageType) {
    const normalizedLabelBase = normalizeText(labelBase || "") || "Attack";
    const normalizedDamageType = normalizeText(damageType || "");

    if (!normalizedDamageType) {
      return normalizedLabelBase;
    }

    if (/healing/i.test(normalizedDamageType)) {
      return `${normalizedLabelBase} Healing`;
    }

    if (/damage/i.test(normalizedDamageType)) {
      return `${normalizedLabelBase} ${normalizedDamageType}`;
    }

    return `${normalizedLabelBase} ${normalizedDamageType} Damage`;
  }

  function buildDiceIntegratedDiceRollDefinition(button, metadata) {
    const context = getDiceIntegratedDiceContext(button);
    if (!context || !metadata) {
      return null;
    }

    if (context.kind === "modifier" && Number.isFinite(metadata.modifier)) {
      return {
        label: context.label,
        expression: formatDiceSidebarExpression(metadata.modifier),
      };
    }

    if (
      context.kind === "damage" &&
      typeof metadata.expression === "string" &&
      metadata.expression.trim()
    ) {
      return {
        label: formatDiceActionEffectLabel(
          context.labelBase,
          metadata.damageType
        ),
        expression: metadata.expression.trim(),
      };
    }

    return null;
  }

  function getDiceCanvasStatusMessage(hasSdk, hasSession, hasRoom) {
    if (diceRuntimeState.visualizerError) {
      return diceRuntimeState.visualizerError;
    }

    if (!hasSdk) {
      return "Local Further Dice Roller bundle is unavailable.";
    }

    return "Simple rolls are ready. Results appear in the Game Log below.";
  }

  function formatDiceRollTotalValue(totalValue) {
    if (Array.isArray(totalValue)) {
      return totalValue
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }

          if (entry && typeof entry === "object" && typeof entry.src === "string") {
            return "";
          }

          return String(entry || "");
        })
        .join(" ")
        .trim();
    }

    return String(totalValue || "").trim();
  }

  function formatDiceRollValueDisplay(rollValue) {
    if (!rollValue || typeof rollValue !== "object") {
      return "?";
    }

    const displayValue = rollValue.value_to_display;
    const fallbackValue = Number.isFinite(rollValue.value)
      ? String(rollValue.value)
      : "";
    const rawText =
      typeof displayValue === "string" || typeof displayValue === "number"
        ? String(displayValue).trim()
        : fallbackValue;

    if (rollValue.type === "mod") {
      if (rawText && /^[+-]/.test(rawText)) {
        return rawText;
      }

      const numericValue = Number.parseFloat(rawText || fallbackValue);
      if (Number.isFinite(numericValue)) {
        return `${numericValue >= 0 ? "+" : ""}${numericValue}`;
      }
    }

    return rawText || "?";
  }

  function formatDiceRollHistoryTimestamp(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function splitDiceRollHistoryLabel(label) {
    const normalizedLabel =
      String(label || "Further Dice Roll").trim() || "Further Dice Roll";
    const suffixes = [
      "To Hit",
      "Damage",
      "Save",
      "Check",
      "Healing",
      "Heal",
    ];

    for (const suffix of suffixes) {
      const escapedSuffix = suffix.replace(/\s+/g, "\\s+");
      const match = normalizedLabel.match(
        new RegExp(`^(.*?)(?:\\s+${escapedSuffix})$`, "i")
      );
      if (match?.[1]?.trim()) {
        return {
          title: match[1].trim(),
          accent: suffix,
        };
      }
    }

    return {
      title: normalizedLabel,
      accent: "",
    };
  }

  function getDicePrimaryDieType(entry) {
    const primaryValue = Array.isArray(entry?.values)
      ? entry.values.find((rollValue) =>
        /^d\d+$/i.test(String(rollValue?.type || "").trim())
      )
      : null;

    if (primaryValue?.type) {
      return String(primaryValue.type).trim().toLowerCase();
    }

    const equationMatch = String(entry?.equation || "").match(/d\d+/i);
    return equationMatch ? equationMatch[0].toLowerCase() : "d20";
  }

  function formatDiceDieTypeLabel(dieType) {
    const normalizedDieType = String(dieType || "d20").trim().toLowerCase();
    return normalizedDieType === "d100" ? "D%" : normalizedDieType.toUpperCase();
  }

  function formatDiceRollValueSummary(values) {
    if (!Array.isArray(values) || !values.length) {
      return "";
    }

    return values.reduce((summary, rollValue) => {
      const display = String(rollValue?.display || "").trim();
      if (!display) {
        return summary;
      }

      if (!summary) {
        return display.replace(/^\+/, "");
      }

      if (/^[+-]/.test(display)) {
        return `${summary} ${display[0]} ${display.slice(1)}`.trim();
      }

      return `${summary} + ${display}`;
    }, "");
  }

  function createDiceNotificationStack() {
    const stack = document.createElement("div");
    stack.id = DICE_NOTIFICATION_STACK_ID;
    stack.className = "fb-dice-notification-stack";
    stack.hidden = true;
    return stack;
  }

  function createDiceNotification(entry) {
    const notification = document.createElement("aside");
    notification.className = "fb-dice-notification";
    notification.setAttribute("role", "status");
    notification.setAttribute("aria-live", "polite");
    notification.innerHTML = `
      <div class="fb-dice-notification__eyebrow">Further Dice Roller</div>
      <strong class="fb-dice-notification__title"></strong>
      <div class="fb-dice-notification__summary"></div>
      <div class="fb-dice-notification__total"></div>
    `;

    const title = notification.querySelector(".fb-dice-notification__title");
    const summary = notification.querySelector(".fb-dice-notification__summary");
    const total = notification.querySelector(".fb-dice-notification__total");
    const labelParts = splitDiceRollHistoryLabel(entry.label);
    const summaryText =
      formatDiceRollValueSummary(entry.values) || entry.equation || "Roll";

    if (title instanceof HTMLElement) {
      title.textContent = labelParts.accent
        ? `${labelParts.title} ${labelParts.accent}`
        : labelParts.title;
    }

    if (summary instanceof HTMLElement) {
      summary.textContent = summaryText;
    }

    if (total instanceof HTMLElement) {
      total.textContent = entry.total ? `Total ${entry.total}` : "";
      total.hidden = !entry.total;
    }

    return notification;
  }

  function ensureDiceNotificationStack() {
    let stack = getDiceNotificationStack();
    if (!(stack instanceof HTMLElement)) {
      stack = createDiceNotificationStack();
      document.body.appendChild(stack);
    }

    return stack;
  }

  function clearDiceNotificationTimer(notification) {
    const timers = diceNotificationTimers.get(notification);
    if (!timers) {
      return;
    }

    window.clearTimeout(timers.dismissTimeoutId);
    window.clearTimeout(timers.fadeTimeoutId);
    diceNotificationTimers.delete(notification);
  }

  function syncDiceNotificationStackVisibility(stack = getDiceNotificationStack()) {
    if (!(stack instanceof HTMLElement)) {
      return;
    }

    stack.hidden = stack.childElementCount === 0;
  }

  function removeDiceNotification(notification) {
    if (!(notification instanceof HTMLElement)) {
      return;
    }

    const stack = notification.parentElement;
    clearDiceNotificationTimer(notification);
    notification.remove();
    if (stack instanceof HTMLElement) {
      syncDiceNotificationStackVisibility(stack);
    }
  }

  function dismissDiceNotification(notification) {
    if (!(notification instanceof HTMLElement) || !notification.isConnected) {
      return;
    }

    clearDiceNotificationTimer(notification);
    notification.classList.add("is-fading");
    notification.classList.remove("is-visible");

    const fadeTimeoutId = window.setTimeout(() => {
      removeDiceNotification(notification);
    }, DICE_NOTIFICATION_FADE_MS);

    diceNotificationTimers.set(notification, {
      dismissTimeoutId: null,
      fadeTimeoutId,
    });
  }

  function hideDiceNotifications() {
    const stack = getDiceNotificationStack();
    if (!(stack instanceof HTMLElement)) {
      return;
    }

    Array.from(stack.children).forEach((child) => {
      if (child instanceof HTMLElement) {
        removeDiceNotification(child);
      }
    });

    syncDiceNotificationStackVisibility(stack);
  }

  function showDiceRollNotification(entry) {
    if (!entry || typeof entry !== "object" || isDiceGameLogOpen()) {
      hideDiceNotifications();
      return;
    }

    const stack = ensureDiceNotificationStack();
    const notification = createDiceNotification(entry);

    stack.prepend(notification);
    syncDiceNotificationStackVisibility(stack);

    window.requestAnimationFrame(() => {
      notification.classList.add("is-visible");
    });

    const dismissTimeoutId = window.setTimeout(() => {
      dismissDiceNotification(notification);
    }, DICE_NOTIFICATION_DURATION_MS);

    diceNotificationTimers.set(notification, {
      dismissTimeoutId,
      fadeTimeoutId: null,
    });
  }

  function renderDiceRollHistory() {
    const logList = getDiceNativePanel()?.querySelector(
      '[data-fb-dice-role="log-list"]'
    );
    if (!(logList instanceof HTMLElement)) {
      return;
    }

    if (!diceUiState.rollHistory.length) {
      const emptyState = document.createElement("p");
      emptyState.className = "fb-dice-log__empty";
      emptyState.textContent = "Your Further Dice Roller rolls will show up here.";
      logList.replaceChildren(emptyState);
      return;
    }

    const entries = [...diceUiState.rollHistory]
      .sort((left, right) => left.timestamp - right.timestamp)
      .map((entry) => {
        const article = document.createElement("article");
        const header = document.createElement("div");
        const heading = document.createElement("div");
        const title = document.createElement("strong");
        const accent = document.createElement("span");
        const time = document.createElement("span");
        const body = document.createElement("div");
        const roll = document.createElement("div");
        const dieIcon = document.createElement("span");
        const meta = document.createElement("div");
        const summary = document.createElement("strong");
        const equation = document.createElement("span");
        const result = document.createElement("div");
        const equals = document.createElement("span");
        const total = document.createElement("strong");
        const labelParts = splitDiceRollHistoryLabel(entry.label);
        const dieType = getDicePrimaryDieType(entry);
        const summaryText =
          formatDiceRollValueSummary(entry.values) ||
          entry.total ||
          entry.equation ||
          "Roll";

        article.className = "fb-dice-log__entry";
        header.className = "fb-dice-log__entry-header";
        heading.className = "fb-dice-log__entry-heading";
        title.className = "fb-dice-log__entry-title";
        accent.className = "fb-dice-log__entry-accent";
        time.className = "fb-dice-log__entry-time";
        body.className = "fb-dice-log__entry-body";
        roll.className = "fb-dice-log__entry-roll";
        dieIcon.className = "fb-dice-log__entry-die-icon";
        meta.className = "fb-dice-log__entry-meta";
        summary.className = "fb-dice-log__entry-summary";
        equation.className = "fb-dice-log__entry-equation";
        result.className = "fb-dice-log__entry-result";
        equals.className = "fb-dice-log__entry-equals";
        total.className = "fb-dice-log__entry-total";

        title.textContent = labelParts.accent ? `${labelParts.title}:` : labelParts.title;
        accent.textContent = labelParts.accent;
        time.textContent = formatDiceRollHistoryTimestamp(entry.timestamp);
        dieIcon.dataset.die = dieType;
        dieIcon.textContent = formatDiceDieTypeLabel(dieType);
        summary.textContent = summaryText;
        equation.textContent = entry.equation || "Custom roll";
        equals.textContent = "=";
        total.textContent = entry.total || "?";
        total.setAttribute(
          "aria-label",
          entry.total ? `Total ${entry.total}` : "Roll total unavailable"
        );

        heading.append(title);
        if (labelParts.accent) {
          heading.appendChild(accent);
        }

        header.append(heading, time);
        meta.append(summary, equation);
        roll.append(dieIcon, meta);
        result.append(equals, total);
        body.append(roll, result);
        article.append(header, body);

        return article;
      });

    logList.replaceChildren(...entries);
  }

  function scrollDiceRollHistoryToBottom() {
    const panel = getDiceNativePanel();
    if (!(panel instanceof HTMLElement)) {
      return;
    }

    const logList = panel.querySelector('[data-fb-dice-role="log-list"]');
    let scrollContainer = logList instanceof HTMLElement ? logList : panel;
    let currentElement = scrollContainer === panel ? panel : logList.parentElement;

    while (currentElement instanceof HTMLElement) {
      const style = window.getComputedStyle(currentElement);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        currentElement.scrollHeight > currentElement.clientHeight
      ) {
        scrollContainer = currentElement;
        break;
      }

      currentElement = currentElement.parentElement;
    }

    const applyScroll = () => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    };

    window.requestAnimationFrame(() => {
      applyScroll();
      window.requestAnimationFrame(applyScroll);
      window.setTimeout(applyScroll, 120);
    });
  }

  function appendDiceRollHistory(roll) {
    const entry = buildDiceRollHistoryEntry(roll);
    if (!entry) {
      return;
    }

    diceUiState.rollHistory = [
      ...diceUiState.rollHistory.filter((existingEntry) => existingEntry.id !== entry.id),
      entry,
    ]
      .sort((left, right) => left.timestamp - right.timestamp)
      .slice(-DICE_ROLL_HISTORY_LIMIT);

    renderDiceRollHistory();
    scrollDiceRollHistoryToBottom();
    showDiceRollNotification(entry);
    void saveDiceLocalState();
  }

  function renderDiceRollOutput(roll, host = getDiceDrawer()) {
    const output = host?.querySelector(
      '[data-fb-dice-role="roll-output"]'
    );
    if (!(output instanceof HTMLElement) || !roll || typeof roll !== "object") {
      return;
    }

    const summary = document.createElement("div");
    const title = document.createElement("span");
    const total = document.createElement("strong");
    const diceList = document.createElement("div");
    const totalText = formatDiceRollTotalValue(roll.total_value);
    const values = Array.isArray(roll.values)
      ? roll.values.filter((value) => !value?.is_dropped && !value?.is_cleared)
      : [];

    summary.className = "fb-dice-drawer__roll-summary";
    title.className = "fb-dice-drawer__roll-title";
    total.className = "fb-dice-drawer__roll-total";
    diceList.className = "fb-dice-drawer__roll-dice";

    title.textContent = String(roll.label || roll.equation || "Latest roll").trim();
    total.textContent = totalText ? `Total ${totalText}` : "";
    summary.append(title, total);

    values.forEach((rollValue) => {
      const die = document.createElement("span");
      const dieType = document.createElement("span");
      const dieValue = document.createElement("strong");

      die.className = "fb-dice-drawer__die";
      if (rollValue.type === "mod") {
        die.dataset.kind = "modifier";
      }

      dieType.className = "fb-dice-drawer__die-type";
      dieValue.className = "fb-dice-drawer__die-value";

      dieType.textContent =
        rollValue.type === "mod"
          ? "mod"
          : String(rollValue.type || "die").toUpperCase();
      dieValue.textContent = formatDiceRollValueDisplay(rollValue);
      die.append(dieType, dieValue);
      diceList.appendChild(die);
    });

    output.hidden = false;
    output.removeAttribute("data-animate");
    output.replaceChildren(summary, diceList);
    void output.offsetWidth;
    output.dataset.animate = "true";
  }

  function hideDiceRollOutput(host = getDiceVisualizerHost()) {
    const output = host?.querySelector('[data-fb-dice-role="roll-output"]');
    if (!(output instanceof HTMLElement)) {
      return;
    }

    output.hidden = true;
    output.removeAttribute("data-animate");
  }

  function syncDiceScreenTrayPlacement(tray = getDiceScreenTray()) {
    if (!(tray instanceof HTMLElement)) {
      return;
    }

    const target = getDiceScreenTrayBoundsTarget();
    const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : null;
    const left = rect ? Math.max(0, Math.min(window.innerWidth, rect.left)) : 0;
    const top = rect ? Math.max(0, Math.min(window.innerHeight, rect.top)) : 0;
    const right = rect ? Math.max(left, Math.min(window.innerWidth, rect.right)) : 0;
    const bottom = rect ? Math.max(top, Math.min(window.innerHeight, rect.bottom)) : 0;
    const width = Math.round(right - left);
    const height = Math.round(bottom - top);

    if (!rect || width < 240 || height < 240) {
      tray.hidden = true;
      tray.style.removeProperty("--fb-dice-screen-left");
      tray.style.removeProperty("--fb-dice-screen-top");
      tray.style.removeProperty("--fb-dice-screen-width");
      tray.style.removeProperty("--fb-dice-screen-height");
      return;
    }

    tray.hidden = false;
    tray.style.setProperty("--fb-dice-screen-left", `${left}px`);
    tray.style.setProperty("--fb-dice-screen-top", `${top}px`);
    tray.style.setProperty("--fb-dice-screen-width", `${width}px`);
    tray.style.setProperty("--fb-dice-screen-height", `${height}px`);
  }

  function syncDiceScreenTray(tray = getDiceScreenTray()) {
    if (!(tray instanceof HTMLElement)) {
      return;
    }

    syncDiceScreenTrayPlacement(tray);
  }

  function hideDiceScreenTray() {
    window.clearTimeout(diceScreenTrayTimeoutId);
    diceScreenTrayTimeoutId = null;

    const tray = getDiceScreenTray();
    if (!(tray instanceof HTMLElement)) {
      return;
    }

    tray.remove();
  }

  function scheduleHideDiceScreenTray() {
    window.clearTimeout(diceScreenTrayTimeoutId);
    diceScreenTrayTimeoutId = null;
  }

  function showDiceScreenTray() {
    return mountDiceScreenTray() ? getDiceScreenTray() : null;
  }

  function syncDiceStage(drawer, hasSdk, hasSession, hasRoom) {
    if (!(drawer instanceof HTMLElement)) {
      return;
    }

    const diceStage = drawer.querySelector(".fb-dice-drawer__stage");
    const diceStageStatus = drawer.querySelector(
      '[data-fb-dice-role="canvas-status"]'
    );
    const stageState = diceRuntimeState.visualizerError
      ? "error"
      : !hasSdk
        ? "error"
        : diceUiState.rollPending
          ? "connecting"
          : "ready";

    if (diceStage instanceof HTMLElement) {
      diceStage.dataset.state = stageState;
    }

    if (diceStageStatus instanceof HTMLElement) {
      diceStageStatus.textContent = getDiceCanvasStatusMessage(
        hasSdk,
        hasSession,
        hasRoom
      );
    }
  }

  function syncDiceDrawer(drawer) {
    if (!(drawer instanceof HTMLElement)) {
      return;
    }

    const isEmbedded = drawer.classList.contains("fb-dice-drawer--embedded");
    if (isEmbedded) {
      drawer.dataset.layout = "embedded";
    }

    const toggle = drawer.querySelector(".fb-dice-drawer__toggle");
    const toggleCopy = drawer.querySelector(".fb-dice-drawer__toggle-copy");
    const panel = drawer.querySelector(".fb-dice-drawer__panel");
    const state = drawer.querySelector(".fb-dice-drawer__state");
    const statusCopy = drawer.querySelector(".fb-dice-drawer__status-copy");
    const rollCustomButton = drawer.querySelector(
      '[data-fb-dice-action="roll-custom"]'
    );
    const customRollInput = drawer.querySelector(
      '[data-fb-dice-role="custom-roll-input"]'
    );
    const quickAddButtons = Array.from(
      drawer.querySelectorAll('[data-fb-dice-die]')
    );
    const isRolling = !!diceUiState.rollPending;
    const hasSdk = !!getDiceSdk();
    const canComposeCustomRoll = !isRolling && hasSdk;
    const canSubmitCustomRoll = canComposeCustomRoll;
    const hasCustomFormula =
      customRollInput instanceof HTMLInputElement &&
      !!String(customRollInput.value || "").trim();

    drawer.dataset.expanded = isEmbedded || diceUiState.expanded ? "true" : "false";

    if (toggle instanceof HTMLElement) {
      toggle.setAttribute(
        "aria-expanded",
        isEmbedded || diceUiState.expanded ? "true" : "false"
      );
    }

    if (toggleCopy) {
      toggleCopy.textContent = diceUiState.expanded ? "Hide" : "Open";
    }

    if (panel instanceof HTMLElement) {
      panel.hidden = isEmbedded ? false : !diceUiState.expanded;
    }

    if (state instanceof HTMLElement) {
      state.textContent = getDiceStateLabel();
      state.dataset.state = diceUiState.connectionState;
    }

    if (statusCopy) {
      statusCopy.textContent = getDiceStatusMessage();
    }

    syncDiceStage(drawer, hasSdk, false, false);

    if (customRollInput instanceof HTMLInputElement) {
      customRollInput.disabled = !canComposeCustomRoll;
    }

    quickAddButtons.forEach((button) => {
      if (button instanceof HTMLButtonElement) {
        button.disabled = !canComposeCustomRoll;
      }
    });

    if (rollCustomButton instanceof HTMLButtonElement) {
      rollCustomButton.disabled = !canSubmitCustomRoll || !hasCustomFormula;
    }

    renderDiceRollHistory();
    syncDiceScreenTray();
    syncDiceVisualizer();
    scheduleDiceDrawerPlacement();
  }

  function syncDiceConfigPanel(panel = getDiceConfigPanel()) {
    if (!(panel instanceof HTMLElement)) {
      return;
    }

    const integrationEnabled = !!getExtensionSettings().diceEnabled;
    const state = panel.querySelector(".fb-dice-drawer__state");
    const statusCopy = panel.querySelector(".fb-dice-drawer__status-copy");
    const configHint = panel.querySelector('[data-fb-dice-role="config-hint"]');

    panel.dataset.enabled = integrationEnabled ? "true" : "false";

    if (state instanceof HTMLElement) {
      state.textContent = integrationEnabled ? getDiceStateLabel() : "Disabled";
      state.dataset.state = integrationEnabled ? diceUiState.connectionState : "idle";
    }

    if (statusCopy instanceof HTMLElement) {
      statusCopy.textContent = integrationEnabled
        ? getDiceStatusMessage()
        : "Enable Further Dice Roller above to override D&D Beyond's dice button and Game Log.";
    }

    if (configHint instanceof HTMLElement) {
      configHint.textContent =
        "Use D&D Beyond's bottom-left dice button to open Further Dice Roller. Simple rolls post directly into the Game Log.";
    }
  }

  function updateDiceUiState(nextState) {
    Object.assign(diceUiState, nextState);
    mountDiceScreenTray();
    mountDiceNativePanel();
    mountDiceRollerPanel();
    syncDiceDrawer(getDiceDrawer());
    syncDiceConfigPanel();
    syncDiceSidebarAction(findDiceInfoSidebar());

    if (
      String(diceUiState.authToken || "").trim() &&
      normalizeDiceRoomSlug(diceUiState.activeRoomSlug) &&
      String(diceUiState.themeId || "").trim()
    ) {
      scheduleDiceVisualizerWarmup(getDiceScreenTray());
    }
  }

  function createDicePreviewUuid() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    return `fb-dice-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function applyDiceRollTheme(parsedRoll, themeId) {
    const normalizedThemeId = String(themeId || "").trim();
    if (!parsedRoll || typeof parsedRoll !== "object" || !normalizedThemeId) {
      return parsedRoll;
    }

    return {
      ...parsedRoll,
      dice: Array.isArray(parsedRoll.dice)
        ? parsedRoll.dice.map((die) => {
          if (!die || typeof die !== "object" || die.type === "mod") {
            return die;
          }

          return {
            ...die,
            theme: normalizedThemeId,
          };
        })
        : [],
    };
  }

  function getDiceVisualizerErrorMessage(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "The 3D Further Dice Roller tray could not start.";
  }

  function canReuseDiceVisualizer(drawer = getDiceVisualizerHost()) {
    const visualizer = diceRuntimeState.visualizer;
    const canvas = getDiceCanvas(drawer);
    const token = String(diceUiState.authToken || "").trim();
    const themeId = String(diceUiState.themeId || "").trim();

    return !!(
      visualizer &&
      canvas instanceof HTMLCanvasElement &&
      visualizer.canvas === canvas &&
      diceRuntimeState.visualizerToken === token &&
      diceRuntimeState.visualizerThemeId === themeId
    );
  }

  function getDiceVisualizerSize(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      return {
        width: 296,
        height: 152,
      };
    }

    const stage = canvas.closest(".fb-dice-drawer__stage");
    const canvasRect = canvas.getBoundingClientRect();
    const stageRect = stage instanceof HTMLElement ? stage.getBoundingClientRect() : null;
    const isRollerStage =
      stage instanceof HTMLElement &&
      stage.classList.contains("fb-dice-drawer__stage--roller");
    const isScreenTrayStage =
      stage instanceof HTMLElement &&
      stage.classList.contains("fb-dice-screen-tray__stage");
    const width = Math.max(
      296,
      Math.round(stageRect?.width || canvasRect.width || canvas.clientWidth || canvas.width || 296)
    );
    const height = isRollerStage
      ? Math.max(360, width)
      : isScreenTrayStage
        ? Math.max(
          240,
          Math.round(stageRect?.height || canvasRect.height || canvas.clientHeight || canvas.height || 240)
        )
        : Math.max(
          152,
          Math.round(canvasRect.height || canvas.clientHeight || canvas.height || 152)
        );

    return {
      width,
      height,
    };
  }

  function resizeDiceVisualizer(visualizer, canvas) {
    if (!(canvas instanceof HTMLCanvasElement) || !visualizer) {
      return;
    }

    const { width, height } = getDiceVisualizerSize(canvas);

    if (canvas.width !== width) {
      canvas.width = width;
    }

    if (canvas.height !== height) {
      canvas.height = height;
    }

    if (typeof visualizer.resize === "function") {
      visualizer.resize(width, height);
    }

    // Let CSS keep control of the roller footprint after Three.js updates the backing buffer.
    canvas.style.removeProperty("width");
    canvas.style.removeProperty("height");
  }

  function scheduleDiceVisualizerWarmup(drawer = getDiceVisualizerHost()) {
    return;
  }

  function destroyDiceVisualizer(errorMessage = "") {
    if (diceRuntimeState.visualizerWarmupTimerId !== null) {
      window.clearTimeout(diceRuntimeState.visualizerWarmupTimerId);
      diceRuntimeState.visualizerWarmupTimerId = null;
    }

    const visualizer = diceRuntimeState.visualizer;
    if (visualizer) {
      try {
        visualizer.disconnect();
      } catch (_error) {
        // Ignore disconnect failures during teardown.
      }

      try {
        visualizer.stop();
      } catch (_error) {
        // Ignore stop failures during teardown.
      }
    }

    diceRuntimeState.visualizer = null;
    diceRuntimeState.visualizerToken = "";
    diceRuntimeState.visualizerThemeId = "";
    diceRuntimeState.visualizerError = errorMessage;
  }

  function syncDiceVisualizer(drawer = getDiceVisualizerHost()) {
    const hasSdk = !!getDiceSdk();
    const hasSession = !!String(diceUiState.authToken || "").trim();
    const hasRoom = !!normalizeDiceRoomSlug(diceUiState.activeRoomSlug);
    const hasTheme = !!String(diceUiState.themeId || "").trim();

    if (!(drawer instanceof HTMLElement)) {
      if (diceRuntimeState.visualizerWarmupTimerId !== null) {
        window.clearTimeout(diceRuntimeState.visualizerWarmupTimerId);
        diceRuntimeState.visualizerWarmupTimerId = null;
      }
      if (diceRuntimeState.visualizer) {
        destroyDiceVisualizer();
      }
      return;
    }

    if (!hasSession || !hasRoom || !hasTheme) {
      if (diceRuntimeState.visualizerWarmupTimerId !== null) {
        window.clearTimeout(diceRuntimeState.visualizerWarmupTimerId);
        diceRuntimeState.visualizerWarmupTimerId = null;
      }
      if (diceRuntimeState.visualizer) {
        destroyDiceVisualizer();
      } else {
        diceRuntimeState.visualizerError = "";
      }
      syncDiceStage(drawer, hasSdk, hasSession, hasRoom);
      return;
    }

    const canvas = getDiceCanvas(drawer);
    if (!(canvas instanceof HTMLCanvasElement)) {
      if (diceRuntimeState.visualizerWarmupTimerId !== null) {
        window.clearTimeout(diceRuntimeState.visualizerWarmupTimerId);
        diceRuntimeState.visualizerWarmupTimerId = null;
      }
      if (diceRuntimeState.visualizer) {
        destroyDiceVisualizer();
      }
      syncDiceStage(drawer, hasSdk, hasSession, hasRoom);
      return;
    }

    if (!diceRuntimeState.visualizer) {
      scheduleDiceVisualizerWarmup(drawer);
      syncDiceStage(drawer, hasSdk, hasSession, hasRoom);
      return;
    }

    if (!canReuseDiceVisualizer(drawer)) {
      destroyDiceVisualizer();
      syncDiceStage(drawer, hasSdk, hasSession, hasRoom);
      return;
    }

    resizeDiceVisualizer(diceRuntimeState.visualizer, canvas);
    diceRuntimeState.visualizerError = "";
    syncDiceStage(drawer, hasSdk, hasSession, hasRoom);
  }

  function destroyDiceEngine() {
    const engine = diceRuntimeState.engine;
    if (!engine) {
      return;
    }

    try {
      engine.disconnect();
    } catch (_error) {
      // Ignore disconnect failures during teardown.
    }

    diceRuntimeState.engine = null;
    diceRuntimeState.engineToken = "";
    diceRuntimeState.connectedRoomSlug = "";
    diceRuntimeState.syncPending = false;
  }

  function handleDiceNativeDicePressStart(event) {
    if (!shouldSuppressDiceNativeDice()) {
      return;
    }

    if (event.type === "mousedown" && typeof window.PointerEvent === "function") {
      return;
    }

    if (typeof event.button === "number" && event.button !== 0) {
      return;
    }

    const diceButton = getDiceNativeDiceButton(event.target);
    if (!(diceButton instanceof HTMLButtonElement)) {
      return;
    }

    const isDrawerButton = !!diceButton.closest(".dice-rolling-panel");
    stopDiceNativeDiceEvent(event, true);

    if (isDrawerButton || !canUseDiceNativeRolls()) {
      return;
    }
  }

  function handleDiceDiceButtonClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const diceButton = target.closest(
      '.dice-rolling-panel button[class*="DiceContainer_button__"]'
    );
    if (diceButton instanceof HTMLButtonElement) {
      if (!canUseDiceNativeRolls()) {
        return;
      }

      stopDiceNativeDiceEvent(event);

      updateDiceUiState({ expanded: !diceUiState.expanded });
      resetDiceNativeButtonFocus(diceButton);
      void saveDiceLocalState();
      return;
    }

    if (!diceUiState.expanded) {
      return;
    }

    const roller = getDiceRollerPanel();
    if (!(roller instanceof HTMLElement) || roller.contains(target)) {
      return;
    }

    updateDiceUiState({ expanded: false });
    void saveDiceLocalState();
  }

  function handleDiceDraftInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.dataset.fbDiceRole === "custom-roll-input") {
      const drawer = target.closest(".fb-dice-drawer");
      syncDiceDrawer(drawer instanceof HTMLElement ? drawer : getDiceVisualizerHost());
      return;
    }
  }

  function createDiceSidebarAction() {
    const section = document.createElement("section");
    const eyebrow = document.createElement("p");
    const summary = document.createElement("p");
    const button = document.createElement("button");

    section.className = DICE_SIDEBAR_ACTION_CLASS;

    eyebrow.className = "fb-dice-sidebar-action__eyebrow";
    eyebrow.textContent = "Further Beyond";

    summary.className = "fb-dice-sidebar-action__summary";

    button.type = "button";
    button.className = "fb-dice-sidebar-action__button";
    button.textContent = "Roll in Further Dice Roller";
    button.addEventListener("click", handleDiceSidebarRollClick);

    section.append(eyebrow, summary, button);
    return section;
  }

  function syncDiceSidebarAction(dialog) {
    const existingActions = Array.from(
      document.querySelectorAll(`.${DICE_SIDEBAR_ACTION_CLASS}`)
    );
    existingActions.forEach((action) => {
      if (!dialog || action.closest('[role="dialog"]') !== dialog) {
        action.remove();
      }
    });

    if (!getExtensionSettings().diceEnabled || !(dialog instanceof HTMLElement)) {
      return false;
    }

    const rollDefinition = buildDiceSidebarRollDefinition(dialog);
    if (!rollDefinition) {
      dialog.querySelector(`.${DICE_SIDEBAR_ACTION_CLASS}`)?.remove();
      return false;
    }

    let action = dialog.querySelector(`.${DICE_SIDEBAR_ACTION_CLASS}`);
    if (!(action instanceof HTMLElement)) {
      action = createDiceSidebarAction();
      dialog.appendChild(action);
    }

    const summary = action.querySelector(".fb-dice-sidebar-action__summary");
    const button = action.querySelector(".fb-dice-sidebar-action__button");
    const canRoll = !!getDiceSdk() && diceUiState.connectionState !== "connecting";

    if (summary) {
      summary.textContent = `${rollDefinition.label}: ${rollDefinition.expression}`;
    }

    if (button instanceof HTMLButtonElement) {
      button.dataset.fbDiceExpression = rollDefinition.expression;
      button.dataset.fbDiceLabel = rollDefinition.label;
      button.disabled = !canRoll;
    }

    return true;
  }

  async function handleDiceSidebarRollClick(event) {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }

    const expression = String(button.dataset.fbDiceExpression || "").trim();
    const label = String(button.dataset.fbDiceLabel || "").trim() || "D&D Beyond roll";
    if (!expression) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      await submitDiceRollExpression(expression, label, {
        showRollerOutput: false,
        show3dTray: true,
      });
    } catch (error) {
      console.error("[Further Beyond] Further Dice Roller action failed.", error);
      updateDiceUiState({
        connectionState: getDiceConnectionState(),
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : "Further Dice Roller action failed.",
      });
    }
  }

  async function handleDiceIntegratedDiceClick(event) {
    const target = event.target;
    if (!(target instanceof Element) || !canUseDiceNativeRolls()) {
      return;
    }

    const button = target.closest("button.integrated-dice__container");
    const context = getDiceIntegratedDiceContext(button);
    if (!context) {
      return;
    }

    if (shouldSuppressDiceNativeDice()) {
      stopDiceNativeDiceEvent(event);
    }

    try {
      await submitDiceIntegratedDiceButtonRoll(button);
    } catch (error) {
      console.error("[Further Beyond] Further Dice Roller action failed.", error);
      updateDiceUiState({
        connectionState: getDiceConnectionState(),
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : "Further Dice Roller action failed.",
      });
    } finally {
      resetDiceNativeButtonFocus(button);
    }
  }

  async function submitDiceIntegratedDiceButtonRoll(button) {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const metadata = await requestIntegratedDiceMetadata(button);
    const rollDefinition = buildDiceIntegratedDiceRollDefinition(
      button,
      metadata
    );
    if (!rollDefinition) {
      throw new Error("This D&D Beyond roll is not supported yet.");
    }

    await submitDiceRollExpression(
      rollDefinition.expression,
      rollDefinition.label,
      {
        showRollerOutput: false,
        show3dTray: true,
      }
    );
  }

  function parseDiceCustomRoll(expression) {
    const normalizedExpression = String(expression || "").trim();
    if (!normalizedExpression) {
      throw new Error("Enter a dice expression first.");
    }

    const compactExpression = normalizedExpression.replace(/\s+/g, "");
    const rawTerms = compactExpression.match(/[+-]?[^+-]+/g);

    if (!rawTerms || rawTerms.join("") !== compactExpression) {
      throw new Error(
        "Custom rolls currently support only simple terms like d20, 2d6 + 3, or 1d20 - 1."
      );
    }

    const terms = [];
    let totalDice = 0;

    rawTerms.forEach((rawTerm) => {
      const hasExplicitSign = rawTerm.startsWith("+") || rawTerm.startsWith("-");
      const sign = rawTerm.startsWith("-") ? -1 : 1;
      const termBody = hasExplicitSign ? rawTerm.slice(1) : rawTerm;
      const diceMatch = /^(\d*)d(4|6|8|10|12|20)$/i.exec(termBody);

      if (diceMatch) {
        const quantity = Number.parseInt(diceMatch[1] || "1", 10);
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new Error("Each dice term must use a positive quantity.");
        }

        if (quantity > 25) {
          throw new Error("A single custom term cannot exceed 25 dice.");
        }

        totalDice += quantity;
        if (totalDice > 25) {
          throw new Error("Custom rolls cannot exceed 25 dice total.");
        }

        terms.push({
          kind: "dice",
          sign,
          quantity,
          dieType: `d${diceMatch[2]}`,
        });
        return;
      }

      if (/^\d+$/.test(termBody)) {
        terms.push({
          kind: "modifier",
          sign,
          value: Number.parseInt(termBody, 10),
        });
        return;
      }

      throw new Error(
        "Custom rolls currently support only simple terms like d20, 2d6 + 3, or 1d20 - 1."
      );
    });

    return {
      equation: terms
        .map((term, index) => {
          const prefix = term.sign < 0 ? "-" : index === 0 ? "" : "+";

          if (term.kind === "dice") {
            return `${prefix}${term.quantity === 1 ? "1" : term.quantity}${term.dieType}`;
          }

          return `${prefix}${term.value}`;
        })
        .join(""),
      terms,
    };
  }

  function appendDiceCustomRollDie(dieType) {
    const drawer = getDiceDrawer();
    const input = drawer?.querySelector('[data-fb-dice-role="custom-roll-input"]');
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const currentValue = String(input.value || "").trim();
    input.value = currentValue ? `${currentValue} + ${dieType}` : dieType;
    syncDiceDrawer(drawer);
  }

  async function submitDiceCustomRoll() {
    const drawer = getDiceDrawer();
    const input = drawer?.querySelector('[data-fb-dice-role="custom-roll-input"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Custom roll input is unavailable.");
    }

    await submitDiceRollExpression(input.value, "Custom roll");

    input.value = "";
    syncDiceDrawer(drawer);
  }

  function createDiceLocalRoll(parsedRoll, label) {
    const sdk = getDiceSdk();
    if (!sdk) {
      throw new Error("Local Further Dice Roller bundle is unavailable.");
    }

    let diceRoll;
    try {
      diceRoll = new sdk.DiceRoll(parsedRoll.equation);
    } catch (error) {
      throw new Error(
        error instanceof Error && error.message
          ? error.message
          : "Enter a valid simple roll expression."
      );
    }

    const values = [];
    const now = new Date().toISOString();
    let parsedTermIndex = 0;

    for (const rollTerm of Array.isArray(diceRoll.rolls) ? diceRoll.rolls : []) {
      if (typeof rollTerm === "string") {
        continue;
      }

      const parsedTerm = parsedRoll.terms[parsedTermIndex];
      parsedTermIndex += 1;

      if (!parsedTerm) {
        continue;
      }

      if (parsedTerm.kind === "modifier") {
        const modifierValue = parsedTerm.sign * parsedTerm.value;
        values.push({
          uuid: createDicePreviewUuid(),
          is_hidden: false,
          is_user_value: true,
          is_visible: true,
          is_cleared: false,
          is_dropped: false,
          type: "mod",
          value: modifierValue,
          value_to_display: modifierValue >= 0 ? `+${modifierValue}` : `${modifierValue}`,
          created_at: now,
          updated_at: now,
        });
        continue;
      }

      const termResults = Array.isArray(rollTerm?.rolls) ? rollTerm.rolls : [];
      termResults.forEach((result) => {
        const rawValue = Number.parseInt(
          String(result?.value ?? result?.calculationValue ?? 0),
          10
        );
        const signedValue = parsedTerm.sign < 0 ? -Math.abs(rawValue) : rawValue;

        values.push({
          uuid: createDicePreviewUuid(),
          is_hidden: false,
          is_user_value: true,
          is_visible: true,
          is_cleared: false,
          is_dropped: false,
          type: parsedTerm.dieType,
          value: signedValue,
          value_to_display: String(signedValue),
          created_at: now,
          updated_at: now,
        });
      });
    }

    return {
      uuid: createDicePreviewUuid(),
      label: String(label || parsedRoll.equation || "Further Dice Roll").trim(),
      equation: String(diceRoll.notation || parsedRoll.equation).trim(),
      total_value: diceRoll.total,
      values,
      created_at: now,
      updated_at: now,
    };
  }

  async function submitDiceRollExpression(expression, label, options = {}) {
    const showRollerOutput = options.showRollerOutput !== false;
    const parsedRoll = parseDiceCustomRoll(expression);

    updateDiceUiState({
      rollPending: true,
      connectionState: getDiceConnectionState(true),
      statusMessage: `Rolling ${parsedRoll.equation}...`,
    });

    try {
      const roll = createDiceLocalRoll(parsedRoll, label);
      const totalValue = Number.isFinite(roll?.total_value)
        ? ` Total ${roll.total_value}.`
        : "";

      if (showRollerOutput) {
        renderDiceRollOutput(
          roll,
          getDiceRollerPanel() || getDiceDrawer() || getDiceVisualizerHost()
        );
      }
      appendDiceRollHistory(roll);

      updateDiceUiState({
        rollPending: false,
        connectionState: getDiceConnectionState(false),
        statusMessage: `Rolled ${roll?.equation || parsedRoll.equation}.${totalValue}`,
      });

      return roll;
    } catch (error) {
      updateDiceUiState({
        rollPending: false,
        connectionState: getDiceConnectionState(false),
      });
      throw error;
    }
  }

  async function handleDiceDrawerKeydown(event) {
    const target = event.target;
    if (
      event.key !== "Enter" ||
      !(target instanceof HTMLInputElement) ||
      target.dataset.fbDiceRole !== "custom-roll-input"
    ) {
      return;
    }

    event.preventDefault();

    try {
      await submitDiceCustomRoll();
    } catch (error) {
      console.error("[Further Beyond] Further Dice Roller action failed.", error);
      updateDiceUiState({
        connectionState: getDiceConnectionState(),
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : "Further Dice Roller action failed.",
      });
    }
  }

  async function handleDiceActionClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest(
      "[data-fb-dice-action], [data-fb-dice-die]"
    );
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }

    const dieType = button.dataset.fbDiceDie;
    if (dieType) {
      event.preventDefault();
      event.stopPropagation();
      appendDiceCustomRollDie(dieType);
      return;
    }

    const action = button.dataset.fbDiceAction;
    if (!action) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      if (action === "open-settings") {
        openDiceConfigModal();
        return;
      }

      if (action === "close-roller") {
        updateDiceUiState({ expanded: false });
        await saveDiceLocalState();
        return;
      }

      if (action === "close-screen-tray") {
        hideDiceScreenTray();
        return;
      }

      if (action === "roll-custom") {
        await submitDiceCustomRoll();
      }
    } catch (error) {
      console.error("[Further Beyond] Further Dice Roller action failed.", error);
      updateDiceUiState({
        connectionState: getDiceConnectionState(),
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : "Further Dice Roller action failed.",
      });
    }
  }

  function ensureDiceSidebarAlignedRight() {
    const sidebar = getDiceNativeSidebar();
    if (!(sidebar instanceof HTMLElement)) {
      return false;
    }

    const leftButton = sidebar.querySelector('button[aria-label="Align Left"]');
    const rightButton = sidebar.querySelector('button[aria-label="Align Right"]');
    const leftIsActive = leftButton?.classList.contains("styles_active__tWFiD");
    const rightIsActive = rightButton?.classList.contains("styles_active__tWFiD");

    if (!rightIsActive && leftIsActive && rightButton instanceof HTMLButtonElement) {
      rightButton.click();
      return true;
    }

    return rightIsActive;
  }

  function createDiceNativePanel() {
    const panel = document.createElement("section");

    panel.id = DICE_NATIVE_PANEL_ID;
    panel.className = "fb-dice-log-pane";
    panel.setAttribute("aria-label", "Further Dice Roller log");
    panel.innerHTML = `
      <div class="fb-dice-log__list" data-fb-dice-role="log-list"></div>
    `;

    renderDiceRollHistory();
    return panel;
  }

  function createDiceScreenTray() {
    const tray = document.createElement("section");

    tray.id = DICE_SCREEN_TRAY_ID;
    tray.className = "fb-dice-screen-tray";
    tray.hidden = true;
    tray.setAttribute("aria-hidden", "true");
    tray.innerHTML = `
      <div class="fb-dice-drawer__stage fb-dice-screen-tray__stage" data-state="idle">
        <canvas
          class="fb-dice-drawer__canvas fb-dice-screen-tray__canvas"
          data-fb-dice-role="canvas"
          width="1280"
          height="720"
          aria-label="Dice tray"
        ></canvas>
        <div class="fb-dice-drawer__roll-output fb-dice-screen-tray__roll-output" data-fb-dice-role="roll-output" aria-live="polite" hidden></div>
      </div>
    `;

    syncDiceScreenTray(tray);
    return tray;
  }

  function createDiceRollerPanel() {
    const panel = document.createElement("section");

    panel.id = DICE_ROLLER_PANEL_ID;
    panel.className = "fb-dice-drawer fb-dice-drawer--roller";
    panel.dataset.layout = "roller";
    panel.setAttribute("aria-label", "Further Dice Roller");
    panel.innerHTML = `
      <div class="fb-dice-drawer__header">
        <div class="fb-dice-drawer__title-block">
          <p class="fb-dice-drawer__eyebrow">Further Beyond</p>
          <h2 class="fb-dice-drawer__title">Further Dice Roller</h2>
        </div>
        <div class="fb-dice-roller__header-actions">
          <span class="fb-dice-drawer__state" data-state="ready">Ready</span>
          <button type="button" class="fb-dice-roller__close" data-fb-dice-action="close-roller" aria-label="Close Further Dice Roller">x</button>
        </div>
      </div>
      <div class="fb-dice-drawer__summary">
        <span class="fb-dice-drawer__state" data-state="ready">Simple local rolls</span>
      </div>
      <div class="fb-dice-drawer__panel">
        <p class="fb-dice-drawer__status">
          <span class="fb-dice-drawer__status-label">Status</span>
          <span class="fb-dice-drawer__status-copy">Enter a simple roll or use D&D Beyond's dice button.</span>
        </p>
        <label class="fb-dice-drawer__field">
          <span class="fb-dice-drawer__field-label">Custom roll</span>
          <input class="fb-dice-drawer__input" data-fb-dice-role="custom-roll-input" type="text" placeholder="d20 + 2" />
        </label>
        <div class="fb-dice-drawer__dice-row" aria-label="Quick add dice">
          <button type="button" data-fb-dice-die="d4">d4</button>
          <button type="button" data-fb-dice-die="d6">d6</button>
          <button type="button" data-fb-dice-die="d8">d8</button>
          <button type="button" data-fb-dice-die="d10">d10</button>
          <button type="button" data-fb-dice-die="d12">d12</button>
          <button type="button" data-fb-dice-die="d20">d20</button>
        </div>
        <div class="fb-dice-drawer__actions">
          <button type="button" data-fb-dice-action="roll-custom">Roll custom</button>
        </div>
      </div>
    `;

    panel.addEventListener("input", handleDiceDraftInput);
    panel.addEventListener("click", handleDiceActionClick);
    panel.addEventListener("keydown", handleDiceDrawerKeydown);

    syncDiceDrawer(panel);
    return panel;
  }

  function removeDiceNativePanel() {
    getDiceNativePanel()?.remove();
  }

  function removeDiceScreenTray() {
    hideDiceScreenTray();
    getDiceScreenTray()?.remove();
  }

  function removeDiceRollerPanel() {
    getDiceRollerPanel()?.remove();
  }

  function mountDiceScreenTray() {
    if (!getExtensionSettings().diceEnabled) {
      removeDiceScreenTray();
      return false;
    }

    let tray = getDiceScreenTray();
    if (!(tray instanceof HTMLElement)) {
      tray = createDiceScreenTray();
    }

    if (tray.parentElement !== document.body) {
      document.body.appendChild(tray);
    }

    syncDiceScreenTray(tray);
    return true;
  }

  function mountDiceNativePanel() {
    const gameLogPane = getDiceGameLogPane();
    const gameLogButton = getDiceGameLogButton();

    if (!(gameLogButton instanceof HTMLElement) || !(gameLogPane instanceof HTMLElement)) {
      removeDiceNativePanel();
      resetDiceSidebarLayout();
      return false;
    }

    ensureDiceSidebarAlignedRight();
    document.body.classList.add(DICE_SIDEBAR_LAYOUT_BODY_CLASS);

    let panel = getDiceNativePanel();
    if (!(panel instanceof HTMLElement)) {
      panel = createDiceNativePanel();
    }

    if (panel.parentElement !== gameLogPane) {
      gameLogPane.replaceChildren(panel);
    }

    renderDiceRollHistory();
    return true;
  }

  function mountDiceRollerPanel() {
    if (!diceUiState.expanded) {
      removeDiceRollerPanel();
      return false;
    }

    const diceButton = getDiceDiceButton();
    if (!(diceButton instanceof HTMLButtonElement)) {
      removeDiceRollerPanel();
      return false;
    }

    let panel = getDiceRollerPanel();
    if (!(panel instanceof HTMLElement)) {
      panel = createDiceRollerPanel();
    }

    if (panel.parentElement !== document.body) {
      document.body.appendChild(panel);
    }

    syncDiceDrawer(panel);
    return true;
  }

  function mountDiceDrawer() {
    getDiceDrawerDock()?.remove();
    resetDiceSidebarLayout();

    if (!getExtensionSettings().diceEnabled) {
      destroyDiceVisualizer();
      destroyDiceEngine();
      removeDiceScreenTray();
      removeDiceNativePanel();
      removeDiceRollerPanel();
      getDiceDrawer()?.remove();
      const dock = getDiceDrawerDock();
      if (dock instanceof HTMLElement) {
        unwrapDiceDrawerDock(dock);
      }
      return false;
    }

    const standaloneDrawer = document.getElementById(DICE_DRAWER_ID);
    if (standaloneDrawer instanceof HTMLElement) {
      standaloneDrawer.remove();
    }

    const logMounted = mountDiceNativePanel();
    const rollerMounted = mountDiceRollerPanel();

    if (!logMounted && !rollerMounted) {
      getDiceDrawer()?.remove();
      return false;
    }

    if (!logMounted) {
      removeDiceNativePanel();
    }

    if (!rollerMounted) {
      removeDiceRollerPanel();
    }

    return logMounted || rollerMounted;
  }

  function setConfigStatus(message, state, modal = getConfigModal()) {
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

  function updateConfigFormDisabledState(settings, modal = getConfigModal()) {
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
    const diceModal = getDiceConfigModal();

    if (modal) {
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

      updateConfigFormDisabledState(settings, modal);
    }

    if (diceModal) {
      const diceEnabled = diceModal.querySelector("#fb-settings-dice-enabled");
      const diceSuppressNativeDice = diceModal.querySelector(
        "#fb-settings-dice-suppress-native-dice"
      );

      if (diceEnabled) {
        diceEnabled.checked = !!settings.diceEnabled;
      }

      if (diceSuppressNativeDice) {
        diceSuppressNativeDice.checked = !!settings.diceSuppressNativeDice;
      }
    }

    syncDiceConfigPanel();
  }

  function readConfigFormSettings() {
    const modal = getConfigModal();
    const diceModal = getDiceConfigModal();
    const settings = getExtensionSettings();

    return normalizeExtensionSettings({
      itemSlotsEnabled:
        modal?.querySelector("#fb-settings-item-slots-enabled")?.checked ??
        settings.itemSlotsEnabled,
      coinsHaveWeight:
        modal?.querySelector("#fb-settings-coins-have-weight")?.checked ??
        settings.coinsHaveWeight,
      coinsPerSlot:
        modal?.querySelector("#fb-settings-coins-per-slot")?.value ??
        settings.coinsPerSlot,
      shortRestHitDiceEnabled:
        modal?.querySelector("#fb-settings-short-rest-hit-dice-enabled")
          ?.checked ?? settings.shortRestHitDiceEnabled,
      diceEnabled:
        diceModal?.querySelector("#fb-settings-dice-enabled")?.checked ??
        settings.diceEnabled,
      diceSuppressNativeDice:
        diceModal?.querySelector("#fb-settings-dice-suppress-native-dice")
          ?.checked ?? settings.diceSuppressNativeDice,
    });
  }

  async function handleConfigFormChange(event) {
    const settings = readConfigFormSettings();
    const modal = event?.currentTarget?.closest(".fb-config-modal") || getConfigModal();
    syncConfigForm(settings);

    try {
      await saveExtensionSettings(settings);
      setConfigStatus("Saved.", "ok", modal);
      scheduleRefresh();
    } catch (error) {
      console.error("[Further Beyond] Could not save extension settings.", error);
      setConfigStatus("Could not save settings.", "error", modal);
      syncConfigForm(getExtensionSettings());
    }
  }

  function getConfigTriggerForModal(modal) {
    const modalId = modal instanceof HTMLElement ? modal.id : String(modal || "").trim();

    if (modalId === CONFIG_MODAL_ID) {
      return document.getElementById(CONFIG_TRIGGER_ID);
    }

    if (modalId === DICE_CONFIG_MODAL_ID) {
      return getDiceConfigTrigger();
    }

    return null;
  }

  function syncConfigModalOpenState() {
    const hasOpenModal = [getConfigModal(), getDiceConfigModal()].some(
      (modal) => modal instanceof HTMLElement && !modal.hidden
    );

    document.body.classList.toggle("fb-config-modal-open", hasOpenModal);
  }

  function closeConfigModal(modal = getConfigModal(), options = {}) {
    if (!(modal instanceof HTMLElement)) {
      return;
    }

    modal.hidden = true;
    syncConfigModalOpenState();

    const trigger = getConfigTriggerForModal(modal);
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");

      if (options.focusTrigger !== false) {
        trigger.focus();
      }
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
      closeConfigModal(event.currentTarget);
    }
  }

  function handleConfigModalKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfigModal(event.currentTarget);
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
    modal.addEventListener("input", handleDiceDraftInput);
    modal.addEventListener("change", handleDiceDraftInput);
    modal.addEventListener("click", handleDiceActionClick);
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

  function createDiceConfigModal() {
    const modal = document.createElement("div");

    modal.id = DICE_CONFIG_MODAL_ID;
    modal.className = "fb-config-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="fb-config-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="fb-dice-config-modal-title" tabindex="-1">
        <button type="button" class="fb-config-modal__close" data-fb-config-close="true" aria-label="Close Further Dice Roller settings">x</button>
        <header class="fb-config-modal__header">
          <p class="fb-config-modal__eyebrow">Further Dice Roller</p>
          <h2 id="fb-dice-config-modal-title">Integration Settings</h2>
          <p class="fb-config-modal__intro">Changes save automatically and apply immediately.</p>
        </header>
        <form class="fb-config-modal__form">
          <section class="fb-config-modal__card">
            <label class="fb-config-modal__toggle" for="fb-settings-dice-enabled">
              <span class="fb-config-modal__copy">
                <span class="fb-config-modal__label">Further Dice Roller</span>
                <span class="fb-config-modal__description">Uses Further Beyond's local dice roller on supported character-sheet roll targets and shows roll history in the Game Log.</span>
              </span>
              <input id="fb-settings-dice-enabled" type="checkbox" />
            </label>
          </section>
          <section class="fb-config-modal__card">
            <label class="fb-config-modal__toggle" for="fb-settings-dice-suppress-native-dice">
              <span class="fb-config-modal__copy">
                <span class="fb-config-modal__label">Only show Further Dice Roller rolls</span>
                <span class="fb-config-modal__description">When Further Beyond handles a supported native roll button, stop D&amp;D Beyond's own dice from triggering.</span>
              </span>
              <input id="fb-settings-dice-suppress-native-dice" type="checkbox" />
            </label>
          </section>
        </form>
        <section class="fb-config-modal__card fb-config-modal__dice-panel" data-fb-dice-role="config-panel">
          <div class="fb-config-modal__section-header">
            <div>
              <p class="fb-config-modal__eyebrow">Further Dice Roller</p>
              <h3 class="fb-config-modal__section-title">Local Roller</h3>
            </div>
            <span class="fb-dice-drawer__state" data-state="ready">Ready</span>
          </div>
          <p class="fb-dice-drawer__status">
            <span class="fb-dice-drawer__status-label">Status</span>
            <span class="fb-dice-drawer__status-copy">Simple local rolls are ready.</span>
          </p>
          <p class="fb-config-modal__hint" data-fb-dice-role="config-hint">
            Use D&amp;D Beyond's bottom-left dice button to open Further Dice Roller. Supported formulas include d20, 2d6 + 3, and 1d20 - 1.
          </p>
          <p class="fb-config-modal__hint">
            Rolls stay local and appear in the Game Log. External rooms, skins, and account linking are disabled.
          </p>
        </section>
        <p class="fb-config-modal__status" role="status" aria-live="polite"></p>
      </div>
    `;

    modal.addEventListener("click", handleConfigModalClick);
    modal.addEventListener("keydown", handleConfigModalKeydown);
    modal.addEventListener("input", handleDiceDraftInput);
    modal.addEventListener("change", handleDiceDraftInput);
    modal.addEventListener("click", handleDiceActionClick);
    modal.querySelector(".fb-config-modal__form")?.addEventListener(
      "change",
      handleConfigFormChange
    );

    return modal;
  }

  function ensureDiceConfigModal() {
    let modal = getDiceConfigModal();
    if (!modal) {
      modal = createDiceConfigModal();
      document.body.appendChild(modal);
    }

    syncConfigForm(getExtensionSettings());
    return modal;
  }

  function openConfigModal() {
    closeConfigModal(getDiceConfigModal(), { focusTrigger: false });

    const modal = ensureConfigModal();
    const dialog = modal.querySelector(".fb-config-modal__dialog");
    const firstField = modal.querySelector("#fb-settings-item-slots-enabled");

    syncConfigForm(getExtensionSettings());
    setConfigStatus("", "", modal);
    modal.hidden = false;
    syncConfigModalOpenState();
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

  function openDiceConfigModal() {
    closeConfigModal(getConfigModal(), { focusTrigger: false });

    const modal = ensureDiceConfigModal();
    const dialog = modal.querySelector(".fb-config-modal__dialog");
    const firstField = modal.querySelector("#fb-settings-dice-enabled");

    syncConfigForm(getExtensionSettings());
    setConfigStatus("", "", modal);
    modal.hidden = false;
    syncConfigModalOpenState();
    getDiceConfigTrigger()?.setAttribute("aria-expanded", "true");

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

  async function handleTakeShortRestCapture(event) {
    if (!getExtensionSettings().shortRestHitDiceEnabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    const button = event.currentTarget;
    if (button?.dataset?.fbTakeShortRestPending === "true") {
      return;
    }

    if (button instanceof HTMLButtonElement) {
      button.dataset.fbTakeShortRestPending = "true";
      button.disabled = true;
    }

    setShortRestStatus("Taking short rest...", "pending");

    try {
      await requestShortRestBridge("take-short-rest", getPendingShortRestUsage());
      shortRestUiState.dirty = false;
      scheduleRefresh();
    } catch (error) {
      console.error("[Further Beyond] Could not take short rest.", error);
      shortRestUiState.dirty = true;
      setShortRestStatus("Could not take short rest.", "error");
    } finally {
      if (button instanceof HTMLButtonElement && button.isConnected) {
        delete button.dataset.fbTakeShortRestPending;
        button.disabled = false;
      }
    }
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
      diceEnabled: value?.diceEnabled === true,
      diceSuppressNativeDice: value?.diceSuppressNativeDice !== false,
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

  function handleIntegratedDiceBridgeResponse(event) {
    const detail = event.detail || {};
    const pending = pageBridgeState.pendingIntegratedDiceRequests.get(
      detail.requestId
    );
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    pageBridgeState.pendingIntegratedDiceRequests.delete(detail.requestId);
    pending.cleanup();

    if (detail.ok) {
      pending.resolve(detail.metadata || null);
      return;
    }

    pending.reject(
      new Error(detail.error || "The integrated dice bridge failed.")
    );
  }

  function ensureIntegratedDiceBridgeListener() {
    if (pageBridgeState.integratedDiceListenerBound) {
      return;
    }

    window.addEventListener(
      INTEGRATED_DICE_RESPONSE_EVENT,
      handleIntegratedDiceBridgeResponse
    );
    pageBridgeState.integratedDiceListenerBound = true;
  }

  async function requestIntegratedDiceMetadata(button) {
    if (!(button instanceof HTMLButtonElement)) {
      return null;
    }

    ensureIntegratedDiceBridgeListener();
    await ensurePageBridge();

    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const targetToken = `${requestId}-${Math.random().toString(36).slice(2, 8)}`;
      const previousToken = button.dataset.fbDiceTarget || "";
      const cleanup = () => {
        if (button.dataset.fbDiceTarget !== targetToken) {
          return;
        }

        if (previousToken) {
          button.dataset.fbDiceTarget = previousToken;
        } else {
          delete button.dataset.fbDiceTarget;
        }
      };

      button.dataset.fbDiceTarget = targetToken;

      const timeoutId = window.setTimeout(() => {
        pageBridgeState.pendingIntegratedDiceRequests.delete(requestId);
        cleanup();
        reject(new Error("The integrated dice bridge timed out."));
      }, 3000);

      pageBridgeState.pendingIntegratedDiceRequests.set(requestId, {
        resolve,
        reject,
        timeoutId,
        cleanup,
      });

      window.dispatchEvent(
        new CustomEvent(INTEGRATED_DICE_REQUEST_EVENT, {
          detail: {
            requestId,
            targetToken,
          },
        })
      );
    });
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
    await ensureDiceLocalStateLoaded();
    mountDiceScreenTray();
    mountDiceDrawer();
    if (
      String(diceUiState.authToken || "").trim() &&
      normalizeDiceRoomSlug(diceUiState.activeRoomSlug) &&
      String(diceUiState.themeId || "").trim()
    ) {
      scheduleDiceVisualizerWarmup(getDiceScreenTray());
    }
    syncDiceSidebarAction(findDiceInfoSidebar());
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
  window.addEventListener("pointerdown", handleDiceNativeDicePressStart, true);
  window.addEventListener("mousedown", handleDiceNativeDicePressStart, true);
  window.addEventListener("click", handleDiceIntegratedDiceClick, true);
  window.addEventListener("click", handleDiceDiceButtonClick, true);
  window.addEventListener("resize", scheduleDiceDrawerPlacement, {
    passive: true,
  });
  window.addEventListener("scroll", scheduleDiceDrawerPlacement, {
    passive: true,
  });

  window.addEventListener(
    "pagehide",
    () => {
      delete window.__fbContentScriptInstalled;
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
      destroyDiceVisualizer();
      destroyDiceEngine();
      if (pageBridgeState.integratedDiceListenerBound) {
        window.removeEventListener(
          INTEGRATED_DICE_RESPONSE_EVENT,
          handleIntegratedDiceBridgeResponse
        );
      }
      if (
        extensionSettingsState.listenerBound &&
        chrome?.storage?.onChanged?.removeListener
      ) {
        chrome.storage.onChanged.removeListener(handleExtensionSettingsChange);
      }
      window.removeEventListener("pointerdown", handleDiceNativeDicePressStart, true);
      window.removeEventListener("mousedown", handleDiceNativeDicePressStart, true);
      window.removeEventListener("click", handleDiceIntegratedDiceClick, true);
      window.removeEventListener("click", handleDiceDiceButtonClick, true);
      window.removeEventListener("resize", scheduleDiceDrawerPlacement);
      window.removeEventListener("scroll", scheduleDiceDrawerPlacement);
      window.clearTimeout(diceRuntimeState.accountActivationPollTimeoutId);
      window.clearTimeout(settingsStatusTimeoutId);
      window.clearTimeout(shortRestStatusTimeoutId);
    },
    { once: true }
  );
})();
