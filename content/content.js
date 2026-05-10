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
  const DDDICE_DRAWER_ID = "fb-dddice-drawer";
  const DDDICE_NATIVE_PANEL_ID = "fb-dddice-native-panel";
  const DDDICE_ROLLER_PANEL_ID = "fb-dddice-roller-panel";
  const DDDICE_SCREEN_TRAY_ID = "fb-dddice-screen-tray";
  const DDDICE_DRAWER_DOCK_CLASS = "fb-dddice-dock";
  const DDDICE_SIDEBAR_LAYOUT_BODY_CLASS = "fb-dddice-sidebar-layout";
  const DDDICE_SIDEBAR_ACTION_CLASS = "fb-dddice-sidebar-action";
  const DDDICE_ROLL_HISTORY_LIMIT = 24;
  const DDDICE_VISUALIZER_AUTO_CLEAR_SECONDS = 2;
  const PAGE_BRIDGE_SCRIPT_ID = "fb-page-bridge";
  const INVENTORY_REQUEST_EVENT = "fb:inventory-request";
  const INVENTORY_RESPONSE_EVENT = "fb:inventory-response";
  const INTEGRATED_DICE_REQUEST_EVENT = "fb:integrated-dice-request";
  const INTEGRATED_DICE_RESPONSE_EVENT = "fb:integrated-dice-response";
  const SHORT_REST_REQUEST_EVENT = "fb:short-rest-request";
  const SHORT_REST_RESPONSE_EVENT = "fb:short-rest-response";
  const IGNORE_WEIGHT_STORAGE_KEY_PREFIX = "fb:ignored-weight:";
  const EXTENSION_SETTINGS_STORAGE_KEY = "fb:settings";
  const DDDICE_LOCAL_STATE_STORAGE_KEY = "fb:dddice:local-state";
  const DDDICE_API_BASE_URL = "https://dddice.com/api/1.0";
  const DDDICE_ACCOUNT_ACTIVATE_URL = "https://dddice.com/activate";
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
    dddiceEnabled: false,
    dddiceSuppressNativeDice: true,
  });
  const HEADING_SELECTORS = [
    "main .ddbc-character-tidbits__heading h1",
    "main h1.styles_characterName__2x8wQ",
    "main h1",
  ];
  const DDDICE_SKILL_NAMES = [
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
  const DDDICE_ABILITY_NAMES = [
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
  const dddiceUiState = {
    loaded: false,
    loadPromise: null,
    expanded: false,
    rollPending: false,
    connectionState: "idle",
    draftRoomSlug: "",
    draftRoomName: "",
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
  const dddiceRuntimeState = {
    engine: null,
    engineToken: "",
    connectedRoomSlug: "",
    syncPending: false,
    visualizer: null,
    visualizerToken: "",
    visualizerRoomSlug: "",
    visualizerThemeId: "",
    visualizerError: "",
    themeOptionsPromise: null,
    accountActivationSecret: "",
    accountActivationPollTimeoutId: null,
  };

  let refreshPending = false;
  let dddiceDrawerPlacementPending = false;
  let dddiceScreenTrayTimeoutId = null;
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

  function getDddiceDrawer() {
    return getDddiceRollerPanel() || document.getElementById(DDDICE_DRAWER_ID);
  }

  function getDddiceNativePanel() {
    return document.getElementById(DDDICE_NATIVE_PANEL_ID);
  }

  function getDddiceRollerPanel() {
    return document.getElementById(DDDICE_ROLLER_PANEL_ID);
  }

  function getDddiceScreenTray() {
    return document.getElementById(DDDICE_SCREEN_TRAY_ID);
  }

  function getDddiceConfigPanel() {
    const panel = getConfigModal()?.querySelector('[data-fb-dddice-role="config-panel"]');
    return panel instanceof HTMLElement ? panel : null;
  }

  function getDddiceDiceButton() {
    return (
      Array.from(
        document.querySelectorAll('.dice-rolling-panel button[class*="DiceContainer_button__"]')
      ).find((element) => element instanceof HTMLButtonElement && isElementVisible(element)) ||
      null
    );
  }

  function getDddiceDrawerDock() {
    return document.querySelector(`.${DDDICE_DRAWER_DOCK_CLASS}`);
  }

  function unwrapDddiceDrawerDock(dock) {
    if (!(dock instanceof HTMLElement) || !(dock.parentElement instanceof HTMLElement)) {
      return;
    }

    const parent = dock.parentElement;
    while (dock.firstChild) {
      parent.insertBefore(dock.firstChild, dock);
    }
    dock.remove();
  }

  function resetDddiceSidebarLayout() {
    document.body.classList.remove(DDDICE_SIDEBAR_LAYOUT_BODY_CLASS);
    document.body.style.removeProperty("--fb-dddice-sidebar-reserve");
  }

  function getDddiceVisualizerHost(preferredHost) {
    if (preferredHost instanceof HTMLElement) {
      return preferredHost;
    }

    return getDddiceScreenTray() || getDddiceRollerPanel() || getDddiceDrawer();
  }

  function getDddiceCanvas(host = getDddiceVisualizerHost()) {
    return host?.querySelector('[data-fb-dddice-role="canvas"]') || null;
  }

  function getDddiceGameLogButton() {
    return Array.from(document.querySelectorAll('[aria-roledescription="Game Log"]')).find(
      (element) => element instanceof HTMLElement
    ) || null;
  }

  function getDddiceGameLogPane() {
    const pane = document.querySelector('[data-testid="gamelog-pane"]');
    return pane instanceof HTMLElement ? pane : null;
  }

  function getDddiceNativeSidebar() {
    const sidebar = document.querySelector('.ct-sidebar__inner');
    return sidebar instanceof HTMLElement ? sidebar : null;
  }

  function getDddiceScreenTrayBoundsTarget() {
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

  async function ensureDddiceVisualizerHostVisible(allowOpen) {
    let host = getDddiceVisualizerHost();
    let canvas = getDddiceCanvas(host);

    if (canvas instanceof HTMLCanvasElement && isElementVisible(canvas)) {
      return host;
    }

    if (!allowOpen) {
      return null;
    }

    if (!getDddiceScreenTray()) {
      mountDddiceScreenTray();
      await waitForNextAnimationFrame();

      host = getDddiceVisualizerHost();
      canvas = getDddiceCanvas(host);

      if (canvas instanceof HTMLCanvasElement && isElementVisible(canvas)) {
        return host;
      }
    }

    if (!dddiceUiState.expanded) {
      updateDddiceUiState({ expanded: true });
      await waitForNextAnimationFrame();
    }

    host = getDddiceVisualizerHost();
    canvas = getDddiceCanvas(host);

    if (!(canvas instanceof HTMLCanvasElement) || !isElementVisible(canvas)) {
      return null;
    }

    return host;
  }

  function getDddiceSdk() {
    const sdk = globalThis.__fbDddiceSdk;

    if (
      !sdk ||
      typeof sdk.parseRollEquation !== "function" ||
      typeof sdk.ThreeDDiceAPI !== "function"
    ) {
      return null;
    }

    return sdk;
  }

  function normalizeDddiceRoomSlug(value) {
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

  function getDddiceRoomUrl(roomSlug) {
    const normalizedSlug = normalizeDddiceRoomSlug(roomSlug);
    if (!normalizedSlug) {
      return "";
    }

    return `https://dddice.com/room/${encodeURIComponent(normalizedSlug)}`;
  }

  function normalizeDddiceRoomRecord(value) {
    return {
      slug: normalizeDddiceRoomSlug(value?.slug || value?.custom_slug || ""),
      name: String(value?.name || "").trim(),
    };
  }

  function normalizeDddiceRollHistoryEntry(value) {
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
      label: String(value.label || value.equation || "DDDice Roll").trim(),
      equation: String(value.equation || "").trim(),
      total: String(value.total || "").trim(),
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
      values,
    };
  }

  function buildDddiceRollHistoryEntry(roll) {
    if (!roll || typeof roll !== "object") {
      return null;
    }

    const values = Array.isArray(roll.values)
      ? roll.values
          .filter((value) => !value?.is_dropped && !value?.is_cleared)
          .map((value) => ({
            type: String(value?.type || "die").trim() || "die",
            display: formatDddiceRollValueDisplay(value),
          }))
      : [];

    return normalizeDddiceRollHistoryEntry({
      id: String(roll.uuid || roll.id || `roll-${Date.now()}`),
      label: String(roll.label || roll.equation || "DDDice Roll").trim(),
      equation: String(roll.equation || "").trim(),
      total: formatDddiceRollTotalValue(roll.total_value),
      timestamp: Date.now(),
      values,
    });
  }

  function getDddiceConnectionState() {
    if (dddiceUiState.activeRoomSlug) {
      return "connected";
    }

    if (dddiceUiState.authToken) {
      return "ready";
    }

    return "idle";
  }

  function normalizeDddiceAuthKind(value) {
    return String(value || "").trim().toLowerCase() === "account"
      ? "account"
      : "guest";
  }

  function isDddiceAccountSession() {
    return normalizeDddiceAuthKind(dddiceUiState.authKind) === "account";
  }

  function getDddiceSessionActorLabel() {
    return isDddiceAccountSession() ? "Account" : "Guest";
  }

  function normalizeDddiceLocalState(value) {
    const rollHistory = Array.isArray(value?.rollHistory)
      ? value.rollHistory
          .map(normalizeDddiceRollHistoryEntry)
          .filter(Boolean)
          .slice(0, DDDICE_ROLL_HISTORY_LIMIT)
      : [];

    return {
      expanded: false,
      draftRoomSlug: String(value?.draftRoomSlug ?? value?.roomSlug ?? "").trim(),
      draftRoomName: String(value?.draftRoomName ?? value?.roomName ?? "").trim(),
      activeRoomSlug: normalizeDddiceRoomSlug(value?.activeRoomSlug || ""),
      activeRoomName: String(value?.activeRoomName || "").trim(),
      authKind: normalizeDddiceAuthKind(value?.authKind),
      authToken: String(value?.authToken || "").trim(),
      userName: String(value?.userName || "").trim(),
      userId: String(value?.userId || "").trim(),
      themeId: String(value?.themeId || "").trim(),
      rollHistory,
    };
  }

  function loadDddiceLocalState() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local?.get) {
        resolve(normalizeDddiceLocalState(null));
        return;
      }

      try {
        chrome.storage.local.get(DDDICE_LOCAL_STATE_STORAGE_KEY, (result) => {
          if (chrome.runtime?.lastError) {
            console.warn(
              "[Further Beyond] Could not load DDDice local state.",
              chrome.runtime.lastError
            );
            resolve(normalizeDddiceLocalState(null));
            return;
          }

          resolve(
            normalizeDddiceLocalState(result?.[DDDICE_LOCAL_STATE_STORAGE_KEY])
          );
        });
      } catch (error) {
        console.warn("[Further Beyond] Could not load DDDice local state.", error);
        resolve(normalizeDddiceLocalState(null));
      }
    });
  }

  function saveDddiceLocalState() {
    const localState = normalizeDddiceLocalState({
      expanded: dddiceUiState.expanded,
      draftRoomSlug: dddiceUiState.draftRoomSlug,
      draftRoomName: dddiceUiState.draftRoomName,
      activeRoomSlug: dddiceUiState.activeRoomSlug,
      activeRoomName: dddiceUiState.activeRoomName,
      authKind: dddiceUiState.authKind,
      authToken: dddiceUiState.authToken,
      userName: dddiceUiState.userName,
      userId: dddiceUiState.userId,
      themeId: dddiceUiState.themeId,
      rollHistory: dddiceUiState.rollHistory,
    });

    return new Promise((resolve) => {
      if (!chrome?.storage?.local?.set) {
        resolve(localState);
        return;
      }

      try {
        chrome.storage.local.set(
          {
            [DDDICE_LOCAL_STATE_STORAGE_KEY]: localState,
          },
          () => {
            if (chrome.runtime?.lastError) {
              console.warn(
                "[Further Beyond] Could not save DDDice local state.",
                chrome.runtime.lastError
              );
            }

            resolve(localState);
          }
        );
      } catch (error) {
        console.warn("[Further Beyond] Could not save DDDice local state.", error);
        resolve(localState);
      }
    });
  }

  async function ensureDddiceLocalStateLoaded() {
    if (dddiceUiState.loaded) {
      return dddiceUiState;
    }

    if (dddiceUiState.loadPromise) {
      return dddiceUiState.loadPromise;
    }

    dddiceUiState.loadPromise = loadDddiceLocalState()
      .then((localState) => {
        dddiceUiState.expanded = localState.expanded;
        dddiceUiState.draftRoomSlug = localState.draftRoomSlug;
        dddiceUiState.draftRoomName = localState.draftRoomName;
        dddiceUiState.activeRoomSlug = localState.activeRoomSlug;
        dddiceUiState.activeRoomName = localState.activeRoomName;
        dddiceUiState.authKind = localState.authKind;
        dddiceUiState.authToken = localState.authToken;
        dddiceUiState.userName = localState.userName;
        dddiceUiState.userId = localState.userId;
        dddiceUiState.themeId = localState.themeId;
        dddiceUiState.rollHistory = localState.rollHistory;
        dddiceUiState.connectionState = getDddiceConnectionState();
        dddiceUiState.loaded = true;
        return dddiceUiState;
      })
      .finally(() => {
        dddiceUiState.loadPromise = null;
      });

    return dddiceUiState.loadPromise;
  }

  function getDddiceStateLabel() {
    if (dddiceUiState.accountActivationPending && !dddiceUiState.authToken) {
      return "Linking";
    }

    if (dddiceUiState.connectionState === "connected") {
      return "Connected";
    }

    if (dddiceUiState.connectionState === "ready") {
      return "Ready";
    }

    if (dddiceUiState.connectionState === "connecting") {
      return "Connecting";
    }

    if (dddiceUiState.connectionState === "error") {
      return "Attention";
    }

    return `${getDddiceSessionActorLabel()} mode`;
  }

  function getDddiceStatusMessage() {
    if (dddiceUiState.statusMessage) {
      return dddiceUiState.statusMessage;
    }

    if (dddiceUiState.connectionState === "connected") {
      if (dddiceUiState.activeRoomName) {
        return `Connected to ${dddiceUiState.activeRoomName}.`;
      }

      if (dddiceUiState.activeRoomSlug) {
        return `Connected to room ${dddiceUiState.activeRoomSlug}.`;
      }

      return "Connected to DDDice.";
    }

    if (dddiceUiState.connectionState === "ready") {
      if (dddiceUiState.userName) {
        return `${getDddiceSessionActorLabel()} session ready as ${dddiceUiState.userName}.`;
      }

      return `${getDddiceSessionActorLabel()} session ready.`;
    }

    if (dddiceUiState.connectionState === "connecting") {
      return `Connecting ${getDddiceSessionActorLabel().toLowerCase()} session...`;
    }

    if (dddiceUiState.connectionState === "error") {
      return "DDDice needs attention before it can roll.";
    }

    if (dddiceUiState.draftRoomName || dddiceUiState.draftRoomSlug) {
      return "Room draft saved locally.";
    }

    return `${getDddiceSessionActorLabel()} setup has not started yet.`;
  }

  function getDddiceRoomLabel() {
    if (dddiceUiState.activeRoomName) {
      return dddiceUiState.activeRoomName;
    }

    if (dddiceUiState.activeRoomSlug) {
      return `Room ${dddiceUiState.activeRoomSlug}`;
    }

    return "";
  }

  function getDddiceUserLabel() {
    if (dddiceUiState.userName) {
      return dddiceUiState.userName;
    }

    if (dddiceUiState.userId) {
      return dddiceUiState.userId;
    }

    return "";
  }

  function findDddiceInfoSidebar() {
    return Array.from(document.querySelectorAll('[role="dialog"]')).find(
      (dialog) => dialog.id !== CONFIG_MODAL_ID && !dialog.closest(`#${CONFIG_MODAL_ID}`)
    );
  }

  function parseDddiceSidebarModifier(text) {
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

  function formatDddiceSidebarExpression(modifier) {
    if (!Number.isFinite(modifier)) {
      return "";
    }

    return modifier >= 0 ? `d20 + ${modifier}` : `d20 - ${Math.abs(modifier)}`;
  }

  function buildDddiceSidebarRollDefinition(dialog) {
    if (!(dialog instanceof HTMLElement)) {
      return null;
    }

    const heading = dialog.querySelector("h1, h2");
    const headingText = normalizeText(heading?.textContent || "");
    const headingLower = headingText.toLowerCase();
    const modifier = parseDddiceSidebarModifier(headingText);

    if (!headingText || !Number.isFinite(modifier)) {
      return null;
    }

    const skillName = DDDICE_SKILL_NAMES.find((name) =>
      headingLower.includes(name.toLowerCase())
    );
    if (skillName) {
      return {
        label: skillName,
        expression: formatDddiceSidebarExpression(modifier),
      };
    }

    if (headingLower.includes("initiative")) {
      return {
        label: "Initiative",
        expression: formatDddiceSidebarExpression(modifier),
      };
    }

    const abilityName = DDDICE_ABILITY_NAMES.find(
      (name) =>
        headingLower.includes(name.toLowerCase()) && headingLower.includes("saving")
    );
    if (abilityName) {
      return {
        label: `${abilityName} Save`,
        expression: formatDddiceSidebarExpression(modifier),
      };
    }

    const abilityCheckName = DDDICE_ABILITY_NAMES.find((name) =>
      headingLower.includes(name.toLowerCase())
    );
    if (abilityCheckName) {
      return {
        label: `${abilityCheckName} Check`,
        expression: formatDddiceSidebarExpression(modifier),
      };
    }

    return null;
  }

  function canUseDddiceNativeRolls() {
    return (
      getExtensionSettings().dddiceEnabled &&
      dddiceUiState.loaded &&
      dddiceUiState.connectionState !== "connecting" &&
      !!dddiceUiState.authToken &&
      !!dddiceUiState.activeRoomSlug &&
      !!dddiceUiState.themeId &&
      !!getDddiceSdk()
    );
  }

  function shouldSuppressDddiceNativeDice() {
    return !!getExtensionSettings().dddiceSuppressNativeDice;
  }

  function getDddiceNativeDiceButton(target) {
    if (!(target instanceof Element) || !canUseDddiceNativeRolls()) {
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

  function stopDddiceNativeDiceEvent(event, preventDefault = true) {
    if (preventDefault) {
      event.preventDefault();
    }

    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  function trimDddiceAttackLabel(value) {
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

  function getDddiceCombatAttackLabel(attackRow) {
    if (!(attackRow instanceof HTMLElement)) {
      return "";
    }

    const nameElement = attackRow.querySelector(".ddbc-combat-attack__name");
    if (!(nameElement instanceof HTMLElement)) {
      return "";
    }

    const directText = trimDddiceAttackLabel(
      Array.from(nameElement.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
    );
    if (directText) {
      return directText;
    }

    const firstMeaningfulChildText = Array.from(nameElement.children)
      .map((child) => trimDddiceAttackLabel(child.textContent || ""))
      .find(Boolean);
    if (firstMeaningfulChildText) {
      return firstMeaningfulChildText;
    }

    return trimDddiceAttackLabel(nameElement.textContent || "");
  }

  function findDddiceNativeSidebar() {
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

  function syncDddiceDrawerPlacement(drawer) {
    if (!(drawer instanceof HTMLElement)) {
      return;
    }

    if (drawer.classList.contains("fb-dddice-drawer--embedded")) {
      drawer.dataset.layout = "embedded";
      drawer.style.removeProperty("--fb-dddice-sidebar-left");
      drawer.style.removeProperty("--fb-dddice-sidebar-top");
      drawer.style.removeProperty("--fb-dddice-sidebar-width");
      drawer.style.removeProperty("--fb-dddice-sidebar-height");
      return;
    }

    if (drawer.classList.contains("fb-dddice-drawer--roller")) {
      const diceButton = getDddiceDiceButton();
      const buttonRect = diceButton?.getBoundingClientRect();
      const gap = 12;

      drawer.dataset.layout = "roller";
      if (!buttonRect) {
        return;
      }

      drawer.style.setProperty("--fb-dddice-roller-left", `${Math.max(10, Math.round(buttonRect.left))}px`);
      drawer.style.setProperty(
        "--fb-dddice-roller-bottom",
        `${Math.max(72, Math.round(window.innerHeight - buttonRect.top + gap))}px`
      );
      return;
    }

    const dock = getDddiceDrawerDock();
    if (dock instanceof HTMLElement) {
      unwrapDddiceDrawerDock(dock);
    }

    if (drawer.parentElement !== document.body) {
      document.body.appendChild(drawer);
    }

    const sidebar = findDddiceNativeSidebar();
    const sidebarRect = sidebar?.getBoundingClientRect();
    const minimumViewportWidth = 1280;

    if (
      !(sidebar instanceof HTMLElement) ||
      !sidebarRect ||
      window.innerWidth < minimumViewportWidth
    ) {
      drawer.dataset.layout = "floating";
      drawer.style.removeProperty("--fb-dddice-sidebar-left");
      drawer.style.removeProperty("--fb-dddice-sidebar-top");
      drawer.style.removeProperty("--fb-dddice-sidebar-width");
      drawer.style.removeProperty("--fb-dddice-sidebar-height");
      resetDddiceSidebarLayout();
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
      drawer.style.removeProperty("--fb-dddice-sidebar-left");
      drawer.style.removeProperty("--fb-dddice-sidebar-top");
      drawer.style.removeProperty("--fb-dddice-sidebar-width");
      drawer.style.removeProperty("--fb-dddice-sidebar-height");
      resetDddiceSidebarLayout();
      return;
    }

    drawer.dataset.layout = "sidebar";
    drawer.style.setProperty("--fb-dddice-sidebar-left", `${panelLeft}px`);
    drawer.style.setProperty("--fb-dddice-sidebar-top", `${panelTop}px`);
    drawer.style.setProperty("--fb-dddice-sidebar-width", `${panelWidth}px`);
    drawer.style.setProperty("--fb-dddice-sidebar-height", `${panelHeight}px`);

    const reserveWidth = sheetInnerRect
      ? Math.max(
          panelWidth + gap,
          Math.ceil(sheetInnerRect.right - (panelLeft - window.scrollX) + 24)
        )
      : panelWidth + gap;

    document.body.classList.add(DDDICE_SIDEBAR_LAYOUT_BODY_CLASS);
    document.body.style.setProperty(
      "--fb-dddice-sidebar-reserve",
      `${reserveWidth}px`
    );
  }

  function scheduleDddiceDrawerPlacement() {
    if (dddiceDrawerPlacementPending) {
      return;
    }

    dddiceDrawerPlacementPending = true;
    window.requestAnimationFrame(() => {
      dddiceDrawerPlacementPending = false;
      syncDddiceDrawerPlacement(getDddiceRollerPanel() || getDddiceDrawer());
      syncDddiceScreenTray();
    });
  }

  function getDddiceIntegratedDiceContext(button) {
    if (!(button instanceof HTMLButtonElement)) {
      return null;
    }

    const attackRow = button.closest(".ddbc-combat-attack");
    if (attackRow instanceof HTMLElement) {
      const attackName = getDddiceCombatAttackLabel(attackRow);
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

  function formatDddiceActionEffectLabel(labelBase, damageType) {
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

  function buildDddiceIntegratedDiceRollDefinition(button, metadata) {
    const context = getDddiceIntegratedDiceContext(button);
    if (!context || !metadata) {
      return null;
    }

    if (context.kind === "modifier" && Number.isFinite(metadata.modifier)) {
      return {
        label: context.label,
        expression: formatDddiceSidebarExpression(metadata.modifier),
      };
    }

    if (
      context.kind === "damage" &&
      typeof metadata.expression === "string" &&
      metadata.expression.trim()
    ) {
      return {
        label: formatDddiceActionEffectLabel(
          context.labelBase,
          metadata.damageType
        ),
        expression: metadata.expression.trim(),
      };
    }

    return null;
  }

  function getDddiceCanvasStatusMessage(hasSdk, hasSession, hasRoom) {
    if (dddiceRuntimeState.visualizerError) {
      return dddiceRuntimeState.visualizerError;
    }

    if (!hasSdk) {
      return "Local DDDice SDK bundle is unavailable.";
    }

    if (!hasSession) {
      return "Connect a DDDice guest or account session to start the 3D DDDice tray.";
    }

    if (!hasRoom) {
      return "Create or join a room to target DDDice rolls.";
    }

    if (dddiceUiState.activeRoomName) {
      return `3D DDDice is ready for ${dddiceUiState.activeRoomName}. Rolls animate here after they post to the room.`;
    }

    if (dddiceUiState.activeRoomSlug) {
      return `3D DDDice is ready for ${dddiceUiState.activeRoomSlug}. Rolls animate here after they post to the room.`;
    }

    return "Rolls animate here when you roll.";
  }

  function formatDddiceRollTotalValue(totalValue) {
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

  function formatDddiceRollValueDisplay(rollValue) {
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

  function formatDddiceRollHistoryTimestamp(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function splitDddiceRollHistoryLabel(label) {
    const normalizedLabel = String(label || "DDDice Roll").trim() || "DDDice Roll";
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

  function getDddicePrimaryDieType(entry) {
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

  function formatDddiceDieTypeLabel(dieType) {
    const normalizedDieType = String(dieType || "d20").trim().toLowerCase();
    return normalizedDieType === "d100" ? "D%" : normalizedDieType.toUpperCase();
  }

  function formatDddiceRollValueSummary(values) {
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

  function renderDddiceRollHistory() {
    const logList = getDddiceNativePanel()?.querySelector(
      '[data-fb-dddice-role="log-list"]'
    );
    if (!(logList instanceof HTMLElement)) {
      return;
    }

    if (!dddiceUiState.rollHistory.length) {
      const emptyState = document.createElement("p");
      emptyState.className = "fb-dddice-log__empty";
      emptyState.textContent = "Your DDDice rolls will show up here.";
      logList.replaceChildren(emptyState);
      return;
    }

    const entries = [...dddiceUiState.rollHistory]
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
      const labelParts = splitDddiceRollHistoryLabel(entry.label);
      const dieType = getDddicePrimaryDieType(entry);
      const summaryText =
        formatDddiceRollValueSummary(entry.values) ||
        entry.total ||
        entry.equation ||
        "Roll";

      article.className = "fb-dddice-log__entry";
      header.className = "fb-dddice-log__entry-header";
      heading.className = "fb-dddice-log__entry-heading";
      title.className = "fb-dddice-log__entry-title";
      accent.className = "fb-dddice-log__entry-accent";
      time.className = "fb-dddice-log__entry-time";
      body.className = "fb-dddice-log__entry-body";
      roll.className = "fb-dddice-log__entry-roll";
      dieIcon.className = "fb-dddice-log__entry-die-icon";
      meta.className = "fb-dddice-log__entry-meta";
      summary.className = "fb-dddice-log__entry-summary";
      equation.className = "fb-dddice-log__entry-equation";
      result.className = "fb-dddice-log__entry-result";
      equals.className = "fb-dddice-log__entry-equals";
      total.className = "fb-dddice-log__entry-total";

      title.textContent = labelParts.accent ? `${labelParts.title}:` : labelParts.title;
      accent.textContent = labelParts.accent;
      time.textContent = formatDddiceRollHistoryTimestamp(entry.timestamp);
      dieIcon.dataset.die = dieType;
      dieIcon.textContent = formatDddiceDieTypeLabel(dieType);
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

  function scrollDddiceRollHistoryToBottom() {
    const panel = getDddiceNativePanel();
    if (!(panel instanceof HTMLElement)) {
      return;
    }

    let scrollContainer = panel;
    let currentElement = panel;

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

  function appendDddiceRollHistory(roll) {
    const entry = buildDddiceRollHistoryEntry(roll);
    if (!entry) {
      return;
    }

    dddiceUiState.rollHistory = [
      ...dddiceUiState.rollHistory.filter((existingEntry) => existingEntry.id !== entry.id),
      entry,
    ]
      .sort((left, right) => left.timestamp - right.timestamp)
      .slice(-DDDICE_ROLL_HISTORY_LIMIT);

    renderDddiceRollHistory();
    scrollDddiceRollHistoryToBottom();
    void saveDddiceLocalState();
  }

  function renderDddiceRollOutput(roll, host = getDddiceDrawer()) {
    const output = host?.querySelector(
      '[data-fb-dddice-role="roll-output"]'
    );
    if (!(output instanceof HTMLElement) || !roll || typeof roll !== "object") {
      return;
    }

    const summary = document.createElement("div");
    const title = document.createElement("span");
    const total = document.createElement("strong");
    const diceList = document.createElement("div");
    const totalText = formatDddiceRollTotalValue(roll.total_value);
    const values = Array.isArray(roll.values)
      ? roll.values.filter((value) => !value?.is_dropped && !value?.is_cleared)
      : [];

    summary.className = "fb-dddice-drawer__roll-summary";
    title.className = "fb-dddice-drawer__roll-title";
    total.className = "fb-dddice-drawer__roll-total";
    diceList.className = "fb-dddice-drawer__roll-dice";

    title.textContent = String(roll.label || roll.equation || "Latest roll").trim();
    total.textContent = totalText ? `Total ${totalText}` : "";
    summary.append(title, total);

    values.forEach((rollValue) => {
      const die = document.createElement("span");
      const dieType = document.createElement("span");
      const dieValue = document.createElement("strong");

      die.className = "fb-dddice-drawer__die";
      if (rollValue.type === "mod") {
        die.dataset.kind = "modifier";
      }

      dieType.className = "fb-dddice-drawer__die-type";
      dieValue.className = "fb-dddice-drawer__die-value";

      dieType.textContent =
        rollValue.type === "mod"
          ? "mod"
          : String(rollValue.type || "die").toUpperCase();
      dieValue.textContent = formatDddiceRollValueDisplay(rollValue);
      die.append(dieType, dieValue);
      diceList.appendChild(die);
    });

    output.hidden = false;
    output.removeAttribute("data-animate");
    output.replaceChildren(summary, diceList);
    void output.offsetWidth;
    output.dataset.animate = "true";
  }

  function hideDddiceRollOutput(host = getDddiceVisualizerHost()) {
    const output = host?.querySelector('[data-fb-dddice-role="roll-output"]');
    if (!(output instanceof HTMLElement)) {
      return;
    }

    output.hidden = true;
    output.removeAttribute("data-animate");
  }

  function syncDddiceScreenTrayPlacement(tray = getDddiceScreenTray()) {
    if (!(tray instanceof HTMLElement)) {
      return;
    }

    const target = getDddiceScreenTrayBoundsTarget();
    const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : null;

    if (!rect || rect.width < 240 || rect.height < 240) {
      tray.hidden = true;
      tray.style.removeProperty("--fb-dddice-screen-left");
      tray.style.removeProperty("--fb-dddice-screen-top");
      tray.style.removeProperty("--fb-dddice-screen-width");
      tray.style.removeProperty("--fb-dddice-screen-height");
      return;
    }

    tray.hidden = false;
    tray.style.setProperty("--fb-dddice-screen-left", `${Math.round(rect.left)}px`);
    tray.style.setProperty("--fb-dddice-screen-top", `${Math.round(rect.top)}px`);
    tray.style.setProperty("--fb-dddice-screen-width", `${Math.round(rect.width)}px`);
    tray.style.setProperty("--fb-dddice-screen-height", `${Math.round(rect.height)}px`);
  }

  function syncDddiceScreenTray(tray = getDddiceScreenTray()) {
    if (!(tray instanceof HTMLElement)) {
      return;
    }

    syncDddiceScreenTrayPlacement(tray);
  }

  function hideDddiceScreenTray() {
    window.clearTimeout(dddiceScreenTrayTimeoutId);
    dddiceScreenTrayTimeoutId = null;

    const tray = getDddiceScreenTray();
    if (!(tray instanceof HTMLElement)) {
      return;
    }

    tray.remove();
  }

  function scheduleHideDddiceScreenTray() {
    window.clearTimeout(dddiceScreenTrayTimeoutId);
    dddiceScreenTrayTimeoutId = null;
  }

  function showDddiceScreenTray() {
    return mountDddiceScreenTray() ? getDddiceScreenTray() : null;
  }

  function syncDddiceStage(drawer, hasSdk, hasSession, hasRoom) {
    if (!(drawer instanceof HTMLElement)) {
      return;
    }

    const diceStage = drawer.querySelector(".fb-dddice-drawer__stage");
    const diceStageStatus = drawer.querySelector(
      '[data-fb-dddice-role="canvas-status"]'
    );
    const stageState = dddiceRuntimeState.visualizerError
      ? "error"
      : !hasSdk
        ? "error"
        : hasRoom
          ? "connected"
          : hasSession
            ? "ready"
            : "idle";

    if (diceStage instanceof HTMLElement) {
      diceStage.dataset.state = stageState;
    }

    if (diceStageStatus instanceof HTMLElement) {
      diceStageStatus.textContent = getDddiceCanvasStatusMessage(
        hasSdk,
        hasSession,
        hasRoom
      );
    }
  }

  function syncDddiceDrawer(drawer) {
    if (!(drawer instanceof HTMLElement)) {
      return;
    }

    const isEmbedded = drawer.classList.contains("fb-dddice-drawer--embedded");
    if (isEmbedded) {
      drawer.dataset.layout = "embedded";
    }

    const toggle = drawer.querySelector(".fb-dddice-drawer__toggle");
    const toggleCopy = drawer.querySelector(".fb-dddice-drawer__toggle-copy");
    const panel = drawer.querySelector(".fb-dddice-drawer__panel");
    const state = drawer.querySelector(".fb-dddice-drawer__state");
    const statusCopy = drawer.querySelector(".fb-dddice-drawer__status-copy");
    const diceStage = drawer.querySelector(".fb-dddice-drawer__stage");
    const diceStageStatus = drawer.querySelector(
      '[data-fb-dddice-role="canvas-status"]'
    );
    const user = drawer.querySelector(".fb-dddice-drawer__user");
    const userKind = drawer.querySelector('[data-fb-dddice-role="user-kind"]');
    const userValue = drawer.querySelector(".fb-dddice-drawer__user-value");
    const room = drawer.querySelector(".fb-dddice-drawer__room");
    const roomValue = drawer.querySelector(".fb-dddice-drawer__room-value");
    const roomNameInput = drawer.querySelector('[data-fb-dddice-field="draftRoomName"]');
    const roomSlugInput = drawer.querySelector('[data-fb-dddice-field="draftRoomSlug"]');
    const roomConfig = drawer.querySelector('[data-fb-dddice-role="room-config"]');
    const connectButton = drawer.querySelector(
      '[data-fb-dddice-action="connect-guest"]'
    );
    const createRoomButton = drawer.querySelector(
      '[data-fb-dddice-action="create-room"]'
    );
    const joinRoomButton = drawer.querySelector(
      '[data-fb-dddice-action="join-room"]'
    );
    const rollCustomButton = drawer.querySelector(
      '[data-fb-dddice-action="roll-custom"]'
    );
    const view3dRoomButton = drawer.querySelector(
      '[data-fb-dddice-action="open-3d-room"]'
    );
    const customRollInput = drawer.querySelector(
      '[data-fb-dddice-role="custom-roll-input"]'
    );
    const quickAddButtons = Array.from(
      drawer.querySelectorAll('[data-fb-dddice-die]')
    );
    const roomLabel = getDddiceRoomLabel();
    const userLabel = getDddiceUserLabel();
    const isConnecting = dddiceUiState.connectionState === "connecting";
    const isRolling = !!dddiceUiState.rollPending;
    const isBusy = isConnecting || isRolling;
    const hasSdk = !!getDddiceSdk();
    const hasSession = !!dddiceUiState.authToken;
    const hasRoomDraft = !!normalizeDddiceRoomSlug(dddiceUiState.draftRoomSlug);
    const hasTheme = !!dddiceUiState.themeId;
    const hasActiveRoom = !!dddiceUiState.activeRoomSlug;
    const canComposeCustomRoll = !isBusy && hasSession && hasTheme && hasSdk;
    const canSubmitCustomRoll =
      canComposeCustomRoll && hasActiveRoom;
    const hasCustomFormula =
      customRollInput instanceof HTMLInputElement &&
      !!String(customRollInput.value || "").trim();

    drawer.dataset.expanded = isEmbedded || dddiceUiState.expanded ? "true" : "false";

    if (toggle instanceof HTMLElement) {
      toggle.setAttribute(
        "aria-expanded",
        isEmbedded || dddiceUiState.expanded ? "true" : "false"
      );
    }

    if (toggleCopy) {
      toggleCopy.textContent = dddiceUiState.expanded ? "Hide" : "Open";
    }

    if (panel instanceof HTMLElement) {
      panel.hidden = isEmbedded ? false : !dddiceUiState.expanded;
    }

    if (state instanceof HTMLElement) {
      state.textContent = getDddiceStateLabel();
      state.dataset.state = dddiceUiState.connectionState;
    }

    if (statusCopy) {
      statusCopy.textContent = getDddiceStatusMessage();
    }

    syncDddiceStage(drawer, hasSdk, hasSession, hasActiveRoom);

    if (user instanceof HTMLElement) {
      user.hidden = !userLabel;
    }

    if (userKind instanceof HTMLElement) {
      userKind.textContent = getDddiceSessionActorLabel();
    }

    if (userValue) {
      userValue.textContent = userLabel;
    }

    if (room instanceof HTMLElement) {
      room.hidden = !roomLabel;
    }

    if (roomValue) {
      roomValue.textContent = roomLabel;
    }

    if (
      roomNameInput instanceof HTMLInputElement &&
      roomNameInput.value !== dddiceUiState.draftRoomName
    ) {
      roomNameInput.value = dddiceUiState.draftRoomName;
    }

    if (
      roomSlugInput instanceof HTMLInputElement &&
      roomSlugInput.value !== dddiceUiState.draftRoomSlug
    ) {
      roomSlugInput.value = dddiceUiState.draftRoomSlug;
    }

    if (roomNameInput instanceof HTMLInputElement) {
      roomNameInput.disabled = isBusy;
    }

    if (roomSlugInput instanceof HTMLInputElement) {
      roomSlugInput.disabled = isBusy;
    }

    if (roomConfig instanceof HTMLDetailsElement) {
      const needsRoomSetup = !hasSession || !hasActiveRoom;
      const wasAutoOpened =
        roomConfig.dataset.fbDddiceAutoRoomConfig === "true";

      if (needsRoomSetup) {
        roomConfig.open = true;
        roomConfig.dataset.fbDddiceAutoRoomConfig = "true";
      } else if (wasAutoOpened) {
        roomConfig.open = false;
        roomConfig.dataset.fbDddiceAutoRoomConfig = "false";
      }
    }

    if (connectButton instanceof HTMLButtonElement) {
      connectButton.disabled = isBusy;
      connectButton.textContent = isDddiceAccountSession()
        ? "Switch to guest"
        : hasSession
          ? "Refresh guest"
          : "Connect guest";
    }

    if (createRoomButton instanceof HTMLButtonElement) {
      createRoomButton.disabled = isBusy || !hasSession;
    }

    if (joinRoomButton instanceof HTMLButtonElement) {
      joinRoomButton.disabled = isBusy || !hasSession || !hasRoomDraft;
    }

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

    if (view3dRoomButton instanceof HTMLButtonElement) {
      view3dRoomButton.disabled = !hasActiveRoom;
    }

    if (dddiceRuntimeState.engine) {
      dddiceRuntimeState.connectedRoomSlug = hasActiveRoom
        ? normalizeDddiceRoomSlug(dddiceUiState.activeRoomSlug)
        : "";
    }

    renderDddiceRollHistory();
    syncDddiceScreenTray();
    syncDddiceVisualizer();
    scheduleDddiceDrawerPlacement();
  }

  function syncDddiceConfigPanel(panel = getDddiceConfigPanel()) {
    if (!(panel instanceof HTMLElement)) {
      return;
    }

    const integrationEnabled = !!getExtensionSettings().dddiceEnabled;
    const userLabel = getDddiceUserLabel();
    const roomLabel = getDddiceRoomLabel();
    const isBusy = dddiceUiState.connectionState === "connecting";
    const hasSession = !!dddiceUiState.authToken;
    const hasRoomDraft = !!normalizeDddiceRoomSlug(dddiceUiState.draftRoomSlug);
    const hasActiveRoom = !!dddiceUiState.activeRoomSlug;
    const state = panel.querySelector(".fb-dddice-drawer__state");
    const statusCopy = panel.querySelector(".fb-dddice-drawer__status-copy");
    const configHint = panel.querySelector('[data-fb-dddice-role="config-hint"]');
    const user = panel.querySelector(".fb-dddice-drawer__user");
    const userKind = panel.querySelector('[data-fb-dddice-role="user-kind"]');
    const userValue = panel.querySelector(".fb-dddice-drawer__user-value");
    const room = panel.querySelector(".fb-dddice-drawer__room");
    const roomValue = panel.querySelector(".fb-dddice-drawer__room-value");
    const roomNameInput = panel.querySelector('[data-fb-dddice-field="draftRoomName"]');
    const roomSlugInput = panel.querySelector('[data-fb-dddice-field="draftRoomSlug"]');
    const themeSelect = panel.querySelector('[data-fb-dddice-field="themeId"]');
    const themeHint = panel.querySelector('[data-fb-dddice-role="theme-hint"]');
    const connectButton = panel.querySelector('[data-fb-dddice-action="connect-guest"]');
    const accountButton = panel.querySelector('[data-fb-dddice-action="connect-account"]');
    const createRoomButton = panel.querySelector('[data-fb-dddice-action="create-room"]');
    const joinRoomButton = panel.querySelector('[data-fb-dddice-action="join-room"]');
    const view3dRoomButton = panel.querySelector('[data-fb-dddice-action="open-3d-room"]');
    const accountActivation = panel.querySelector('[data-fb-dddice-role="account-activation"]');
    const activationCode = panel.querySelector('[data-fb-dddice-role="activation-code"]');
    const activationCopy = panel.querySelector('[data-fb-dddice-role="activation-copy"]');
    const openActivationButton = panel.querySelector(
      '[data-fb-dddice-action="open-account-activation"]'
    );
    const cancelActivationButton = panel.querySelector(
      '[data-fb-dddice-action="cancel-account-connect"]'
    );
    const availableThemes = Array.isArray(dddiceUiState.availableThemes)
      ? dddiceUiState.availableThemes
      : [];
    const isAccountLinkPending =
      !!dddiceUiState.accountActivationPending &&
      !!String(dddiceUiState.accountActivationCode || "").trim();
    const selectedThemeId = String(dddiceUiState.themeId || "").trim();
    const fallbackThemeLabel = selectedThemeId || "Current skin";
    const themeOptions = availableThemes.length
      ? availableThemes
      : selectedThemeId
        ? [{ id: selectedThemeId, name: fallbackThemeLabel }]
        : [];

    panel.dataset.enabled = integrationEnabled ? "true" : "false";

    if (state instanceof HTMLElement) {
      state.textContent = integrationEnabled ? getDddiceStateLabel() : "Disabled";
      state.dataset.state = integrationEnabled ? dddiceUiState.connectionState : "idle";
    }

    if (statusCopy instanceof HTMLElement) {
      statusCopy.textContent = integrationEnabled
        ? getDddiceStatusMessage()
        : "Enable DDDice dice replacement above to override D&D Beyond's dice button and Game Log.";
    }

    if (configHint instanceof HTMLElement) {
      configHint.textContent = hasActiveRoom
        ? "Use D&D Beyond's bottom-left dice button to open the DDDice custom roller."
        : "Connect a guest or link your DDDice account here, then join or create a room before rolling from D&D Beyond.";
    }

    if (user instanceof HTMLElement) {
      user.hidden = !userLabel;
    }

    if (userKind instanceof HTMLElement) {
      userKind.textContent = getDddiceSessionActorLabel();
    }

    if (userValue instanceof HTMLElement) {
      userValue.textContent = userLabel;
    }

    if (room instanceof HTMLElement) {
      room.hidden = !roomLabel;
    }

    if (roomValue instanceof HTMLElement) {
      roomValue.textContent = roomLabel;
    }

    if (
      roomNameInput instanceof HTMLInputElement &&
      roomNameInput.value !== dddiceUiState.draftRoomName
    ) {
      roomNameInput.value = dddiceUiState.draftRoomName;
    }

    if (
      roomSlugInput instanceof HTMLInputElement &&
      roomSlugInput.value !== dddiceUiState.draftRoomSlug
    ) {
      roomSlugInput.value = dddiceUiState.draftRoomSlug;
    }

    if (roomNameInput instanceof HTMLInputElement) {
      roomNameInput.disabled = !integrationEnabled || isBusy;
    }

    if (roomSlugInput instanceof HTMLInputElement) {
      roomSlugInput.disabled = !integrationEnabled || isBusy;
    }

    if (themeSelect instanceof HTMLSelectElement) {
      const emptyLabel = !integrationEnabled
        ? "Enable DDDice to choose a skin"
        : !hasSession
          ? "Connect guest or account to load skins"
          : dddiceUiState.themeOptionsLoading
            ? "Loading dice skins..."
            : "No dice skins available";
      const fragment = document.createDocumentFragment();

      if (!themeOptions.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = emptyLabel;
        option.selected = true;
        fragment.appendChild(option);
      } else {
        themeOptions.forEach((theme) => {
          const option = document.createElement("option");
          option.value = theme.id;
          option.textContent = theme.name;
          option.selected = theme.id === selectedThemeId;
          fragment.appendChild(option);
        });
      }

      themeSelect.replaceChildren(fragment);
      if (themeOptions.length) {
        themeSelect.value = themeOptions.some((theme) => theme.id === selectedThemeId)
          ? selectedThemeId
          : themeOptions[0].id;
      }
      themeSelect.disabled =
        !integrationEnabled ||
        !hasSession ||
        isBusy ||
        dddiceUiState.themeOptionsLoading ||
        !themeOptions.length;
    }

    if (themeHint instanceof HTMLElement) {
      if (!integrationEnabled) {
        themeHint.textContent =
          "Enable DDDice dice replacement above to choose a DDDice skin.";
      } else if (!hasSession) {
        themeHint.textContent =
          "Connect a guest session or link your DDDice account to load the skins available in that dice box.";
      } else if (dddiceUiState.themeOptionsLoading) {
        themeHint.textContent = "Loading available dice skins...";
      } else if (!themeOptions.length) {
        themeHint.textContent = "No DDDice dice skins are available for this user.";
      } else if (themeOptions.length === 1) {
        themeHint.textContent = `Using ${themeOptions[0].name}. Add more skins in DDDice to choose between them.`;
      } else {
        const selectedTheme =
          themeOptions.find((theme) => theme.id === selectedThemeId) || themeOptions[0];
        themeHint.textContent = `Selected skin: ${selectedTheme.name}.`;
      }
    }

    if (accountActivation instanceof HTMLElement) {
      accountActivation.hidden = !isAccountLinkPending;
    }

    if (activationCode instanceof HTMLElement) {
      activationCode.textContent = String(dddiceUiState.accountActivationCode || "").trim() || "------";
    }

    if (activationCopy instanceof HTMLElement) {
      const expiresAt = formatDddiceActivationExpiry(
        dddiceUiState.accountActivationExpiresAt
      );
      activationCopy.textContent = isAccountLinkPending
        ? expiresAt
          ? `Open dddice.com/activate, sign in, and enter this code before ${expiresAt}.`
          : "Open dddice.com/activate, sign in, and enter this code."
        : "Open dddice.com/activate, sign in, and enter the code shown here.";
    }

    if (connectButton instanceof HTMLButtonElement) {
      connectButton.disabled = !integrationEnabled || isBusy;
      connectButton.textContent = isDddiceAccountSession()
        ? "Switch to guest"
        : hasSession
          ? "Refresh guest"
          : "Connect guest";
    }

    if (accountButton instanceof HTMLButtonElement) {
      accountButton.disabled = !integrationEnabled || isBusy || isAccountLinkPending;
      accountButton.textContent = isDddiceAccountSession()
        ? "Reconnect account"
        : "Connect account";
    }

    if (createRoomButton instanceof HTMLButtonElement) {
      createRoomButton.disabled = !integrationEnabled || isBusy || !hasSession;
    }

    if (joinRoomButton instanceof HTMLButtonElement) {
      joinRoomButton.disabled =
        !integrationEnabled || isBusy || !hasSession || !hasRoomDraft;
    }

    if (view3dRoomButton instanceof HTMLButtonElement) {
      view3dRoomButton.disabled = !integrationEnabled || !hasActiveRoom;
    }

    if (openActivationButton instanceof HTMLButtonElement) {
      openActivationButton.disabled = !isAccountLinkPending;
    }

    if (cancelActivationButton instanceof HTMLButtonElement) {
      cancelActivationButton.disabled = !isAccountLinkPending;
    }
  }

  function updateDddiceUiState(nextState) {
    Object.assign(dddiceUiState, nextState);
    mountDddiceScreenTray();
    mountDddiceNativePanel();
    mountDddiceRollerPanel();
    syncDddiceDrawer(getDddiceDrawer());
    syncDddiceConfigPanel();
    syncDddiceSidebarAction(findDddiceInfoSidebar());
  }

  function getDddiceVisualizerErrorMessage(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "The 3D DDDice tray could not start.";
  }

  function canReuseDddiceVisualizer(drawer = getDddiceVisualizerHost()) {
    const visualizer = dddiceRuntimeState.visualizer;
    const canvas = getDddiceCanvas(drawer);
    const token = String(dddiceUiState.authToken || "").trim();
    const roomSlug = normalizeDddiceRoomSlug(dddiceUiState.activeRoomSlug);
    const themeId = String(dddiceUiState.themeId || "").trim();

    return !!(
      visualizer &&
      canvas instanceof HTMLCanvasElement &&
      visualizer.canvas === canvas &&
      dddiceRuntimeState.visualizerToken === token &&
      dddiceRuntimeState.visualizerRoomSlug === roomSlug &&
      dddiceRuntimeState.visualizerThemeId === themeId
    );
  }

  function getDddiceVisualizerSize(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      return {
        width: 296,
        height: 152,
      };
    }

    const stage = canvas.closest(".fb-dddice-drawer__stage");
    const canvasRect = canvas.getBoundingClientRect();
    const stageRect = stage instanceof HTMLElement ? stage.getBoundingClientRect() : null;
    const isRollerStage =
      stage instanceof HTMLElement &&
      stage.classList.contains("fb-dddice-drawer__stage--roller");
    const isScreenTrayStage =
      stage instanceof HTMLElement &&
      stage.classList.contains("fb-dddice-screen-tray__stage");
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

  function resizeDddiceVisualizer(visualizer, canvas) {
    if (!(canvas instanceof HTMLCanvasElement) || !visualizer) {
      return;
    }

    const { width, height } = getDddiceVisualizerSize(canvas);

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

  async function ensureDddiceVisualizer(drawer = getDddiceVisualizerHost()) {
    const sdk = getDddiceSdk();
    if (!sdk || typeof sdk.ThreeDDice !== "function") {
      throw new Error("The local DDDice 3D renderer is unavailable.");
    }

    if (
      typeof sdk.ThreeDDice.isWebGLAvailable === "function" &&
      !sdk.ThreeDDice.isWebGLAvailable()
    ) {
      throw new Error("WebGL is unavailable in this tab, so the 3D DDDice tray cannot start.");
    }

    const canvas = getDddiceCanvas(drawer);
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("The DDDice screen overlay is unavailable on this sheet.");
    }

    const token = String(dddiceUiState.authToken || "").trim();
    const roomSlug = normalizeDddiceRoomSlug(dddiceUiState.activeRoomSlug);
    const themeId = String(dddiceUiState.themeId || "").trim();

    if (!token) {
      throw new Error("Connect a DDDice guest or account session to start the 3D DDDice tray.");
    }

    if (!roomSlug) {
      throw new Error("Create or join a room to target DDDice rolls.");
    }

    if (!themeId) {
      throw new Error("No DDDice theme is available for this user.");
    }

    if (canReuseDddiceVisualizer(drawer)) {
      if (dddiceRuntimeState.visualizer?.config) {
        dddiceRuntimeState.visualizer.config.autoClear = DDDICE_VISUALIZER_AUTO_CLEAR_SECONDS;
      }
      resizeDddiceVisualizer(dddiceRuntimeState.visualizer, canvas);
      dddiceRuntimeState.visualizerError = "";
      return dddiceRuntimeState.visualizer;
    }

    destroyDddiceVisualizer();

    const visualizer = new sdk.ThreeDDice(canvas, token, {
      autoClear: DDDICE_VISUALIZER_AUTO_CLEAR_SECONDS,
      bgColor: 0x000000,
      bgOpacity: 0,
      persistRolls: false,
    });
    const visualizerApi = visualizer.api || new sdk.ThreeDDiceAPI(token);

    visualizer.api = visualizerApi;
    if (visualizer.config) {
      visualizer.config.autoClear = DDDICE_VISUALIZER_AUTO_CLEAR_SECONDS;
    }
    resizeDddiceVisualizer(visualizer, canvas);
    visualizer.start();
    visualizer.connect(roomSlug);

    const themeResponse = await visualizerApi.theme.get(themeId);
    const theme = themeResponse?.data || null;

    if (!theme) {
      throw new Error("Could not load the active DDDice theme.");
    }

    visualizer.loadTheme(theme, true, false);

    dddiceRuntimeState.visualizer = visualizer;
    dddiceRuntimeState.visualizerToken = token;
    dddiceRuntimeState.visualizerRoomSlug = roomSlug;
    dddiceRuntimeState.visualizerThemeId = themeId;
    dddiceRuntimeState.visualizerError = "";

    return visualizer;
  }

  function destroyDddiceVisualizer(errorMessage = "") {
    const visualizer = dddiceRuntimeState.visualizer;
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

    dddiceRuntimeState.visualizer = null;
    dddiceRuntimeState.visualizerToken = "";
    dddiceRuntimeState.visualizerRoomSlug = "";
    dddiceRuntimeState.visualizerThemeId = "";
    dddiceRuntimeState.visualizerError = errorMessage;
  }

  function syncDddiceVisualizer(drawer = getDddiceVisualizerHost()) {
    const hasSdk = !!getDddiceSdk();
    const hasSession = !!String(dddiceUiState.authToken || "").trim();
    const hasRoom = !!normalizeDddiceRoomSlug(dddiceUiState.activeRoomSlug);
    const hasTheme = !!String(dddiceUiState.themeId || "").trim();

    if (!(drawer instanceof HTMLElement)) {
      if (dddiceRuntimeState.visualizer) {
        destroyDddiceVisualizer();
      }
      return;
    }

    if (!hasSession || !hasRoom || !hasTheme) {
      if (dddiceRuntimeState.visualizer) {
        destroyDddiceVisualizer();
      } else {
        dddiceRuntimeState.visualizerError = "";
      }
      syncDddiceStage(drawer, hasSdk, hasSession, hasRoom);
      return;
    }

    const canvas = getDddiceCanvas(drawer);
    if (!(canvas instanceof HTMLCanvasElement)) {
      if (dddiceRuntimeState.visualizer) {
        destroyDddiceVisualizer();
      }
      syncDddiceStage(drawer, hasSdk, hasSession, hasRoom);
      return;
    }

    if (!dddiceRuntimeState.visualizer) {
      syncDddiceStage(drawer, hasSdk, hasSession, hasRoom);
      return;
    }

    if (!canReuseDddiceVisualizer(drawer)) {
      destroyDddiceVisualizer();
      syncDddiceStage(drawer, hasSdk, hasSession, hasRoom);
      return;
    }

    resizeDddiceVisualizer(dddiceRuntimeState.visualizer, canvas);
    dddiceRuntimeState.visualizerError = "";
    syncDddiceStage(drawer, hasSdk, hasSession, hasRoom);
  }

  async function showDddiceRollOnScreen(roll, options = {}) {
    if (!roll || typeof roll !== "object") {
      return undefined;
    }

    const host = await ensureDddiceVisualizerHostVisible(options.openTray === true);
    if (!(host instanceof HTMLElement)) {
      return undefined;
    }


    try {
      const visualizer = await ensureDddiceVisualizer(host);
      const rollCreatedEvent = getDddiceSdk()?.ThreeDDiceRollEvent?.RollCreated;

      if (!rollCreatedEvent) {
        throw new Error("The local DDDice roll event bridge is unavailable.");
      }

      visualizer.dispatch(rollCreatedEvent, roll);

      dddiceRuntimeState.visualizerError = "";
      hideDddiceRollOutput(host);
    } catch (error) {
      destroyDddiceVisualizer(getDddiceVisualizerErrorMessage(error));
      renderDddiceRollOutput(roll, host);
    }

    syncDddiceDrawer(host);
    return undefined;
  }

  function destroyDddiceEngine() {
    const engine = dddiceRuntimeState.engine;
    if (!engine) {
      return;
    }

    try {
      engine.disconnect();
    } catch (_error) {
      // Ignore disconnect failures during teardown.
    }

    dddiceRuntimeState.engine = null;
    dddiceRuntimeState.engineToken = "";
    dddiceRuntimeState.connectedRoomSlug = "";
    dddiceRuntimeState.syncPending = false;
  }

  function syncDddiceEngineRoom(engine) {
    dddiceRuntimeState.connectedRoomSlug = normalizeDddiceRoomSlug(
      dddiceUiState.activeRoomSlug
    );
  }

  function ensureDddiceEngine() {
    const sdk = getDddiceSdk();
    if (!sdk) {
      throw new Error("DDDice SDK bundle is unavailable.");
    }

    const token = String(dddiceUiState.authToken || "").trim();
    if (!token) {
      throw new Error("Connect a DDDice guest or account session before starting the room client.");
    }

    if (dddiceRuntimeState.engine && dddiceRuntimeState.engineToken === token) {
      return dddiceRuntimeState.engine;
    }

    destroyDddiceEngine();

    const engine = new sdk.ThreeDDiceAPI(token);

    dddiceRuntimeState.engine = engine;
    dddiceRuntimeState.engineToken = token;
    syncDddiceEngineRoom(engine);
    return engine;
  }

  function handleDddiceDrawerToggle(event) {
    event.preventDefault();
    event.stopPropagation();
    updateDddiceUiState({ expanded: !dddiceUiState.expanded });
    void saveDddiceLocalState();
  }

  function handleDddiceNativeDicePressStart(event) {
    if (!shouldSuppressDddiceNativeDice() || !getDddiceNativeDiceButton(event.target)) {
      return;
    }

    stopDddiceNativeDiceEvent(event, false);
  }

  function handleDddiceDiceButtonClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const diceButton = target.closest(
      '.dice-rolling-panel button[class*="DiceContainer_button__"]'
    );
    if (diceButton instanceof HTMLButtonElement) {
      if (!canUseDddiceNativeRolls()) {
        return;
      }

      stopDddiceNativeDiceEvent(event);

      updateDddiceUiState({ expanded: !dddiceUiState.expanded });
      void saveDddiceLocalState();
      return;
    }

    if (!dddiceUiState.expanded) {
      return;
    }

    const roller = getDddiceRollerPanel();
    if (!(roller instanceof HTMLElement) || roller.contains(target)) {
      return;
    }

    updateDddiceUiState({ expanded: false });
    void saveDddiceLocalState();
  }

  function handleDddiceDraftInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
      return;
    }

    if (
      target instanceof HTMLInputElement &&
      target.dataset.fbDddiceRole === "custom-roll-input"
    ) {
      const drawer = target.closest(".fb-dddice-drawer");
      syncDddiceDrawer(drawer instanceof HTMLElement ? drawer : getDddiceVisualizerHost());
      return;
    }

    const field = target.dataset.fbDddiceField;
    if (field !== "draftRoomName" && field !== "draftRoomSlug" && field !== "themeId") {
      return;
    }

    updateDddiceUiState({
      [field]: String(target.value || "").trim(),
    });
    void saveDddiceLocalState();

    if (field === "themeId") {
      setConfigStatus("Dice skin updated.", "ok");
    }
  }

  function formatDddiceActivationExpiry(expiresAt) {
    const expirationMs = Date.parse(String(expiresAt || ""));
    if (!Number.isFinite(expirationMs)) {
      return "";
    }

    return new Date(expirationMs).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function createDddiceSidebarAction() {
    const section = document.createElement("section");
    const eyebrow = document.createElement("p");
    const summary = document.createElement("p");
    const button = document.createElement("button");

    section.className = DDDICE_SIDEBAR_ACTION_CLASS;

    eyebrow.className = "fb-dddice-sidebar-action__eyebrow";
    eyebrow.textContent = "Further Beyond";

    summary.className = "fb-dddice-sidebar-action__summary";

    button.type = "button";
    button.className = "fb-dddice-sidebar-action__button";
    button.textContent = "Roll in DDDice";
    button.addEventListener("click", handleDddiceSidebarRollClick);

    section.append(eyebrow, summary, button);
    return section;
  }

  function syncDddiceSidebarAction(dialog) {
    const existingActions = Array.from(
      document.querySelectorAll(`.${DDDICE_SIDEBAR_ACTION_CLASS}`)
    );
    existingActions.forEach((action) => {
      if (!dialog || action.closest('[role="dialog"]') !== dialog) {
        action.remove();
      }
    });

    if (!getExtensionSettings().dddiceEnabled || !(dialog instanceof HTMLElement)) {
      return false;
    }

    const rollDefinition = buildDddiceSidebarRollDefinition(dialog);
    if (!rollDefinition) {
      dialog.querySelector(`.${DDDICE_SIDEBAR_ACTION_CLASS}`)?.remove();
      return false;
    }

    let action = dialog.querySelector(`.${DDDICE_SIDEBAR_ACTION_CLASS}`);
    if (!(action instanceof HTMLElement)) {
      action = createDddiceSidebarAction();
      dialog.appendChild(action);
    }

    const summary = action.querySelector(".fb-dddice-sidebar-action__summary");
    const button = action.querySelector(".fb-dddice-sidebar-action__button");
    const canRoll =
      !!dddiceUiState.authToken &&
      !!dddiceUiState.activeRoomSlug &&
      !!dddiceUiState.themeId &&
      dddiceUiState.connectionState !== "connecting";

    if (summary) {
      summary.textContent = `${rollDefinition.label}: ${rollDefinition.expression}`;
    }

    if (button instanceof HTMLButtonElement) {
      button.dataset.fbDddiceExpression = rollDefinition.expression;
      button.dataset.fbDddiceLabel = rollDefinition.label;
      button.disabled = !canRoll;
    }

    return true;
  }

  async function handleDddiceSidebarRollClick(event) {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }

    const expression = String(button.dataset.fbDddiceExpression || "").trim();
    const label = String(button.dataset.fbDddiceLabel || "").trim() || "D&D Beyond roll";
    if (!expression) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      await submitDddiceRollExpression(expression, label, {
        showRollerOutput: false,
        show3dTray: true,
      });
    } catch (error) {
      console.error("[Further Beyond] DDDice action failed.", error);
      updateDddiceUiState({
        connectionState: getDddiceConnectionState(),
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : "DDDice action failed.",
      });
    }
  }

  async function handleDddiceIntegratedDiceClick(event) {
    const target = event.target;
    if (!(target instanceof Element) || !canUseDddiceNativeRolls()) {
      return;
    }

    const button = target.closest("button.integrated-dice__container");
    const context = getDddiceIntegratedDiceContext(button);
    if (!context) {
      return;
    }

    if (shouldSuppressDddiceNativeDice()) {
      stopDddiceNativeDiceEvent(event);
    }

    try {
      const metadata = await requestIntegratedDiceMetadata(button);
      const rollDefinition = buildDddiceIntegratedDiceRollDefinition(
        button,
        metadata
      );
      if (!rollDefinition) {
        throw new Error("This D&D Beyond roll is not supported yet.");
      }

      await submitDddiceRollExpression(
        rollDefinition.expression,
        rollDefinition.label,
        {
          showRollerOutput: false,
          show3dTray: true,
        }
      );
    } catch (error) {
      console.error("[Further Beyond] DDDice action failed.", error);
      updateDddiceUiState({
        connectionState: getDddiceConnectionState(),
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : "DDDice action failed.",
      });
    }
  }

  function buildDddiceErrorMessage(response, payload) {
    if (typeof payload?.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }

    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }

    const errorList = Array.isArray(payload?.errors)
      ? payload.errors
      : payload?.errors && typeof payload.errors === "object"
        ? Object.values(payload.errors).flat()
        : [];
    const normalizedErrors = errorList
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);

    if (normalizedErrors.length) {
      return normalizedErrors.join(" ");
    }

    return `DDDice request failed (${response.status}).`;
  }

  async function dddiceApiRequest(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");

    if (options.token) {
      headers.set("Authorization", `Bearer ${options.token}`);
    }

    if (
      options.body !== undefined &&
      options.body !== null &&
      !headers.has("Content-Type") &&
      !(options.body instanceof FormData)
    ) {
      headers.set("Content-Type", "application/json");
    }

    let response;
    try {
      response = await fetch(`${DDDICE_API_BASE_URL}${path}`, {
        method: options.method || "GET",
        body: options.body,
        headers,
      });
    } catch (_error) {
      throw new Error("Could not reach DDDice.");
    }

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : null;

    if (!response.ok) {
      throw new Error(buildDddiceErrorMessage(response, payload));
    }

    return payload;
  }

  async function requestDddiceGuestToken() {
    const response = await dddiceApiRequest("/user", {
      method: "POST",
    });

    if (response?.type === "token" && typeof response.data === "string") {
      return response.data.trim();
    }

    throw new Error("DDDice did not return a guest token.");
  }

  async function requestDddiceAccountActivation() {
    const response = await dddiceApiRequest("/activate", {
      method: "POST",
    });
    const code = String(response?.data?.code || "").trim();
    const secret = String(response?.data?.secret || "").trim();
    const expiresAt = String(response?.data?.expires_at || "").trim();

    if (!code || !secret) {
      throw new Error("DDDice did not return an account activation code.");
    }

    return {
      code,
      secret,
      expiresAt,
    };
  }

  function clearDddiceAccountActivation(nextState = {}) {
    window.clearTimeout(dddiceRuntimeState.accountActivationPollTimeoutId);
    dddiceRuntimeState.accountActivationPollTimeoutId = null;
    dddiceRuntimeState.accountActivationSecret = "";

    updateDddiceUiState({
      accountActivationCode: "",
      accountActivationExpiresAt: "",
      accountActivationPending: false,
      ...nextState,
    });
  }

  function scheduleDddiceAccountActivationPoll(delayMs = 5000) {
    window.clearTimeout(dddiceRuntimeState.accountActivationPollTimeoutId);
    dddiceRuntimeState.accountActivationPollTimeoutId = window.setTimeout(() => {
      void pollDddiceAccountActivation();
    }, delayMs);
  }

  async function fetchDddiceCurrentUser(token) {
    const response = await dddiceApiRequest("/user", {
      token,
    });
    return response?.data || null;
  }

  async function fetchDddiceDiceBox(token) {
    const response = await dddiceApiRequest("/dice-box", {
      token,
    });
    return Array.isArray(response?.data) ? response.data : [];
  }

  function getDddiceThemeDisplayName(theme) {
    const label = [
      theme?.name,
      theme?.theme?.name,
      theme?.title,
      theme?.theme?.title,
      theme?.slug,
      theme?.theme?.slug,
      theme?.id,
      theme?.theme?.id,
    ].find((value) => typeof value === "string" && value.trim());

    return String(label || "").trim();
  }

  function normalizeDddiceThemeOptions(diceBoxItems) {
    const seenThemeIds = new Set();

    return (Array.isArray(diceBoxItems) ? diceBoxItems : [])
      .map((theme) => {
        const id = String(theme?.id || theme?.theme?.id || "").trim();
        const name = getDddiceThemeDisplayName(theme);

        if (!id || !name || seenThemeIds.has(id)) {
          return null;
        }

        seenThemeIds.add(id);
        return { id, name };
      })
      .filter(Boolean);
  }

  async function ensureDddiceThemeOptions(token, forceRefresh) {
    const authToken = String(token || dddiceUiState.authToken || "").trim();
    const currentThemeId = String(dddiceUiState.themeId || "").trim();
    const cachedThemes = Array.isArray(dddiceUiState.availableThemes)
      ? dddiceUiState.availableThemes
      : [];

    if (!authToken) {
      updateDddiceUiState({
        availableThemes: [],
        themeOptionsLoading: false,
      });
      return [];
    }

    if (
      !forceRefresh &&
      cachedThemes.length &&
      cachedThemes.some((theme) => theme.id === currentThemeId)
    ) {
      return cachedThemes;
    }

    if (dddiceRuntimeState.themeOptionsPromise) {
      return dddiceRuntimeState.themeOptionsPromise;
    }

    updateDddiceUiState({ themeOptionsLoading: true });

    dddiceRuntimeState.themeOptionsPromise = fetchDddiceDiceBox(authToken)
      .then(async (diceBoxItems) => {
        const availableThemes = normalizeDddiceThemeOptions(diceBoxItems);
        const nextThemeId = availableThemes.some((theme) => theme.id === currentThemeId)
          ? currentThemeId
          : String(availableThemes[0]?.id || "").trim();

        updateDddiceUiState({
          availableThemes,
          themeId: nextThemeId,
          themeOptionsLoading: false,
        });

        if (nextThemeId !== currentThemeId) {
          await saveDddiceLocalState();
        }

        return availableThemes;
      })
      .catch((error) => {
        updateDddiceUiState({ themeOptionsLoading: false });
        throw error;
      })
      .finally(() => {
        dddiceRuntimeState.themeOptionsPromise = null;
      });

    return dddiceRuntimeState.themeOptionsPromise;
  }

  async function hydrateDddiceSessionToken(token, authKind, forceRefresh, statusMessage = "") {
    const normalizedAuthKind = normalizeDddiceAuthKind(authKind);
    const user = await fetchDddiceCurrentUser(token);
    const userName = String(user?.name || "").trim();
    const userId = String(user?.uuid || "").trim();

    updateDddiceUiState({
      authKind: normalizedAuthKind,
      authToken: token,
      userName,
      userId,
      availableThemes: [],
      themeOptionsLoading: false,
    });

    const themeId = await ensureDddiceRollTheme(token, forceRefresh);

    updateDddiceUiState({
      authKind: normalizedAuthKind,
      authToken: token,
      userName,
      userId,
      themeId,
      connectionState: dddiceUiState.activeRoomSlug ? "connected" : "ready",
      statusMessage,
    });
    await saveDddiceLocalState();
    return token;
  }

  async function ensureDddiceRollTheme(token, forceRefresh) {
    await ensureDddiceThemeOptions(token, forceRefresh);
    const themeId = String(dddiceUiState.themeId || "").trim();

    if (!themeId) {
      throw new Error("No DDDice roll theme is available for this user.");
    }

    return themeId;
  }

  async function ensureDddiceGuestSession(forceRefresh) {
    const existingToken = dddiceUiState.authToken;
    const hasCachedUser = !!(dddiceUiState.userName || dddiceUiState.userId);
    const authKind = normalizeDddiceAuthKind(dddiceUiState.authKind);

    if (
      existingToken &&
      hasCachedUser &&
      !!dddiceUiState.themeId &&
      (!forceRefresh || authKind === "account")
    ) {
      updateDddiceUiState({
        connectionState: getDddiceConnectionState(),
        statusMessage: "",
      });
      return existingToken;
    }

    updateDddiceUiState({
      connectionState: "connecting",
      statusMessage: existingToken
        ? `Refreshing ${authKind} session...`
        : "Creating guest session...",
    });

    let token = existingToken;

    try {
      if (!token || (forceRefresh && authKind !== "account")) {
        token = await requestDddiceGuestToken();
      }

      try {
        await hydrateDddiceSessionToken(
          token,
          authKind === "account" && token === existingToken ? "account" : "guest",
          forceRefresh,
          ""
        );
      } catch (error) {
        if (!existingToken || authKind === "account") {
          throw error;
        }

        token = await requestDddiceGuestToken();
        await hydrateDddiceSessionToken(token, "guest", true, "");
      }
    } catch (error) {
      updateDddiceUiState({
        connectionState: "error",
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : `Could not restore the DDDice ${authKind} session.`,
      });
      throw error;
    }

    return token;
  }

  async function connectDddiceGuestSession() {
    clearDddiceAccountActivation({
      connectionState: "connecting",
      statusMessage: "Creating guest session...",
    });

    try {
      const token = await requestDddiceGuestToken();
      await hydrateDddiceSessionToken(token, "guest", true, "");
    } catch (error) {
      updateDddiceUiState({
        connectionState: "error",
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : "Could not create a DDDice guest session.",
      });
      throw error;
    }
  }

  async function pollDddiceAccountActivation() {
    const code = String(dddiceUiState.accountActivationCode || "").trim();
    const secret = String(dddiceRuntimeState.accountActivationSecret || "").trim();
    const expiresAt = String(dddiceUiState.accountActivationExpiresAt || "").trim();
    const expirationMs = Date.parse(expiresAt);

    if (!code || !secret) {
      return;
    }

    if (Number.isFinite(expirationMs) && expirationMs <= Date.now()) {
      clearDddiceAccountActivation({
        connectionState: dddiceUiState.authToken ? getDddiceConnectionState() : "error",
        statusMessage: "The DDDice account link code expired. Start a new account connection.",
      });
      return;
    }

    try {
      const response = await dddiceApiRequest(
        `/activate/${encodeURIComponent(code)}`,
        {
          headers: {
            Authorization: `Secret ${secret}`,
          },
        }
      );
      const token = String(response?.data?.token || "").trim();

      if (token) {
        clearDddiceAccountActivation({
          statusMessage: "Linking your DDDice account...",
        });
        await hydrateDddiceSessionToken(token, "account", true, "");
        updateDddiceUiState({
          statusMessage: dddiceUiState.userName
            ? `Account linked as ${dddiceUiState.userName}.`
            : "DDDice account linked.",
        });
        return;
      }

      scheduleDddiceAccountActivationPoll(5000);
    } catch (error) {
      clearDddiceAccountActivation({
        connectionState: dddiceUiState.authToken ? getDddiceConnectionState() : "error",
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : "Could not link the DDDice account.",
      });
    }
  }

  async function connectDddiceAccountSession() {
    clearDddiceAccountActivation({
      connectionState: dddiceUiState.authToken ? getDddiceConnectionState() : "idle",
      statusMessage: "Requesting a DDDice account link code...",
    });

    try {
      const activation = await requestDddiceAccountActivation();
      dddiceRuntimeState.accountActivationSecret = activation.secret;
      updateDddiceUiState({
        accountActivationCode: activation.code,
        accountActivationExpiresAt: activation.expiresAt,
        accountActivationPending: true,
        connectionState: dddiceUiState.authToken ? getDddiceConnectionState() : "idle",
        statusMessage: `Open dddice.com/activate, sign in, and enter ${activation.code}.`,
      });
      scheduleDddiceAccountActivationPoll(1500);
    } catch (error) {
      updateDddiceUiState({
        connectionState: dddiceUiState.authToken ? getDddiceConnectionState() : "error",
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : "Could not start DDDice account linking.",
      });
      throw error;
    }
  }

  async function createDddiceRoom() {
    const token = await ensureDddiceGuestSession(false);
    const requestedName = String(dddiceUiState.draftRoomName || "").trim();

    updateDddiceUiState({
      connectionState: "connecting",
      statusMessage: requestedName
        ? `Creating ${requestedName}...`
        : "Creating room...",
    });

    const response = await dddiceApiRequest("/room", {
      method: "POST",
      token,
      body: JSON.stringify({
        is_public: true,
        ...(requestedName ? { name: requestedName } : {}),
      }),
    });
    const room = normalizeDddiceRoomRecord(response?.data);

    if (!room.slug) {
      throw new Error("DDDice did not return a room slug.");
    }

    updateDddiceUiState({
      activeRoomSlug: room.slug,
      activeRoomName: room.name || requestedName,
      draftRoomSlug: room.slug,
      draftRoomName: room.name || requestedName,
      connectionState: "connected",
      statusMessage: room.name
        ? `Created and joined ${room.name}.`
        : `Created and joined room ${room.slug}.`,
    });
    await saveDddiceLocalState();
  }

  async function joinDddiceRoom() {
    const token = await ensureDddiceGuestSession(false);
    const requestedSlug = normalizeDddiceRoomSlug(dddiceUiState.draftRoomSlug);

    if (!requestedSlug) {
      throw new Error("Enter a room slug or invite link first.");
    }

    updateDddiceUiState({
      connectionState: "connecting",
      statusMessage: `Joining room ${requestedSlug}...`,
    });

    const response = await dddiceApiRequest(
      `/room/${encodeURIComponent(requestedSlug)}/participant`,
      {
        method: "POST",
        token,
        body: JSON.stringify({}),
      }
    );
    const room = normalizeDddiceRoomRecord(response?.data);

    if (!room.slug) {
      throw new Error("DDDice did not confirm the joined room.");
    }

    updateDddiceUiState({
      activeRoomSlug: room.slug,
      activeRoomName: room.name || dddiceUiState.draftRoomName,
      draftRoomSlug: room.slug,
      draftRoomName: room.name || dddiceUiState.draftRoomName,
      connectionState: "connected",
      statusMessage: room.name
        ? `Joined ${room.name}.`
        : `Joined room ${room.slug}.`,
    });
    await saveDddiceLocalState();
  }

  function parseDddiceCustomRoll(expression) {
    const normalizedExpression = String(expression || "").trim();
    if (!normalizedExpression) {
      throw new Error("Enter a dice expression first.");
    }

    const themeId = String(dddiceUiState.themeId || "").trim();
    if (!themeId) {
      throw new Error("No DDDice roll theme is available for this user.");
    }

    const sdk = getDddiceSdk();
    if (sdk) {
      try {
        const parsedRoll = sdk.parseRollEquation(normalizedExpression, themeId);
        const dice = Array.isArray(parsedRoll?.dice) ? parsedRoll.dice : [];

        if (!dice.length) {
          throw new Error("Enter a dice expression first.");
        }

        return {
          dice,
          operator:
            parsedRoll?.operators && typeof parsedRoll.operators === "object"
              ? parsedRoll.operators
              : undefined,
          equation: normalizedExpression,
        };
      } catch (error) {
        throw new Error(
          error instanceof Error && error.message
            ? error.message
            : "Enter a valid DDDice roll expression."
        );
      }
    }

    const rawTerms = normalizedExpression
      .split("+")
      .map((term) => term.trim())
      .filter(Boolean);

    if (!rawTerms.length) {
      throw new Error("Enter a dice expression first.");
    }

    const dice = [];
    const normalizedTerms = [];

    rawTerms.forEach((term) => {
      const match = /^(\d*)d(4|6|8|10|12|20)$/i.exec(term);
      if (!match) {
        throw new Error(
          "Custom rolls currently support only dice terms like d20 or 2d6 + d8."
        );
      }

      const quantity = Number.parseInt(match[1] || "1", 10);
      const dieType = `d${match[2]}`;

      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error("Each dice term must use a positive quantity.");
      }

      if (quantity > 25) {
        throw new Error("A single custom term cannot exceed 25 dice.");
      }

      for (let index = 0; index < quantity; index += 1) {
        dice.push({
          type: dieType,
          theme: themeId,
        });
      }

      normalizedTerms.push(quantity === 1 ? `1${dieType}` : `${quantity}${dieType}`);
    });

    if (dice.length > 25) {
      throw new Error("Custom rolls cannot exceed 25 dice total.");
    }

    return {
      dice,
      equation: normalizedTerms.join("+"),
    };
  }

  function appendDddiceCustomRollDie(dieType) {
    const drawer = getDddiceDrawer();
    const input = drawer?.querySelector('[data-fb-dddice-role="custom-roll-input"]');
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const currentValue = String(input.value || "").trim();
    input.value = currentValue ? `${currentValue} + ${dieType}` : dieType;
    syncDddiceDrawer(drawer);
  }

  async function submitDddiceCustomRoll() {
    const drawer = getDddiceDrawer();
    const input = drawer?.querySelector('[data-fb-dddice-role="custom-roll-input"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Custom roll input is unavailable.");
    }

    if (!dddiceUiState.activeRoomSlug) {
      throw new Error("Create or join a room before rolling.");
    }

    await submitDddiceRollExpression(input.value, "Custom roll");

    input.value = "";
    syncDddiceDrawer(drawer);
  }

  async function submitDddiceRollExpression(expression, label, options = {}) {
    if (!dddiceUiState.activeRoomSlug) {
      throw new Error("Create or join a room before rolling.");
    }

    const showRollerOutput = options.showRollerOutput !== false;
    const show3dTray = options.show3dTray !== false;

    const token = await ensureDddiceGuestSession(false);
    await ensureDddiceRollTheme(token, false);
    const parsedRoll = parseDddiceCustomRoll(expression);
    const rollOptions = {
      label,
      room: dddiceUiState.activeRoomSlug,
      ...(parsedRoll.operator ? { operator: parsedRoll.operator } : {}),
    };

    updateDddiceUiState({
      rollPending: true,
      connectionState: getDddiceConnectionState(),
      statusMessage: `Rolling ${parsedRoll.equation}...`,
    });

    try {
      let response = null;
      let usedVisualizerRoll = false;
      const tray = await ensureDddiceVisualizerHostVisible(show3dTray);

      if (tray instanceof HTMLElement) {
        await waitForNextAnimationFrame();

        try {
          const visualizer = await ensureDddiceVisualizer(tray);
          if (typeof visualizer.roll === "function") {
            response = await visualizer.roll(parsedRoll.dice, rollOptions);
            usedVisualizerRoll = true;
            hideDddiceRollOutput(tray);
            dddiceRuntimeState.visualizerError = "";
          }
        } catch (error) {
          console.warn("[Further Beyond] Falling back to API roll after tray roll failed.", error);
        }
      }

      if (!response) {
        const engine = ensureDddiceEngine();
        response = await engine.roll.create(parsedRoll.dice, rollOptions);
      }

      const roll = response?.data || null;
      const totalValue = Number.isFinite(roll?.total_value)
        ? ` Total ${roll.total_value}.`
        : "";

      if (showRollerOutput && !usedVisualizerRoll) {
        renderDddiceRollOutput(roll, tray || getDddiceVisualizerHost());
      }
      appendDddiceRollHistory(roll);

      if (usedVisualizerRoll) {
        syncDddiceDrawer(tray);
      } else {
        await showDddiceRollOnScreen(roll, {
          openTray: show3dTray,
        });
      }

      updateDddiceUiState({
        rollPending: false,
        connectionState: getDddiceConnectionState(),
        statusMessage: `Rolled ${roll?.equation || parsedRoll.equation}.${totalValue}`,
      });

      return roll;
    } catch (error) {
      updateDddiceUiState({
        rollPending: false,
        connectionState: getDddiceConnectionState(),
      });
      throw error;
    }
  }

  async function handleDddiceDrawerKeydown(event) {
    const target = event.target;
    if (
      event.key !== "Enter" ||
      !(target instanceof HTMLInputElement) ||
      target.dataset.fbDddiceRole !== "custom-roll-input"
    ) {
      return;
    }

    event.preventDefault();

    try {
      await submitDddiceCustomRoll();
    } catch (error) {
      console.error("[Further Beyond] DDDice action failed.", error);
      updateDddiceUiState({
        connectionState: getDddiceConnectionState(),
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : "DDDice action failed.",
      });
    }
  }

  async function handleDddiceActionClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest(
      "[data-fb-dddice-action], [data-fb-dddice-die]"
    );
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }

    const dieType = button.dataset.fbDddiceDie;
    if (dieType) {
      event.preventDefault();
      event.stopPropagation();
      appendDddiceCustomRollDie(dieType);
      return;
    }

    const action = button.dataset.fbDddiceAction;
    if (!action) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      if (action === "connect-guest") {
        await connectDddiceGuestSession();
        return;
      }

      if (action === "connect-account") {
        await connectDddiceAccountSession();
        return;
      }

      if (action === "open-account-activation") {
        window.open(DDDICE_ACCOUNT_ACTIVATE_URL, "_blank", "noopener,noreferrer");
        return;
      }

      if (action === "cancel-account-connect") {
        clearDddiceAccountActivation({
          connectionState: dddiceUiState.authToken ? getDddiceConnectionState() : "idle",
          statusMessage: "",
        });
        return;
      }

      if (action === "create-room") {
        await createDddiceRoom();
        return;
      }

      if (action === "join-room") {
        await joinDddiceRoom();
        return;
      }

      if (action === "open-3d-room") {
        const roomUrl = getDddiceRoomUrl(dddiceUiState.activeRoomSlug);
        if (!roomUrl) {
          throw new Error("Create or join a room before opening DDDice.");
        }

        window.open(roomUrl, "_blank", "noopener,noreferrer");
        return;
      }

      if (action === "open-settings") {
        openConfigModal();
        return;
      }

      if (action === "close-roller") {
        updateDddiceUiState({ expanded: false });
        await saveDddiceLocalState();
        return;
      }

      if (action === "close-screen-tray") {
        hideDddiceScreenTray();
        return;
      }

      if (action === "roll-custom") {
        await submitDddiceCustomRoll();
      }
    } catch (error) {
      console.error("[Further Beyond] DDDice action failed.", error);
      updateDddiceUiState({
        connectionState: getDddiceConnectionState(),
        statusMessage:
          error instanceof Error && error.message
            ? error.message
            : "DDDice action failed.",
      });
    }
  }

  function ensureDddiceSidebarAlignedRight() {
    const sidebar = getDddiceNativeSidebar();
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

  function createDddiceNativePanel() {
    const panel = document.createElement("section");

    panel.id = DDDICE_NATIVE_PANEL_ID;
    panel.className = "fb-dddice-log-pane";
    panel.setAttribute("aria-label", "DDDice log");
    panel.innerHTML = `
      <div class="fb-dddice-log__list" data-fb-dddice-role="log-list"></div>
    `;

    renderDddiceRollHistory();
    return panel;
  }

  function createDddiceScreenTray() {
    const tray = document.createElement("section");

    tray.id = DDDICE_SCREEN_TRAY_ID;
    tray.className = "fb-dddice-screen-tray";
    tray.hidden = true;
    tray.setAttribute("aria-hidden", "true");
    tray.innerHTML = `
      <div class="fb-dddice-drawer__stage fb-dddice-screen-tray__stage" data-state="idle">
        <canvas
          class="fb-dddice-drawer__canvas fb-dddice-screen-tray__canvas"
          data-fb-dddice-role="canvas"
          width="1280"
          height="720"
          aria-label="DDDice tray"
        ></canvas>
        <div class="fb-dddice-drawer__roll-output fb-dddice-screen-tray__roll-output" data-fb-dddice-role="roll-output" aria-live="polite" hidden></div>
      </div>
    `;

    syncDddiceScreenTray(tray);
    return tray;
  }

  function createDddiceRollerPanel() {
    const panel = document.createElement("section");

    panel.id = DDDICE_ROLLER_PANEL_ID;
    panel.className = "fb-dddice-drawer fb-dddice-drawer--roller";
    panel.dataset.layout = "roller";
    panel.setAttribute("aria-label", "DDDice roller");
    panel.innerHTML = `
      <div class="fb-dddice-drawer__header">
        <div class="fb-dddice-drawer__title-block">
          <p class="fb-dddice-drawer__eyebrow">Further Beyond</p>
          <h2 class="fb-dddice-drawer__title">DDDice</h2>
        </div>
        <div class="fb-dddice-roller__header-actions">
          <span class="fb-dddice-drawer__state" data-state="idle">Guest mode</span>
          <button type="button" class="fb-dddice-roller__close" data-fb-dddice-action="close-roller" aria-label="Close DDDice roller">x</button>
        </div>
      </div>
      <div class="fb-dddice-drawer__summary">
        <span class="fb-dddice-drawer__user" hidden>
          <span data-fb-dddice-role="user-kind">Guest</span> <strong class="fb-dddice-drawer__user-value"></strong>
        </span>
        <span class="fb-dddice-drawer__room" hidden>
          Room <strong class="fb-dddice-drawer__room-value"></strong>
        </span>
      </div>
      <div class="fb-dddice-drawer__panel">
        <p class="fb-dddice-drawer__status">
          <span class="fb-dddice-drawer__status-label">Status</span>
          <span class="fb-dddice-drawer__status-copy">Guest setup has not started yet.</span>
        </p>
        <label class="fb-dddice-drawer__field">
          <span class="fb-dddice-drawer__field-label">Custom roll</span>
          <input class="fb-dddice-drawer__input" data-fb-dddice-role="custom-roll-input" type="text" placeholder="d20 + 2d6" />
        </label>
        <div class="fb-dddice-drawer__dice-row" aria-label="Quick add dice">
          <button type="button" data-fb-dddice-die="d4">d4</button>
          <button type="button" data-fb-dddice-die="d6">d6</button>
          <button type="button" data-fb-dddice-die="d8">d8</button>
          <button type="button" data-fb-dddice-die="d10">d10</button>
          <button type="button" data-fb-dddice-die="d12">d12</button>
          <button type="button" data-fb-dddice-die="d20">d20</button>
        </div>
        <div class="fb-dddice-drawer__actions">
          <button type="button" data-fb-dddice-action="open-settings">Open settings</button>
          <button type="button" data-fb-dddice-action="open-3d-room">View 3D room</button>
          <button type="button" data-fb-dddice-action="roll-custom">Roll custom</button>
        </div>
      </div>
    `;

    panel.addEventListener("input", handleDddiceDraftInput);
    panel.addEventListener("click", handleDddiceActionClick);
    panel.addEventListener("keydown", handleDddiceDrawerKeydown);

    syncDddiceDrawer(panel);
    return panel;
  }

  function removeDddiceNativePanel() {
    getDddiceNativePanel()?.remove();
  }

  function removeDddiceScreenTray() {
    hideDddiceScreenTray();
    getDddiceScreenTray()?.remove();
  }

  function removeDddiceRollerPanel() {
    getDddiceRollerPanel()?.remove();
  }

  function mountDddiceScreenTray() {
    if (!getExtensionSettings().dddiceEnabled) {
      removeDddiceScreenTray();
      return false;
    }

    let tray = getDddiceScreenTray();
    if (!(tray instanceof HTMLElement)) {
      tray = createDddiceScreenTray();
    }

    if (tray.parentElement !== document.body) {
      document.body.appendChild(tray);
    }

    syncDddiceScreenTray(tray);
    return true;
  }

  function mountDddiceNativePanel() {
    const gameLogPane = getDddiceGameLogPane();
    const gameLogButton = getDddiceGameLogButton();

    if (!(gameLogButton instanceof HTMLElement) || !(gameLogPane instanceof HTMLElement)) {
      removeDddiceNativePanel();
      resetDddiceSidebarLayout();
      return false;
    }

    ensureDddiceSidebarAlignedRight();
    document.body.classList.add(DDDICE_SIDEBAR_LAYOUT_BODY_CLASS);

    let panel = getDddiceNativePanel();
    if (!(panel instanceof HTMLElement)) {
      panel = createDddiceNativePanel();
    }

    if (panel.parentElement !== gameLogPane) {
      gameLogPane.replaceChildren(panel);
    }

    renderDddiceRollHistory();
    return true;
  }

  function mountDddiceRollerPanel() {
    if (!dddiceUiState.expanded) {
      removeDddiceRollerPanel();
      return false;
    }

    const diceButton = getDddiceDiceButton();
    if (!(diceButton instanceof HTMLButtonElement)) {
      removeDddiceRollerPanel();
      return false;
    }

    let panel = getDddiceRollerPanel();
    if (!(panel instanceof HTMLElement)) {
      panel = createDddiceRollerPanel();
    }

    if (panel.parentElement !== document.body) {
      document.body.appendChild(panel);
    }

    syncDddiceDrawer(panel);
    return true;
  }

  function createDddiceDrawer() {
    const drawer = document.createElement("aside");

    drawer.id = DDDICE_DRAWER_ID;
    drawer.className = "fb-dddice-drawer";
    drawer.dataset.layout = "floating";
    drawer.setAttribute("aria-label", "DDDice panel");
    drawer.innerHTML = `
      <div class="fb-dddice-drawer__header">
        <div class="fb-dddice-drawer__title-block">
          <p class="fb-dddice-drawer__eyebrow">Further Beyond</p>
          <h2 class="fb-dddice-drawer__title">DDDice</h2>
        </div>
        <button type="button" class="fb-dddice-drawer__toggle" aria-expanded="false">
          <span class="fb-dddice-drawer__toggle-copy">Open</span>
        </button>
      </div>
      <div class="fb-dddice-drawer__summary">
        <span class="fb-dddice-drawer__state" data-state="idle">Guest mode</span>
        <span class="fb-dddice-drawer__user" hidden>
          <span data-fb-dddice-role="user-kind">Guest</span> <strong class="fb-dddice-drawer__user-value"></strong>
        </span>
        <span class="fb-dddice-drawer__room" hidden>
          Room <strong class="fb-dddice-drawer__room-value"></strong>
        </span>
      </div>
      <div class="fb-dddice-drawer__panel" hidden>
        <p class="fb-dddice-drawer__status">
          <span class="fb-dddice-drawer__status-label">Status</span>
          <span class="fb-dddice-drawer__status-copy">Guest setup has not started yet.</span>
        </p>
        <div class="fb-dddice-drawer__stage" data-state="idle">
          <canvas
            class="fb-dddice-drawer__canvas"
            data-fb-dddice-role="canvas"
            width="296"
            height="180"
            aria-label="DDDice tray"
          ></canvas>
          <div class="fb-dddice-drawer__roll-output" data-fb-dddice-role="roll-output" aria-live="polite" hidden></div>
          <p class="fb-dddice-drawer__hint fb-dddice-drawer__stage-copy" data-fb-dddice-role="canvas-status">
            Connect a DDDice guest or account session to start the live dice tray.
          </p>
        </div>
        <label class="fb-dddice-drawer__field">
          <span class="fb-dddice-drawer__field-label">Room name</span>
          <input class="fb-dddice-drawer__input" data-fb-dddice-field="draftRoomName" type="text" placeholder="Campaign Table" />
        </label>
        <label class="fb-dddice-drawer__field">
          <span class="fb-dddice-drawer__field-label">Room slug or invite</span>
          <input class="fb-dddice-drawer__input" data-fb-dddice-field="draftRoomSlug" type="text" placeholder="abc123 or room link" />
        </label>
        <div class="fb-dddice-drawer__actions">
          <button type="button" data-fb-dddice-action="connect-guest">Connect guest</button>
          <button type="button" data-fb-dddice-action="create-room">Create room</button>
          <button type="button" data-fb-dddice-action="join-room">Join room</button>
        </div>
        <label class="fb-dddice-drawer__field">
          <span class="fb-dddice-drawer__field-label">Custom roll</span>
          <input class="fb-dddice-drawer__input" data-fb-dddice-role="custom-roll-input" type="text" placeholder="d20 + 2d6" />
        </label>
        <div class="fb-dddice-drawer__dice-row" aria-label="Quick add dice">
          <button type="button" data-fb-dddice-die="d4">d4</button>
          <button type="button" data-fb-dddice-die="d6">d6</button>
          <button type="button" data-fb-dddice-die="d8">d8</button>
          <button type="button" data-fb-dddice-die="d10">d10</button>
          <button type="button" data-fb-dddice-die="d12">d12</button>
          <button type="button" data-fb-dddice-die="d20">d20</button>
        </div>
        <div class="fb-dddice-drawer__actions fb-dddice-drawer__actions--secondary">
          <button type="button" data-fb-dddice-action="open-3d-room">View 3D room</button>
          <button type="button" data-fb-dddice-action="roll-custom">Roll custom</button>
        </div>
        <p class="fb-dddice-drawer__hint">
          Custom rolls post directly into the selected DDDice room. The 3D tray animates here, and View 3D room opens the full DDDice table.
        </p>
      </div>
    `;

    drawer
      .querySelector(".fb-dddice-drawer__toggle")
      ?.addEventListener("click", handleDddiceDrawerToggle);
    drawer.addEventListener("input", handleDddiceDraftInput);
    drawer.addEventListener("click", handleDddiceActionClick);
    drawer.addEventListener("keydown", handleDddiceDrawerKeydown);

    syncDddiceDrawer(drawer);
    return drawer;
  }

  function mountDddiceDrawer() {
    getDddiceDrawerDock()?.remove();
    resetDddiceSidebarLayout();

    if (!getExtensionSettings().dddiceEnabled) {
      destroyDddiceVisualizer();
      destroyDddiceEngine();
      removeDddiceScreenTray();
      removeDddiceNativePanel();
      removeDddiceRollerPanel();
      getDddiceDrawer()?.remove();
      const dock = getDddiceDrawerDock();
      if (dock instanceof HTMLElement) {
        unwrapDddiceDrawerDock(dock);
      }
      return false;
    }

    const standaloneDrawer = document.getElementById(DDDICE_DRAWER_ID);
    if (standaloneDrawer instanceof HTMLElement) {
      standaloneDrawer.remove();
    }

    const logMounted = mountDddiceNativePanel();
    const rollerMounted = mountDddiceRollerPanel();

    if (!logMounted && !rollerMounted) {
      getDddiceDrawer()?.remove();
      return false;
    }

    if (!logMounted) {
      removeDddiceNativePanel();
    }

    if (!rollerMounted) {
      removeDddiceRollerPanel();
    }

    return logMounted || rollerMounted;
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
    const dddiceEnabled = modal.querySelector("#fb-settings-dddice-enabled");
    const dddiceSuppressNativeDice = modal.querySelector(
      "#fb-settings-dddice-suppress-native-dice"
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

    if (dddiceEnabled) {
      dddiceEnabled.checked = !!settings.dddiceEnabled;
    }

    if (dddiceSuppressNativeDice) {
      dddiceSuppressNativeDice.checked = !!settings.dddiceSuppressNativeDice;
    }

    updateConfigFormDisabledState(settings);
    syncDddiceConfigPanel();
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
      dddiceEnabled:
        modal?.querySelector("#fb-settings-dddice-enabled")?.checked ??
        DEFAULT_EXTENSION_SETTINGS.dddiceEnabled,
      dddiceSuppressNativeDice:
        modal?.querySelector("#fb-settings-dddice-suppress-native-dice")
          ?.checked ?? DEFAULT_EXTENSION_SETTINGS.dddiceSuppressNativeDice,
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
          <section class="fb-config-modal__card">
            <label class="fb-config-modal__toggle" for="fb-settings-dddice-enabled">
              <span class="fb-config-modal__copy">
                <span class="fb-config-modal__label">DDDice dice replacement</span>
                <span class="fb-config-modal__description">Starts the DDDice integration on supported character-sheet roll targets and shows the Further Beyond roll tray.</span>
              </span>
              <input id="fb-settings-dddice-enabled" type="checkbox" />
            </label>
          </section>
          <section class="fb-config-modal__card">
            <label class="fb-config-modal__toggle" for="fb-settings-dddice-suppress-native-dice">
              <span class="fb-config-modal__copy">
                <span class="fb-config-modal__label">Only show DDDice rolls</span>
                <span class="fb-config-modal__description">When Further Beyond handles a supported native roll button, stop D&amp;D Beyond's own dice from triggering.</span>
              </span>
              <input id="fb-settings-dddice-suppress-native-dice" type="checkbox" />
            </label>
          </section>
        </form>
        <section class="fb-config-modal__card fb-config-modal__dddice-panel" data-fb-dddice-role="config-panel">
          <div class="fb-config-modal__section-header">
            <div>
              <p class="fb-config-modal__eyebrow">DDDice</p>
              <h3 class="fb-config-modal__section-title">Room and Session</h3>
            </div>
            <span class="fb-dddice-drawer__state" data-state="idle">Guest mode</span>
          </div>
          <div class="fb-dddice-drawer__summary">
            <span class="fb-dddice-drawer__user" hidden>
              <span data-fb-dddice-role="user-kind">Guest</span> <strong class="fb-dddice-drawer__user-value"></strong>
            </span>
            <span class="fb-dddice-drawer__room" hidden>
              Room <strong class="fb-dddice-drawer__room-value"></strong>
            </span>
          </div>
          <p class="fb-dddice-drawer__status">
            <span class="fb-dddice-drawer__status-label">Status</span>
            <span class="fb-dddice-drawer__status-copy">Guest setup has not started yet.</span>
          </p>
          <p class="fb-config-modal__hint" data-fb-dddice-role="config-hint">
            Use D&amp;D Beyond's bottom-left dice button to open the DDDice custom roller.
          </p>
          <label class="fb-dddice-drawer__field">
            <span class="fb-dddice-drawer__field-label">Dice skin</span>
            <select class="fb-dddice-drawer__input" data-fb-dddice-field="themeId" aria-label="DDDice dice skin"></select>
            <span class="fb-dddice-drawer__hint" data-fb-dddice-role="theme-hint">
              Connect a guest session or link your DDDice account to load the skins available in that dice box.
            </span>
          </label>
          <label class="fb-dddice-drawer__field">
            <span class="fb-dddice-drawer__field-label">Room name</span>
            <input class="fb-dddice-drawer__input" data-fb-dddice-field="draftRoomName" type="text" placeholder="Campaign Table" />
          </label>
          <label class="fb-dddice-drawer__field">
            <span class="fb-dddice-drawer__field-label">Room slug or invite</span>
            <input class="fb-dddice-drawer__input" data-fb-dddice-field="draftRoomSlug" type="text" placeholder="abc123 or room link" />
          </label>
          <div class="fb-dddice-drawer__actions">
            <button type="button" data-fb-dddice-action="connect-guest">Connect guest</button>
            <button type="button" data-fb-dddice-action="connect-account">Connect account</button>
            <button type="button" data-fb-dddice-action="create-room">Create room</button>
            <button type="button" data-fb-dddice-action="join-room">Join room</button>
          </div>
          <div class="fb-dddice-account-link" data-fb-dddice-role="account-activation" hidden>
            <span class="fb-dddice-drawer__field-label">Account link code</span>
            <strong class="fb-dddice-account-link__code" data-fb-dddice-role="activation-code">------</strong>
            <p class="fb-dddice-drawer__hint" data-fb-dddice-role="activation-copy">
              Open dddice.com/activate, sign in, and enter this code.
            </p>
            <div class="fb-dddice-drawer__actions fb-dddice-drawer__actions--secondary">
              <button type="button" data-fb-dddice-action="open-account-activation">Open DDDice activate</button>
              <button type="button" data-fb-dddice-action="cancel-account-connect">Cancel</button>
            </div>
          </div>
          <div class="fb-dddice-drawer__actions fb-dddice-drawer__actions--secondary">
            <button type="button" data-fb-dddice-action="open-3d-room">View 3D room</button>
          </div>
        </section>
        <p class="fb-config-modal__status" role="status" aria-live="polite"></p>
      </div>
    `;

    modal.addEventListener("click", handleConfigModalClick);
    modal.addEventListener("keydown", handleConfigModalKeydown);
    modal.addEventListener("input", handleDddiceDraftInput);
    modal.addEventListener("change", handleDddiceDraftInput);
    modal.addEventListener("click", handleDddiceActionClick);
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

    if (dddiceUiState.authToken) {
      void ensureDddiceThemeOptions(dddiceUiState.authToken, true).catch((error) => {
        console.error("[Further Beyond] Could not refresh DDDice dice skins.", error);
        setConfigStatus(
          error instanceof Error && error.message
            ? error.message
            : "Could not load DDDice dice skins.",
          "error"
        );
      });
    }

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
      dddiceEnabled: value?.dddiceEnabled === true,
      dddiceSuppressNativeDice: value?.dddiceSuppressNativeDice !== false,
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
      const previousToken = button.dataset.fbDddiceTarget || "";
      const cleanup = () => {
        if (button.dataset.fbDddiceTarget !== targetToken) {
          return;
        }

        if (previousToken) {
          button.dataset.fbDddiceTarget = previousToken;
        } else {
          delete button.dataset.fbDddiceTarget;
        }
      };

      button.dataset.fbDddiceTarget = targetToken;

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
    await ensureDddiceLocalStateLoaded();
    mountDddiceScreenTray();
    mountDddiceDrawer();
    syncDddiceSidebarAction(findDddiceInfoSidebar());
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
  window.addEventListener("pointerdown", handleDddiceNativeDicePressStart, true);
  window.addEventListener("mousedown", handleDddiceNativeDicePressStart, true);
  window.addEventListener("click", handleDddiceIntegratedDiceClick, true);
  window.addEventListener("click", handleDddiceDiceButtonClick, true);
  window.addEventListener("resize", scheduleDddiceDrawerPlacement, {
    passive: true,
  });
  window.addEventListener("scroll", scheduleDddiceDrawerPlacement, {
    passive: true,
  });

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
      destroyDddiceVisualizer();
      destroyDddiceEngine();
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
      window.removeEventListener("pointerdown", handleDddiceNativeDicePressStart, true);
      window.removeEventListener("mousedown", handleDddiceNativeDicePressStart, true);
      window.removeEventListener("click", handleDddiceIntegratedDiceClick, true);
      window.removeEventListener("click", handleDddiceDiceButtonClick, true);
      window.removeEventListener("resize", scheduleDddiceDrawerPlacement);
      window.removeEventListener("scroll", scheduleDddiceDrawerPlacement);
      window.clearTimeout(dddiceRuntimeState.accountActivationPollTimeoutId);
      window.clearTimeout(settingsStatusTimeoutId);
      window.clearTimeout(shortRestStatusTimeoutId);
    },
    { once: true }
  );
})();
