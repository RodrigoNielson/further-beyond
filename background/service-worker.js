/* =============================================
   Further Beyond – background service worker
   ============================================= */

importScripts("../shared/utils.js");

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    // Set default storage values on first install
    chrome.storage.local.set({
      conditions: {},
      spellSlots: getDefaultSpellSlots(),
      rollHistory: [],
    });
  }
});
