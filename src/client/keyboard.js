const STORAGE_KEY = "tigermonkey-keyboard-controls";
const TARGET_SELECTOR = [
  ".card.selectable:not(:disabled)",
  "#deck.ready:not(:disabled)",
  "#discard.ready",
  "#actions button:not(:disabled)",
].join(", ");

export function setupKeyboardControls() {
  const setting = document.getElementById("keyboardSetting");
  const toggle = document.getElementById("keyboardControlsToggle");
  const desktopQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
  if (!setting || !toggle) return;

  let preferred = loadPreference();
  let enabled = false;
  let lastTargetKey = "";
  let updateQueued = false;

  function applyMode() {
    setting.hidden = !desktopQuery.matches;
    toggle.checked = preferred;
    enabled = desktopQuery.matches && preferred;
    document.documentElement.toggleAttribute("data-keyboard-controls", enabled);
    updateTargets();
  }

  function updateTargets() {
    for (const target of document.querySelectorAll(".keyboard-target")) {
      target.classList.remove("keyboard-target");
      if (target.dataset.keyboardTabindex !== undefined) {
        const previous = target.dataset.keyboardTabindex;
        if (previous) target.setAttribute("tabindex", previous);
        else target.removeAttribute("tabindex");
        delete target.dataset.keyboardTabindex;
      }
    }
    if (!enabled) return;

    for (const target of gameTargets()) {
      target.classList.add("keyboard-target");
      if (!(target instanceof HTMLButtonElement)) {
        target.dataset.keyboardTabindex = target.getAttribute("tabindex") || "";
        target.tabIndex = 0;
      }
    }
  }

  function queueTargetUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    queueMicrotask(() => {
      updateQueued = false;
      updateTargets();
      restoreGameFocus();
    });
  }

  function restoreGameFocus() {
    if (!enabled || document.querySelector("dialog[open]") || document.activeElement !== document.body) return;
    const targets = gameTargets();
    if (!targets.length) return;
    const previous = targets.find((target) => targetKey(target) === lastTargetKey);
    focusTarget(previous || targets[0]);
  }

  toggle.addEventListener("change", () => {
    preferred = toggle.checked;
    savePreference(preferred);
    applyMode();
  });

  desktopQuery.addEventListener("change", applyMode);

  document.addEventListener("focusin", (event) => {
    if (event.target instanceof Element && event.target.matches(TARGET_SELECTOR)) {
      lastTargetKey = targetKey(event.target);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!enabled || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (event.target instanceof Element && event.target.closest("dialog, input, textarea, select, [contenteditable='true']")) return;

    const targets = gameTargets();
    const current = event.target instanceof Element && event.target.matches(TARGET_SELECTOR) ? event.target : null;

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      if (!targets.length) return;
      event.preventDefault();
      focusTarget(current ? directionalTarget(targets, current, event.key) : targets[0]);
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && current?.id === "discard") {
      event.preventDefault();
      current.click();
    }
  });

  document.getElementById("settingsDialog")?.addEventListener("close", () => {
    if (!enabled) return;
    queueMicrotask(() => {
      const targets = gameTargets();
      if (targets.length) focusTarget(targets.find((target) => targetKey(target) === lastTargetKey) || targets[0]);
    });
  });

  new MutationObserver(queueTargetUpdate).observe(document.querySelector(".app") || document.body, {
    childList: true,
    subtree: true,
  });

  applyMode();
}

function gameTargets() {
  return [...document.querySelectorAll(TARGET_SELECTOR)].filter((target) => isVisible(target));
}

function isVisible(element) {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function focusTarget(target) {
  target?.focus({ preventScroll: true });
}

function targetKey(target) {
  if (target.id) return target.id;
  if (target.classList.contains("card")) {
    return `card:${target.dataset.owner || "pile"}:${target.dataset.index || target.dataset.cardId || "top"}`;
  }
  const siblings = target.parentElement ? [...target.parentElement.children] : [];
  return `action:${siblings.indexOf(target)}:${target.textContent.trim()}`;
}

function directionalTarget(targets, current, key) {
  const origin = center(current);
  const direction = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  }[key];
  const vertical = direction[1] !== 0;
  let best = null;
  let bestScore = Infinity;

  for (const candidate of targets) {
    if (candidate === current) continue;
    const point = center(candidate);
    const primary = vertical ? (point.y - origin.y) * direction[1] : (point.x - origin.x) * direction[0];
    if (primary <= 1) continue;
    const cross = vertical ? Math.abs(point.x - origin.x) : Math.abs(point.y - origin.y);
    const score = primary * 4 + cross;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (best) return best;

  // Wrap to the far edge while staying as close as possible on the other axis.
  const ordered = targets.filter((target) => target !== current).sort((a, b) => {
    const aPoint = center(a);
    const bPoint = center(b);
    const aPrimary = vertical ? aPoint.y * direction[1] : aPoint.x * direction[0];
    const bPrimary = vertical ? bPoint.y * direction[1] : bPoint.x * direction[0];
    if (aPrimary !== bPrimary) return aPrimary - bPrimary;
    const aCross = vertical ? Math.abs(aPoint.x - origin.x) : Math.abs(aPoint.y - origin.y);
    const bCross = vertical ? Math.abs(bPoint.x - origin.x) : Math.abs(bPoint.y - origin.y);
    return aCross - bCross;
  });
  return ordered[0] || current;
}

function center(element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function loadPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function savePreference(value) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {}
}
