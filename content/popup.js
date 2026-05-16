(function () {
  "use strict";

  const EXTENSION_SETTINGS_STORAGE_KEY = "fb:settings";
  const DEFAULT_SETTINGS = Object.freeze({
    itemSlotsEnabled: true,
    coinsHaveWeight: true,
    coinsPerSlot: 250,
    shortRestHitDiceEnabled: true,
    diceEnabled: false,
    diceSuppressNativeDice: true,
  });

  let statusTimeoutId = null;

  function parsePositiveInteger(value, fallbackValue) {
    const parsedValue = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsedValue) && parsedValue > 0
      ? parsedValue
      : fallbackValue;
  }

  function normalizeSettings(value) {
    return {
      itemSlotsEnabled: value?.itemSlotsEnabled !== false,
      coinsHaveWeight: value?.coinsHaveWeight !== false,
      coinsPerSlot: parsePositiveInteger(
        value?.coinsPerSlot,
        DEFAULT_SETTINGS.coinsPerSlot
      ),
      shortRestHitDiceEnabled: value?.shortRestHitDiceEnabled !== false,
      diceEnabled: value?.diceEnabled === true,
      diceSuppressNativeDice: value?.diceSuppressNativeDice !== false,
    };
  }

  function readStoredSettings() {
    return new Promise((resolve, reject) => {
      if (!chrome?.storage?.sync?.get) {
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }

      try {
        chrome.storage.sync.get(EXTENSION_SETTINGS_STORAGE_KEY, (result) => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          resolve(normalizeSettings(result?.[EXTENSION_SETTINGS_STORAGE_KEY]));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function writeStoredSettings(settings) {
    return new Promise((resolve, reject) => {
      if (!chrome?.storage?.sync?.set) {
        resolve();
        return;
      }

      try {
        chrome.storage.sync.set(
          {
            [EXTENSION_SETTINGS_STORAGE_KEY]: settings,
          },
          () => {
            if (chrome.runtime?.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }

            resolve();
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  function setStatus(message, state) {
    const status = document.getElementById("status");
    if (!status) {
      return;
    }

    window.clearTimeout(statusTimeoutId);
    statusTimeoutId = null;
    status.textContent = message || "";

    if (state) {
      status.dataset.state = state;
    } else {
      delete status.dataset.state;
    }

    if (message && state !== "error") {
      statusTimeoutId = window.setTimeout(() => {
        setStatus("", "");
      }, 1400);
    }
  }

  function updateDisabledState(settings) {
    const coinSettingsCard = document.getElementById("coin-settings-card");
    const coinsHaveWeight = document.getElementById("coins-have-weight");
    const coinsPerSlot = document.getElementById("coins-per-slot");

    const itemSlotsEnabled = !!settings.itemSlotsEnabled;
    const coinsEnabled = itemSlotsEnabled && !!settings.coinsHaveWeight;

    if (coinSettingsCard) {
      coinSettingsCard.setAttribute(
        "aria-disabled",
        itemSlotsEnabled ? "false" : "true"
      );
    }

    if (coinsHaveWeight) {
      coinsHaveWeight.disabled = !itemSlotsEnabled;
    }

    if (coinsPerSlot) {
      coinsPerSlot.disabled = !coinsEnabled;
    }
  }

  function applySettingsToForm(settings) {
    const itemSlotsEnabled = document.getElementById("item-slots-enabled");
    const coinsHaveWeight = document.getElementById("coins-have-weight");
    const coinsPerSlot = document.getElementById("coins-per-slot");
    const shortRestHitDiceEnabled = document.getElementById(
      "short-rest-hit-dice-enabled"
    );
    const diceEnabled = document.getElementById("dice-enabled");
    const diceSuppressNativeDice = document.getElementById(
      "dice-suppress-native-dice"
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

    if (diceEnabled) {
      diceEnabled.checked = !!settings.diceEnabled;
    }

    if (diceSuppressNativeDice) {
      diceSuppressNativeDice.checked = !!settings.diceSuppressNativeDice;
    }

    updateDisabledState(settings);
  }

  function readSettingsFromForm() {
    return normalizeSettings({
      itemSlotsEnabled:
        document.getElementById("item-slots-enabled")?.checked ??
        DEFAULT_SETTINGS.itemSlotsEnabled,
      coinsHaveWeight:
        document.getElementById("coins-have-weight")?.checked ??
        DEFAULT_SETTINGS.coinsHaveWeight,
      coinsPerSlot:
        document.getElementById("coins-per-slot")?.value ??
        DEFAULT_SETTINGS.coinsPerSlot,
      shortRestHitDiceEnabled:
        document.getElementById("short-rest-hit-dice-enabled")?.checked ??
        DEFAULT_SETTINGS.shortRestHitDiceEnabled,
      diceEnabled:
        document.getElementById("dice-enabled")?.checked ??
        DEFAULT_SETTINGS.diceEnabled,
      diceSuppressNativeDice:
        document.getElementById("dice-suppress-native-dice")?.checked ??
        DEFAULT_SETTINGS.diceSuppressNativeDice,
    });
  }

  async function persistSettings() {
    const settings = readSettingsFromForm();
    applySettingsToForm(settings);

    try {
      await writeStoredSettings(settings);
      setStatus("Saved.", "ok");
    } catch (error) {
      console.error("[Further Beyond] Could not save extension settings.", error);
      setStatus("Could not save settings.", "error");
    }
  }

  async function initializePopup() {
    const form = document.getElementById("settings-form");
    if (!form) {
      return;
    }

    try {
      const settings = await readStoredSettings();
      applySettingsToForm(settings);
    } catch (error) {
      console.error("[Further Beyond] Could not load extension settings.", error);
      applySettingsToForm(DEFAULT_SETTINGS);
      setStatus("Using default settings.", "error");
    }

    form.addEventListener("change", () => {
      persistSettings();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initializePopup();
  });
})();