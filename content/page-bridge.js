(function () {
  "use strict";

  if (window.__fbPageBridgeInstalled) {
    return;
  }

  window.__fbPageBridgeInstalled = true;

  const REQUEST_EVENT = "fb:inventory-request";
  const RESPONSE_EVENT = "fb:inventory-response";
  const SHORT_REST_REQUEST_EVENT = "fb:short-rest-request";
  const SHORT_REST_RESPONSE_EVENT = "fb:short-rest-response";
  const SHORT_REST_STORAGE_KEY_PREFIX = "fb:used-hit-dice:";
  const SHORT_REST_COMMIT_ACTION = "character.SHORT_REST_COMMIT";
  const LONG_REST_COMMIT_ACTION = "character.LONG_REST_COMMIT";
  const DEFAULT_INVENTORY_SETTINGS = Object.freeze({
    coinsHaveWeight: true,
    coinsPerSlot: 250,
  });
  const bridgeState = {
    requireFn: null,
    rulesConfigModule: null,
    characterAppModule: null,
    dispatchHookInstalled: false,
  };
  const COIN_KEYS = ["cp", "sp", "ep", "gp", "pp"];

  function getWebpackRequire() {
    if (bridgeState.requireFn) {
      return bridgeState.requireFn;
    }

    const chunk = window.webpackChunk_dndbeyond_character_app;
    if (!Array.isArray(chunk)) {
      return null;
    }

    let capturedRequire = null;
    chunk.push([[Symbol("fb-page-bridge")], {}, (requireFn) => {
      capturedRequire = requireFn;
    }]);

    bridgeState.requireFn = capturedRequire;
    return bridgeState.requireFn;
  }

  function getRulesConfigModule(requireFn) {
    if (bridgeState.rulesConfigModule) {
      return bridgeState.rulesConfigModule;
    }

    for (const [id, factory] of Object.entries(requireFn.m || {})) {
      const source = String(factory);
      if (
        source.includes("configureRulesEngine") &&
        source.includes("getCurrentRulesEngineConfig") &&
        source.includes("messageBroker")
      ) {
        bridgeState.rulesConfigModule = requireFn(id);
        return bridgeState.rulesConfigModule;
      }
    }

    return null;
  }

  function getCharacterAppModule(requireFn) {
    if (bridgeState.characterAppModule) {
      return bridgeState.characterAppModule;
    }

    for (const [id, factory] of Object.entries(requireFn.m || {})) {
      const source = String(factory);
      if (
        source.includes("postCharacterRestShort") &&
        source.includes("characterActions") &&
        source.includes("ClassUtils")
      ) {
        bridgeState.characterAppModule = requireFn(id);
        return bridgeState.characterAppModule;
      }
    }

    return null;
  }

  function getCurrentRulesConfig() {
    const requireFn = getWebpackRequire();
    if (!requireFn) {
      return null;
    }

    const rulesConfigModule = getRulesConfigModule(requireFn);
    if (!rulesConfigModule || typeof rulesConfigModule.getCurrentRulesEngineConfig !== "function") {
      return null;
    }

    return rulesConfigModule.getCurrentRulesEngineConfig();
  }

  function getCharacterStore() {
    return getCurrentRulesConfig()?.store || null;
  }

  function getCurrentCharacter() {
    return getCharacterStore()?.getState?.()?.character || null;
  }

  function getCharacterKey(character) {
    return String(character?.id || "");
  }

  function getEffectiveStat(character, statId) {
    const baseStat = Array.isArray(character?.stats)
      ? character.stats.find((stat) => stat.id === statId)
      : null;
    const bonusStat = Array.isArray(character?.bonusStats)
      ? character.bonusStats.find((stat) => stat.id === statId)
      : null;
    const overrideStat = Array.isArray(character?.overrideStats)
      ? character.overrideStats.find((stat) => stat.id === statId)
      : null;

    if (Number.isFinite(overrideStat?.value)) {
      return overrideStat.value;
    }

    const baseValue = Number.isFinite(baseStat?.value) ? baseStat.value : null;
    const bonusValue = Number.isFinite(bonusStat?.value) ? bonusStat.value : 0;

    return Number.isFinite(baseValue) ? baseValue + bonusValue : null;
  }

  function getCurrencyAmount(currency) {
    if (Number.isFinite(currency)) {
      return currency;
    }

    if (Number.isFinite(currency?.value)) {
      return currency.value;
    }

    if (Number.isFinite(currency?.quantity)) {
      return currency.quantity;
    }

    return 0;
  }

  function parsePositiveInteger(value, fallbackValue) {
    const parsedValue = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsedValue) && parsedValue > 0
      ? parsedValue
      : fallbackValue;
  }

  function parseNonNegativeInteger(value) {
    const parsedValue = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
  }

  function normalizeInventorySettings(value) {
    return {
      coinsHaveWeight: value?.coinsHaveWeight !== false,
      coinsPerSlot: parsePositiveInteger(
        value?.coinsPerSlot,
        DEFAULT_INVENTORY_SETTINGS.coinsPerSlot
      ),
    };
  }

  function normalizeHitDiceUsageMap(value) {
    if (!value || typeof value !== "object") {
      return {};
    }

    return Object.entries(value).reduce((usage, entry) => {
      const [classId, used] = entry;
      const normalizedClassId = String(classId || "").trim();
      if (!normalizedClassId) {
        return usage;
      }

      usage[normalizedClassId] = parseNonNegativeInteger(used);
      return usage;
    }, {});
  }

  function getCharacterHitDiceUsage(character) {
    return (Array.isArray(character?.classes) ? character.classes : []).reduce(
      (usage, characterClass) => {
        const classId = String(characterClass?.id || "").trim();
        if (!classId) {
          return usage;
        }

        usage[classId] = parseNonNegativeInteger(characterClass?.hitDiceUsed);
        return usage;
      },
      {}
    );
  }

  function createZeroHitDiceUsage(character) {
    return (Array.isArray(character?.classes) ? character.classes : []).reduce(
      (usage, characterClass) => {
        const classId = String(characterClass?.id || "").trim();
        if (!classId) {
          return usage;
        }

        usage[classId] = 0;
        return usage;
      },
      {}
    );
  }

  function mergeHitDiceUsage(character, usage) {
    const baseUsage = createZeroHitDiceUsage(character);
    const normalizedUsage = normalizeHitDiceUsageMap(usage);

    Object.keys(baseUsage).forEach((classId) => {
      if (Object.prototype.hasOwnProperty.call(normalizedUsage, classId)) {
        baseUsage[classId] = normalizedUsage[classId];
      }
    });

    return baseUsage;
  }

  function hasHitDiceUsageChanges(currentUsage, nextUsage) {
    const classIds = new Set([
      ...Object.keys(currentUsage || {}),
      ...Object.keys(nextUsage || {}),
    ]);

    for (const classId of classIds) {
      if (
        parseNonNegativeInteger(currentUsage?.[classId]) !==
        parseNonNegativeInteger(nextUsage?.[classId])
      ) {
        return true;
      }
    }

    return false;
  }

  function findReactFiber(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber$"));
    return fiberKey ? element[fiberKey] : null;
  }

  function findShortRestInstance() {
    const buttons = Array.from(document.querySelectorAll("button"));
    const shortRestButton = buttons.find((button) =>
      /take short rest/i.test(button.textContent || "")
    );

    if (!shortRestButton) {
      return null;
    }

    let currentFiber = findReactFiber(shortRestButton);
    while (currentFiber) {
      const stateNode = currentFiber.stateNode;
      if (
        stateNode &&
        typeof stateNode.handleSave === "function" &&
        typeof stateNode.handleSlotSet === "function" &&
        stateNode.state &&
        stateNode.props?.classes
      ) {
        return stateNode;
      }

      currentFiber = currentFiber.return;
    }

    return null;
  }

  function syncShortRestInstance(shortRestInstance, character, hitDiceUsage) {
    if (!shortRestInstance || typeof shortRestInstance.setState !== "function") {
      return;
    }

    const mergedUsage = mergeHitDiceUsage(character, hitDiceUsage);
    const zeroUsage = createZeroHitDiceUsage(character);

    shortRestInstance.setState({
      hitDiceUsed: mergedUsage,
      originalHitDiceUsed: mergedUsage,
      currentHitDiceCount: zeroUsage,
      hitDiceSlotsEnabled: true,
    });
  }

  function getHitDiceStorageKey(characterKey) {
    return `${SHORT_REST_STORAGE_KEY_PREFIX}${characterKey}`;
  }

  function loadSavedHitDiceUsage(characterKey) {
    if (!characterKey) {
      return {};
    }

    try {
      const rawValue = window.localStorage.getItem(
        getHitDiceStorageKey(characterKey)
      );
      return normalizeHitDiceUsageMap(rawValue ? JSON.parse(rawValue) : {});
    } catch (error) {
      return {};
    }
  }

  function saveHitDiceUsage(characterKey, usage) {
    if (!characterKey) {
      return;
    }

    const normalizedUsage = normalizeHitDiceUsageMap(usage);
    const hasSavedUsage = Object.values(normalizedUsage).some((used) => used > 0);

    try {
      if (!hasSavedUsage) {
        window.localStorage.removeItem(getHitDiceStorageKey(characterKey));
        return;
      }

      window.localStorage.setItem(
        getHitDiceStorageKey(characterKey),
        JSON.stringify(normalizedUsage)
      );
    } catch (error) {
      // Ignore storage failures and fall back to the live modal state.
    }
  }

  function clearSavedHitDiceUsage(characterKey) {
    if (!characterKey) {
      return;
    }

    try {
      window.localStorage.removeItem(getHitDiceStorageKey(characterKey));
    } catch (error) {
      // Ignore storage failures.
    }
  }

  function ensureDispatchHook() {
    if (bridgeState.dispatchHookInstalled) {
      return;
    }

    const store = getCharacterStore();
    if (!store || typeof store.dispatch !== "function") {
      return;
    }

    const originalDispatch = store.dispatch.bind(store);
    store.dispatch = (action) => {
      const result = originalDispatch(action);
      if (
        action?.type === SHORT_REST_COMMIT_ACTION ||
        action?.type === LONG_REST_COMMIT_ACTION
      ) {
        clearSavedHitDiceUsage(getCharacterKey(getCurrentCharacter()));
      }

      return result;
    };

    bridgeState.dispatchHookInstalled = true;
  }

  function getEffectiveHitDiceUsage(character) {
    ensureDispatchHook();

    const characterKey = getCharacterKey(character);
    const currentUsage = getCharacterHitDiceUsage(character);
    const storedUsage = loadSavedHitDiceUsage(characterKey);
    const effectiveUsage = { ...currentUsage };
    let hasStoredUsage = false;

    Object.keys(effectiveUsage).forEach((classId) => {
      const storedValue = parseNonNegativeInteger(storedUsage[classId]);
      if (storedValue > effectiveUsage[classId]) {
        effectiveUsage[classId] = storedValue;
        hasStoredUsage = true;
      }
    });

    if (!hasStoredUsage) {
      clearSavedHitDiceUsage(characterKey);
      return {
        currentUsage,
        storedUsage: {},
        effectiveUsage,
      };
    }

    return {
      currentUsage,
      storedUsage,
      effectiveUsage,
    };
  }

  function syncShortRestInstance(shortRestInstance, character, hitDiceUsage) {
    if (!shortRestInstance || typeof shortRestInstance.setState !== "function") {
      return;
    }

    const mergedUsage = mergeHitDiceUsage(character, hitDiceUsage);
    const zeroUsage = createZeroHitDiceUsage(character);

    shortRestInstance.setState({
      hitDiceUsed: mergedUsage,
      originalHitDiceUsed: mergedUsage,
      currentHitDiceCount: zeroUsage,
      hitDiceSlotsEnabled: true,
    });
  }

  function syncShortRestHitDiceUsage(hitDiceUsageInput) {
    const character = getCurrentCharacter();
    const shortRestInstance = findShortRestInstance();
    const fallbackUsage = getEffectiveHitDiceUsage(character).effectiveUsage;
    const nextUsage = mergeHitDiceUsage(character, hitDiceUsageInput || fallbackUsage);

    if (shortRestInstance && character) {
      syncShortRestInstance(shortRestInstance, character, nextUsage);
    }

    return createShortRestSnapshot();
  }

  function createShortRestSnapshot() {
    const character = getCurrentCharacter();
    const usageState = getEffectiveHitDiceUsage(character);
    const classes = Array.isArray(character?.classes) ? character.classes : [];

    return {
      characterKey: getCharacterKey(character),
      classes: classes.map((characterClass) => {
        const classId = String(characterClass?.id || "").trim();
        return {
          id: classId,
          name: characterClass?.definition?.name || "",
          totalHitDice: parseNonNegativeInteger(characterClass?.level),
          currentUsedHitDice: usageState.currentUsage[classId] || 0,
          storedUsedHitDice: usageState.storedUsage[classId] || 0,
          effectiveUsedHitDice: usageState.effectiveUsage[classId] || 0,
        };
      }),
    };
  }

  function saveShortRestHitDiceUsage(hitDiceUsageInput) {
    const character = getCurrentCharacter();
    const characterKey = getCharacterKey(character);
    const usageState = getEffectiveHitDiceUsage(character);
    const nextUsage = mergeHitDiceUsage(character, hitDiceUsageInput);
    const storageUsage = {};

    Object.keys(nextUsage).forEach((classId) => {
      if (nextUsage[classId] > (usageState.currentUsage[classId] || 0)) {
        storageUsage[classId] = nextUsage[classId];
      }
    });

    saveHitDiceUsage(characterKey, storageUsage);
    syncShortRestHitDiceUsage(nextUsage);
    return createShortRestSnapshot();
  }

  function getTotalCoins(character) {
    const currencies = character?.currencies;
    if (!currencies) {
      return 0;
    }

    return COIN_KEYS.reduce(
      (total, key) => total + getCurrencyAmount(currencies[key]),
      0
    );
  }

  function getCoinSlots(character, settings) {
    if (!settings.coinsHaveWeight) {
      return null;
    }

    return Math.floor(getTotalCoins(character) / settings.coinsPerSlot);
  }

  function createInventorySnapshot(settingsInput) {
    const settings = normalizeInventorySettings(settingsInput);
    const character = getCurrentCharacter();
    const inventory = Array.isArray(character?.inventory) ? character.inventory : [];
    const itemSlots = inventory.filter((item) => !item?.definition?.isContainer).length;
    const totalCoins = getTotalCoins(character);
    const coinSlots = getCoinSlots(character, settings);
    const strengthScore = getEffectiveStat(character, 1);

    return {
      characterKey: String(character?.id || ""),
      totalCoins,
      coinSlots,
      usedSlots: itemSlots + (Number.isFinite(coinSlots) ? coinSlots : 0),
      capacity: Number.isFinite(strengthScore) ? strengthScore + 8 : null,
    };
  }

  function dispatchResponse(requestId, detail) {
    window.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail: {
          requestId,
          ...detail,
        },
      })
    );
  }

  function dispatchShortRestResponse(requestId, detail) {
    window.dispatchEvent(
      new CustomEvent(SHORT_REST_RESPONSE_EVENT, {
        detail: {
          requestId,
          ...detail,
        },
      })
    );
  }

  window.addEventListener(REQUEST_EVENT, (event) => {
    const detail = event.detail || {};
    if (!detail.requestId) {
      return;
    }

    try {
      dispatchResponse(detail.requestId, {
        ok: true,
        snapshot: createInventorySnapshot(detail.settings),
      });
    } catch (error) {
      dispatchResponse(detail.requestId, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  window.addEventListener(SHORT_REST_REQUEST_EVENT, (event) => {
    const detail = event.detail || {};
    if (!detail.requestId) {
      return;
    }

    try {
      const snapshot =
        detail.action === "save-hit-dice"
          ? saveShortRestHitDiceUsage(detail.hitDiceUsed)
          : detail.action === "sync-hit-dice"
            ? syncShortRestHitDiceUsage(detail.hitDiceUsed)
            : createShortRestSnapshot();

      dispatchShortRestResponse(detail.requestId, {
        ok: true,
        snapshot,
      });
    } catch (error) {
      dispatchShortRestResponse(detail.requestId, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
})();