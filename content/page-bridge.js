(function () {
  "use strict";

  if (window.__fbPageBridgeInstalled) {
    return;
  }

  window.__fbPageBridgeInstalled = true;

  const REQUEST_EVENT = "fb:inventory-request";
  const RESPONSE_EVENT = "fb:inventory-response";
  const DEFAULT_INVENTORY_SETTINGS = Object.freeze({
    coinsHaveWeight: true,
    coinsPerSlot: 250,
  });
  const bridgeState = {
    requireFn: null,
    rulesConfigModule: null,
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

  function normalizeInventorySettings(value) {
    return {
      coinsHaveWeight: value?.coinsHaveWeight !== false,
      coinsPerSlot: parsePositiveInteger(
        value?.coinsPerSlot,
        DEFAULT_INVENTORY_SETTINGS.coinsPerSlot
      ),
    };
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
    const character = getCurrentRulesConfig()?.store?.getState?.()?.character;
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
})();