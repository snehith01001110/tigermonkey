const STORAGE_KEY = "tigermonkey-keyboard-controls";
const TARGET_SELECTOR = [
  ".card.selectable:not(:disabled)",
  "#deck.ready:not(:disabled)",
  "#discard.ready",
  "#actions button:not(:disabled)",
].join(", ");

const EXTRA_CARD_KEYS = ["9", "0", "q", "w", "e", "r", "t", "u", "i", "o", "p", "a", "f", "g", "h", "j", "l", "z", "v", "b", "n"];
const CABO_PLAYER_CARD_KEYS = ["1", "2", "3", "4", ...EXTRA_CARD_KEYS];
const YANIV_PLAYER_CARD_KEYS = ["1", "2", "3", "4", "5"];
const GOLF_TABLEAU_KEYS = ["1", "2", "3", "4", "5", "6", "7"];
const OPPONENT_CARD_KEYS = ["5", "6", "7", "8", ...EXTRA_CARD_KEYS];

export function setupKeyboardControls() {
  const setting = document.getElementById("keyboardSetting");
  const toggle = document.getElementById("keyboardControlsToggle");
  const desktopQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
  if (!setting || !toggle) return;

  let preferred = loadPreference();
  let enabled = false;
  let updateQueued = false;

  function applyMode() {
    setting.hidden = !desktopQuery.matches;
    toggle.checked = preferred;
    enabled = desktopQuery.matches && preferred;
    document.documentElement.toggleAttribute("data-keyboard-controls", enabled);
    refreshShortcutHints(enabled);
  }

  function queueHintUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    queueMicrotask(() => {
      updateQueued = false;
      refreshShortcutHints(enabled);
    });
  }

  toggle.addEventListener("change", () => {
    preferred = toggle.checked;
    savePreference(preferred);
    applyMode();
  });

  desktopQuery.addEventListener("change", applyMode);

  document.addEventListener("keydown", (event) => {
    if (!enabled || event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (event.target instanceof Element && event.target.closest("dialog, input, textarea, select, [contenteditable='true']")) return;

    const key = eventShortcutKey(event);
    if (!key) return;
    const target = gameTargets().find((candidate) => shortcutForElement(candidate)?.key === key);
    if (!target) return;

    event.preventDefault();
    target.click();
  });

  // Capture the activation before the game rerenders and removes the pressed control.
  document.addEventListener("click", (event) => {
    if (!enabled || !(event.target instanceof Element)) return;
    const target = event.target.closest("[data-keyboard-shortcut]");
    if (target) flashShortcut(target);
  }, true);

  new MutationObserver(queueHintUpdate).observe(document.querySelector(".app") || document.body, {
    childList: true,
    subtree: true,
  });

  applyMode();
}

function refreshShortcutHints(enabled) {
  for (const target of document.querySelectorAll("[data-keyboard-shortcut]")) {
    const shortcut = enabled && target.matches(TARGET_SELECTOR) ? shortcutForElement(target) : null;
    if (!shortcut || shortcut.key !== target.dataset.keyboardShortcut) clearShortcut(target);
  }
  if (!enabled) return;

  for (const target of gameTargets()) {
    const shortcut = shortcutForElement(target);
    if (!shortcut) continue;
    target.dataset.keyboardShortcut = shortcut.key;
    target.setAttribute("aria-keyshortcuts", shortcut.aria);
    target.classList.add("shortcut-host");

    let hint = directHint(target);
    if (!hint) {
      hint = document.createElement("span");
      hint.className = "shortcut-hint";
      hint.setAttribute("aria-hidden", "true");
      target.appendChild(hint);
    }
    if (hint.textContent !== shortcut.display) hint.textContent = shortcut.display;
  }
}

function clearShortcut(target) {
  delete target.dataset.keyboardShortcut;
  target.removeAttribute("aria-keyshortcuts");
  target.classList.remove("shortcut-host");
  directHint(target)?.remove();
}

function directHint(target) {
  return [...target.children].find((child) => child.classList.contains("shortcut-hint")) || null;
}

function gameTargets() {
  return [...document.querySelectorAll(TARGET_SELECTOR)].filter((target) => isVisible(target));
}

function isVisible(element) {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function shortcutForElement(target) {
  return shortcutForDescriptor({
    id: target.id,
    owner: target.dataset.owner,
    index: target.dataset.index,
    label: labelWithoutHint(target),
    gameType: document.body.dataset.game,
  });
}

function labelWithoutHint(target) {
  return [...target.childNodes]
    .filter((node) => !(node instanceof Element && node.classList.contains("shortcut-hint")))
    .map((node) => node.textContent)
    .join("")
    .trim();
}

export function shortcutForDescriptor({ id = "", owner = "", index = -1, label = "", gameType = "cabo" } = {}) {
  if (id === "deck") return shortcut("d");
  if (id === "discard") return shortcut("x");

  const cardIndex = Number(index);
  if (owner === "player" && Number.isInteger(cardIndex)) {
    const keys = gameType === "yaniv"
      ? YANIV_PLAYER_CARD_KEYS
      : gameType === "golf"
        ? GOLF_TABLEAU_KEYS
        : CABO_PLAYER_CARD_KEYS;
    return shortcut(keys[cardIndex]);
  }
  if ((owner === "ai" || owner === "opponent") && Number.isInteger(cardIndex)) return shortcut(OPPONENT_CARD_KEYS[cardIndex]);

  const action = label.toLowerCase();
  if (action === "got it" || action === "play again" || action === "play cards" || action === "next round") return shortcut("enter");
  if (action === "match discard") return shortcut("m");
  if (action === "call cabo") return shortcut("c");
  if (action === "call yaniv") return shortcut("y");
  if (action.startsWith("discard")) return shortcut("x");
  if (action === "cancel") return shortcut("escape");
  if (action === "keep hands") return shortcut("k");
  if (action === "swap" || action === "skip") return shortcut("s");
  return null;
}

function shortcut(key) {
  if (!key) return null;
  if (key === "enter") return { key, display: "↵", aria: "Enter" };
  if (key === "escape") return { key, display: "Esc", aria: "Escape" };
  return { key, display: key.toUpperCase(), aria: key.toUpperCase() };
}

function eventShortcutKey(event) {
  if (event.key === "Enter") return "enter";
  if (event.key === "Escape") return "escape";
  return event.key.length === 1 ? event.key.toLowerCase() : "";
}

function flashShortcut(target) {
  const hint = directHint(target);
  if (!hint) return;
  const rect = hint.getBoundingClientRect();
  const flash = hint.cloneNode(true);
  flash.classList.add("shortcut-hint-flash");
  flash.style.left = `${rect.left}px`;
  flash.style.top = `${rect.top}px`;
  flash.style.width = `${rect.width}px`;
  flash.style.height = `${rect.height}px`;
  document.body.appendChild(flash);
  flash.addEventListener("animationend", () => flash.remove(), { once: true });
  setTimeout(() => flash.remove(), 500);
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
