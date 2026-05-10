(function () {
  "use strict";

  if (window.__fbHarnessInstalled) {
    return;
  }

  const currentScript = document.currentScript;
  const baseUrl = currentScript
    ? new URL("..", currentScript.src).toString()
    : String(window.__fbHarnessBaseUrl || "").trim();
  const cacheBust = String(window.__fbHarnessCacheBust || Date.now()).trim();

  if (!baseUrl) {
    throw new Error(
      "Further Beyond harness needs a base URL. Load it from a served script or set window.__fbHarnessBaseUrl first."
    );
  }

  const STORAGE_PREFIX = "fb-harness:";
  const storageListeners = new Set();

  function readArea(areaName) {
    try {
      const rawValue = window.localStorage.getItem(`${STORAGE_PREFIX}${areaName}`);
      const parsedValue = rawValue ? JSON.parse(rawValue) : {};
      return parsedValue && typeof parsedValue === "object" ? parsedValue : {};
    } catch (_error) {
      return {};
    }
  }

  function writeArea(areaName, nextValue) {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${areaName}`,
      JSON.stringify(nextValue)
    );
  }

  function cloneValue(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function expandKeys(keys, storedState) {
    if (keys == null) {
      return Object.keys(storedState);
    }

    if (typeof keys === "string") {
      return [keys];
    }

    if (Array.isArray(keys)) {
      return keys.map((entry) => String(entry));
    }

    if (typeof keys === "object") {
      return Object.keys(keys);
    }

    return [];
  }

  function buildGetResult(keys, storedState) {
    const result = {};
    const keyList = expandKeys(keys, storedState);

    keyList.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(storedState, key)) {
        result[key] = cloneValue(storedState[key]);
        return;
      }

      if (keys && typeof keys === "object" && !Array.isArray(keys)) {
        result[key] = cloneValue(keys[key]);
      }
    });

    if (keys == null) {
      return cloneValue(storedState);
    }

    return result;
  }

  function emitStorageChanges(areaName, previousState, nextState) {
    const allKeys = new Set([
      ...Object.keys(previousState),
      ...Object.keys(nextState),
    ]);
    const changes = {};

    allKeys.forEach((key) => {
      const oldValue = previousState[key];
      const newValue = nextState[key];
      const oldJson = JSON.stringify(oldValue);
      const newJson = JSON.stringify(newValue);

      if (oldJson === newJson) {
        return;
      }

      changes[key] = {
        oldValue: cloneValue(oldValue),
        newValue: cloneValue(newValue),
      };
    });

    if (!Object.keys(changes).length) {
      return;
    }

    storageListeners.forEach((listener) => {
      try {
        listener(changes, areaName);
      } catch (error) {
        console.error("[Further Beyond Harness] Storage listener failed.", error);
      }
    });
  }

  function createStorageArea(areaName) {
    return {
      get(keys, callback) {
        const storedState = readArea(areaName);
        const result = buildGetResult(keys, storedState);
        callback?.(result);
      },
      set(items, callback) {
        const previousState = readArea(areaName);
        const nextState = {
          ...previousState,
          ...cloneValue(items || {}),
        };

        writeArea(areaName, nextState);
        emitStorageChanges(areaName, previousState, nextState);
        callback?.();
      },
      remove(keys, callback) {
        const previousState = readArea(areaName);
        const nextState = { ...previousState };
        const keyList = expandKeys(keys, previousState);

        keyList.forEach((key) => {
          delete nextState[key];
        });

        writeArea(areaName, nextState);
        emitStorageChanges(areaName, previousState, nextState);
        callback?.();
      },
      clear(callback) {
        const previousState = readArea(areaName);
        writeArea(areaName, {});
        emitStorageChanges(areaName, previousState, {});
        callback?.();
      },
    };
  }

  window.chrome = window.chrome || {};
  window.chrome.runtime = {
    ...(window.chrome.runtime || {}),
    id: window.chrome.runtime?.id || "further-beyond-browser-harness",
    lastError: null,
    getURL(path) {
      return new URL(String(path || ""), `${baseUrl.replace(/\/+$/, "")}/`).toString();
    },
  };

  window.chrome.storage = {
    ...(window.chrome.storage || {}),
    sync: createStorageArea("sync"),
    local: createStorageArea("local"),
    onChanged: {
      addListener(listener) {
        storageListeners.add(listener);
      },
      removeListener(listener) {
        storageListeners.delete(listener);
      },
    },
  };

  function injectStyle(relativePath) {
    const href = new URL(window.chrome.runtime.getURL(relativePath));
    href.searchParams.set("fbts", cacheBust);
    const hrefValue = href.toString();
    if (document.querySelector(`link[data-fb-harness-style="${hrefValue}"]`)) {
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = hrefValue;
    link.dataset.fbHarnessStyle = hrefValue;
    document.head.appendChild(link);
  }

  function injectScript(relativePath) {
    return new Promise((resolve, reject) => {
      const src = new URL(window.chrome.runtime.getURL(relativePath));
      src.searchParams.set("fbts", cacheBust);
      const srcValue = src.toString();
      const existingScript = document.querySelector(
        `script[data-fb-harness-script="${srcValue}"]`
      );

      if (existingScript) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = srcValue;
      script.async = false;
      script.dataset.fbHarnessScript = srcValue;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${relativePath}.`));
      document.documentElement.appendChild(script);
    });
  }

  window.__fbHarnessInstalled = true;
  window.__fbHarness = {
    baseUrl,
    cacheBust,
    resetStorage() {
      window.localStorage.removeItem(`${STORAGE_PREFIX}sync`);
      window.localStorage.removeItem(`${STORAGE_PREFIX}local`);
      console.log("[Further Beyond Harness] Cleared shimmed chrome.storage state.");
    },
  };

  injectStyle("content/content.css");
  injectScript("content/dddice-sdk.js")
    .then(() => injectScript("content/content.js"))
    .then(() => {
      console.log("[Further Beyond Harness] Injected Further Beyond content script.");
    })
    .catch((error) => {
      console.error("[Further Beyond Harness] Injection failed.", error);
    });
})();
