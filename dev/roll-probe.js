(function () {
  "use strict";

  if (window.__fbRollProbeInstalled) {
    return;
  }

  function buildSelectorChain(element) {
    const segments = [];
    let current = element;

    while (current instanceof Element && segments.length < 6) {
      let segment = current.tagName.toLowerCase();

      if (current.id) {
        segment += `#${current.id}`;
        segments.unshift(segment);
        break;
      }

      if (current.classList.length) {
        segment += `.${Array.from(current.classList).slice(0, 3).join(".")}`;
      }

      if (current.getAttribute("data-testid")) {
        segment += `[data-testid="${current.getAttribute("data-testid")}"]`;
      }

      segments.unshift(segment);
      current = current.parentElement;
    }

    return segments.join(" > ");
  }

  function captureElementDetails(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    const closestButton = element.closest("button, a, [role='button']");
    const closestRollLike = element.closest(
      "[data-testid], [class*='dice'], [class*='roll'], [data-tooltip-href], [aria-label*='roll' i]"
    );

    return {
      text: String(element.textContent || "").replace(/\s+/g, " ").trim(),
      tagName: element.tagName.toLowerCase(),
      className: element.className || "",
      id: element.id || "",
      role: element.getAttribute("role") || "",
      dataset: { ...element.dataset },
      ariaLabel: element.getAttribute("aria-label") || "",
      title: element.getAttribute("title") || "",
      selectorChain: buildSelectorChain(element),
      closestButton: closestButton
        ? {
            text: String(closestButton.textContent || "")
              .replace(/\s+/g, " ")
              .trim(),
            tagName: closestButton.tagName.toLowerCase(),
            className: closestButton.className || "",
            dataset: { ...closestButton.dataset },
            selectorChain: buildSelectorChain(closestButton),
          }
        : null,
      closestRollLike: closestRollLike
        ? {
            text: String(closestRollLike.textContent || "")
              .replace(/\s+/g, " ")
              .trim(),
            tagName: closestRollLike.tagName.toLowerCase(),
            className: closestRollLike.className || "",
            dataset: { ...closestRollLike.dataset },
            selectorChain: buildSelectorChain(closestRollLike),
          }
        : null,
    };
  }

  function logEventDetails(event) {
    const details = captureElementDetails(event.target);
    if (!details) {
      return;
    }

    console.group("[Further Beyond Roll Probe]");
    console.log("Trigger", `${event.type} on ${details.selectorChain}`);
    console.log(details);
    console.groupEnd();
  }

  function handleProbeEvent(event) {
    if (!event.altKey || !event.shiftKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    logEventDetails(event);
  }

  document.addEventListener("click", handleProbeEvent, true);
  document.addEventListener("contextmenu", handleProbeEvent, true);

  window.__fbRollProbeInstalled = true;
  window.__fbRollProbe = {
    inspect(element) {
      const details = captureElementDetails(element);
      console.log("[Further Beyond Roll Probe] Manual inspect", details);
      return details;
    },
    dispose() {
      document.removeEventListener("click", handleProbeEvent, true);
      document.removeEventListener("contextmenu", handleProbeEvent, true);
      delete window.__fbRollProbeInstalled;
      delete window.__fbRollProbe;
      console.log("[Further Beyond Roll Probe] Disposed.");
    },
  };

  console.log(
    "[Further Beyond Roll Probe] Hold Alt+Shift and click or right-click a roll target to log its DOM details."
  );
})();
