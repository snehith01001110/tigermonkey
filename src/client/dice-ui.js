import {
  DEFAULT_DIE_SIDES,
  MAX_DIE_SIDES,
  MIN_DIE_SIDES,
  normalizeDieSides,
} from "./dice.js";
import { createDieBody, drawDie, faceOrientation } from "./dice-body.js";
import {
  confineDice,
  createDiceMotion,
  DICE_STEP,
  rethrowDiceMotion,
  resizeDiceMotion,
  stepDiceMotion,
} from "./dice-motion.js";

const WHEEL_ROLL_COOLDOWN_MS = 350;
const SWIPE_DISTANCE_PX = 28;
const HISTORY_LIMIT = 100;

const els = {
  multiplayerBtn: document.getElementById("multiplayerBtn"),
  historyBtn: document.getElementById("historyBtn"),
  rulesBtn: document.getElementById("rulesBtn"),
  rulesDialog: document.getElementById("rulesDialog"),
  closeRulesBtn: document.getElementById("closeRulesBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsDialog: document.getElementById("settingsDialog"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  computerSetting: document.getElementById("computerSetting"),
  keyboardSetting: document.getElementById("keyboardSetting"),
  themeRadios: document.querySelectorAll('input[name="theme"]'),
  themeColor: document.querySelector('meta[name="theme-color"]'),
  newGameBtn: document.getElementById("newGameBtn"),
  table: document.querySelector(".table"),
  dock: document.querySelector(".dock"),
  turnLabel: document.getElementById("turnLabel"),
  resultLine: document.getElementById("resultLine"),
  message: document.getElementById("message"),
  actions: document.getElementById("actions"),
};

let sides = DEFAULT_DIE_SIDES;
let rolls = [];
let rolling = false;
let lastWheelRollAt = -Infinity;
let lastWheelEventAt = -Infinity;
let swipeStart = null;
let ignoreClickUntil = 0;
let motion = null;
let frameHandle = null;
let previousFrame = 0;
let accumulator = 0;
let pendingRoll = null;
let rollCount = 0;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let rollButton;
let dieObject;
let dieCanvas;
let dieContext;
let dieBody;
let darkDice = false;
let rollAnnouncement;
let sidesInput;
let decreaseSidesButton;
let increaseSidesButton;
let rangeLabel;
let rollHistory;
let castShadow;

export function startDice() {
  document.querySelector(".history").hidden = true;
  els.multiplayerBtn.hidden = true;
  els.historyBtn.hidden = true;
  els.newGameBtn.hidden = true;
  els.computerSetting.hidden = true;
  els.keyboardSetting.hidden = true;
  els.dock.hidden = true;
  els.table.classList.add("dice-table");
  els.table.setAttribute("aria-label", "Dice");
  els.table.innerHTML = `
    <section class="dice-roller" aria-label="Dice">
      <div class="dice-controls">
        <div class="dice-sides-control">
          <label for="diceSides">sides</label>
          <span class="dice-sides-input">
            <button id="diceSidesDecrease" type="button" aria-label="Decrease die sides">−</button>
            <input id="diceSides" type="text" value="${sides}" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-describedby="diceRange" />
            <button id="diceSidesIncrease" type="button" aria-label="Increase die sides">+</button>
          </span>
        </div>
        <output id="diceRange" class="dice-range"></output>
      </div>
      <div id="diceRollSurface" class="dice-roll-surface">
        <button id="diceRollButton" class="dice-roll-button" type="button" aria-keyshortcuts="Space">
          <span class="dice-tray-texture" aria-hidden="true"></span>
          <span class="dice-cast-shadow" aria-hidden="true"></span>
          <span class="dice-wall dice-wall-left" aria-hidden="true"></span>
          <span class="dice-wall dice-wall-right" aria-hidden="true"></span>
          <span class="dice-wall dice-wall-top" aria-hidden="true"></span>
          <span class="dice-wall dice-wall-bottom" aria-hidden="true"></span>
          <span id="diceObject" class="dice-object" aria-hidden="true">
            <canvas id="diceCanvas" class="dice-canvas"></canvas>
          </span>
          <span class="visually-hidden">Roll the die</span>
        </button>
        <span id="diceRollAnnouncement" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"></span>
      </div>
      <aside class="dice-history-panel" aria-labelledby="diceHistoryTitle">
        <h2 id="diceHistoryTitle">recent rolls</h2>
        <ol id="diceRollHistory" class="dice-roll-history" tabindex="0" aria-label="Recent rolls, newest first"></ol>
      </aside>
    </section>`;

  rollButton = document.getElementById("diceRollButton");
  dieObject = document.getElementById("diceObject");
  dieCanvas = document.getElementById("diceCanvas");
  dieContext = dieCanvas.getContext("2d");
  rollAnnouncement = document.getElementById("diceRollAnnouncement");
  sidesInput = document.getElementById("diceSides");
  decreaseSidesButton = document.getElementById("diceSidesDecrease");
  increaseSidesButton = document.getElementById("diceSidesIncrease");
  rangeLabel = document.getElementById("diceRange");
  rollHistory = document.getElementById("diceRollHistory");
  castShadow = rollButton.querySelector(".dice-cast-shadow");

  rollButton.addEventListener("click", () => {
    if (performance.now() >= ignoreClickUntil) roll();
  });
  sidesInput.addEventListener("input", updateSidesFromInput);
  sidesInput.addEventListener("change", normalizeSidesInput);
  sidesInput.addEventListener("keydown", adjustSidesWithArrowKey);
  decreaseSidesButton.addEventListener("click", () => adjustSides(-1));
  increaseSidesButton.addEventListener("click", () => adjustSides(1));
  document.addEventListener("keydown", rollWithSpace);
  document.addEventListener("wheel", rollWithWheel, { passive: false });
  rollButton.addEventListener("pointerdown", startSwipe);
  rollButton.addEventListener("pointerup", finishSwipe);
  rollButton.addEventListener("pointercancel", () => {
    swipeStart = null;
  });
  document.addEventListener("visibilitychange", () => {
    // Resume from the same position instead of leaping forward in a hidden tab.
    previousFrame = 0;
    accumulator = 0;
  });
  reducedMotion.addEventListener("change", () => {
    if (rolling && reducedMotion.matches) {
      cancelAnimationFrame(frameHandle);
      skipRollAnimation();
    }
  });
  new ResizeObserver(() => {
    if (!motion) return;
    resizeDiceMotion(
      motion,
      rollButton.clientWidth,
      rollButton.clientHeight,
      dieObject.offsetWidth,
    );
    paintMotion();
  }).observe(rollButton);

  els.rulesBtn.addEventListener("click", () => els.rulesDialog.showModal());
  els.closeRulesBtn.addEventListener("click", () => els.rulesDialog.close());
  els.settingsBtn.addEventListener("click", openSettings);
  els.closeSettingsBtn.addEventListener("click", () =>
    els.settingsDialog.close(),
  );
  for (const radio of els.themeRadios)
    radio.addEventListener("change", () => applyTheme(radio.value));
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", updateThemeColor);
  updateThemeColor();
  render();
  // Canvas does not repaint itself when a web font finishes loading.
  if (document.fonts) {
    document.fonts
      .load('600 120px "Dice Numerals"', "0123456789")
      .then(() => paintMotion())
      .catch(() => {}); // The sans-serif fallback still renders every result.
  }
}

function updateSidesFromInput() {
  if (rolling) return;
  const value = Number(sidesInput.value);
  if (
    !Number.isInteger(value) ||
    value < MIN_DIE_SIDES ||
    value > MAX_DIE_SIDES
  )
    return;
  sides = value;
  render();
}

function normalizeSidesInput() {
  if (rolling) return;
  sides = normalizeDieSides(sidesInput.value, sides);
  render();
}

function adjustSides(amount) {
  if (rolling) return;
  sides = normalizeDieSides(sides + amount, sides);
  render();
  sidesInput.focus();
}

function adjustSidesWithArrowKey(event) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  adjustSides(event.key === "ArrowUp" ? 1 : -1);
}

function roll(direction) {
  if (document.querySelector("dialog[open]")) return false;
  if (rolling) {
    rethrowDiceMotion(motion, {
      direction,
      random: () => secureRandomInt(0x1_0000_0000) / 0x1_0000_0000,
    });
    rollButton.classList.remove("landed");
    return true;
  }
  normalizeSidesInput();
  pendingRoll = { sides };
  motion = createDiceMotion({
    width: rollButton.clientWidth,
    height: rollButton.clientHeight,
    size: dieObject.offsetWidth,
    body: dieBody,
    start: motion,
    direction,
    random: () => secureRandomInt(0x1_0000_0000) / 0x1_0000_0000,
  });
  rolling = true;
  sidesInput.disabled =
    decreaseSidesButton.disabled =
    increaseSidesButton.disabled =
      true;
  rollButton.classList.remove("landed");
  rollButton.classList.add("rolling");
  rollButton.setAttribute("aria-busy", "true");
  previousFrame = 0;
  accumulator = 0;
  if (reducedMotion.matches) skipRollAnimation();
  else frameHandle = requestAnimationFrame(animateRoll);
  return true;
}

function animateRoll(now) {
  if (!rolling) return;
  accumulator += previousFrame
    ? Math.min((now - previousFrame) / 1000, 0.05)
    : DICE_STEP;
  previousFrame = now;
  while (accumulator >= DICE_STEP && !motion.settled) {
    for (const hit of stepDiceMotion(motion)) showImpact(hit);
    accumulator -= DICE_STEP;
  }
  paintMotion();
  if (motion.settled) finishRoll();
  else frameHandle = requestAnimationFrame(animateRoll);
}

function skipRollAnimation() {
  // Reduced motion uses the same throw and landing result, just without
  // displaying intermediate frames. Batch work to keep the page responsive.
  if (!rolling) return;
  for (let step = 0; step < 600 && !motion.settled; step++) {
    stepDiceMotion(motion);
  }
  if (motion.settled) finishRoll();
  else frameHandle = requestAnimationFrame(skipRollAnimation);
}

function paintMotion() {
  if (!motion) return;
  const { x, y, lift, squashX, squashY, size } = motion;
  const scale = 1 + lift * 0.0015;
  dieObject.style.transform = `translate(${x}px, ${y}px) scale(${(1 + squashX) * scale}, ${(1 + squashY) * scale})`;
  const resolution = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = Math.round(size * resolution);
  if (dieCanvas.width !== pixels || dieCanvas.height !== pixels)
    dieCanvas.width = dieCanvas.height = pixels;
  if (dieContext)
    drawDie(
      dieContext,
      dieBody,
      motion.orientation,
      size,
      resolution,
      darkDice,
      motion.settled ? motion.value : null,
    );
  castShadow.style.width = `${size * 0.8}px`;
  castShadow.style.height = `${size * 0.5}px`;
  castShadow.style.transform = `translate(${x + lift * 0.22}px, ${y + 8 + lift * 0.45}px) translate(-50%, -50%) scale(${1 + lift * 0.007})`;
  castShadow.style.opacity = String(0.44 - Math.min(0.26, lift * 0.005));
  castShadow.style.filter = `blur(${5 + lift * 0.16}px)`;
}

function showImpact(hit) {
  if (hit.speed < 80 || reducedMotion.matches) return;
  const strength = Math.min(1, hit.speed / 600);
  const wall =
    hit.wall === "floor"
      ? null
      : rollButton.querySelector(`.dice-wall-${hit.wall}`);
  wall?.getAnimations().forEach((animation) => animation.cancel());
  wall?.animate([{ opacity: 0.35 + strength * 0.55 }, { opacity: 0 }], {
    duration: 180 + strength * 100,
    easing: "ease-out",
  });
  const mark = document.createElement("span");
  mark.className = "dice-contact";
  mark.style.left = `${hit.x}px`;
  mark.style.top = `${hit.y}px`;
  rollButton.appendChild(mark);
  const pulse = mark.animate(
    [
      {
        transform: "translate(-50%, -50%) scale(.3)",
        opacity: strength * 0.55,
      },
      { transform: "translate(-50%, -50%) scale(1.4)", opacity: 0 },
    ],
    { duration: 280, easing: "ease-out" },
  );
  pulse.finished.then(
    () => mark.remove(),
    () => mark.remove(),
  );
}

function finishRoll() {
  if (!pendingRoll || !motion.settled) return;
  const entry = { ...pendingRoll, value: motion.value, number: ++rollCount };
  pendingRoll = null;
  rolls.unshift(entry);
  rolls.length = Math.min(rolls.length, HISTORY_LIMIT);
  rolling = false;
  frameHandle = null;
  sidesInput.disabled = false;
  rollButton.classList.remove("rolling");
  rollButton.classList.add("landed");
  rollButton.removeAttribute("aria-busy");
  rollAnnouncement.textContent = `Roll ${entry.number}: ${entry.value}, on a ${entry.sides}-sided die.`;
  if (!reducedMotion.matches && typeof navigator.vibrate === "function")
    navigator.vibrate(12);
  render();
}

function rollWithSpace(event) {
  if (
    event.code !== "Space" ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    shouldIgnoreInput(event.target)
  )
    return;
  event.preventDefault();
  if (!event.repeat) roll();
}

function rollWithWheel(event) {
  if (
    event.ctrlKey ||
    event.metaKey ||
    !isDesktopPointer() ||
    (!event.deltaX && !event.deltaY) ||
    shouldIgnoreWheel(event.target)
  )
    return;
  event.preventDefault();
  const now = performance.now();
  const gap = now - lastWheelEventAt;
  lastWheelEventAt = now;
  if (gap < 160 || now - lastWheelRollAt < WHEEL_ROLL_COOLDOWN_MS) return;
  if (roll({ x: event.deltaX, y: event.deltaY })) lastWheelRollAt = now;
}

function startSwipe(event) {
  if (event.pointerType !== "touch" || !event.isPrimary) return;
  swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  rollButton.setPointerCapture(event.pointerId);
}

function finishSwipe(event) {
  if (
    event.pointerType !== "touch" ||
    !swipeStart ||
    event.pointerId !== swipeStart.id
  )
    return;
  const direction = {
    x: event.clientX - swipeStart.x,
    y: event.clientY - swipeStart.y,
  };
  swipeStart = null;
  if (Math.hypot(direction.x, direction.y) >= SWIPE_DISTANCE_PX) {
    ignoreClickUntil = performance.now() + 500;
    roll(direction);
  }
}

function shouldIgnoreInput(target) {
  return (
    document.querySelector("dialog[open]") ||
    (target instanceof Element &&
      target.closest(
        "dialog, input, textarea, select, [contenteditable], a, button:not(#diceRollButton), .dice-history-panel",
      ))
  );
}

function shouldIgnoreWheel(target) {
  if (shouldIgnoreInput(target) || !document.getElementById("gameMenu").hidden)
    return true;
  return (
    target instanceof Element &&
    target.closest(".dice-history-panel, .dice-sides-control")
  );
}

function isDesktopPointer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function render() {
  sidesInput.value = String(sides);
  decreaseSidesButton.disabled = sides === MIN_DIE_SIDES;
  increaseSidesButton.disabled = sides === MAX_DIE_SIDES;
  rangeLabel.textContent = `rolls 0–${sides - 1}`;
  rollButton.setAttribute(
    "aria-label",
    `Roll a ${sides}-sided die, from 0 to ${sides - 1}`,
  );
  if (dieBody?.sides !== sides) {
    dieBody = createDieBody(sides);
    if (motion) {
      motion.body = dieBody;
      motion.value = rolls[0]?.sides === sides ? rolls[0].value : undefined;
      motion.orientation = faceOrientation(
        dieBody.faces[rolls[0]?.sides === sides ? rolls[0].value : 0],
      );
      confineDice(motion);
    }
  }
  if (!motion) {
    motion = createDiceMotion({
      width: rollButton.clientWidth,
      height: rollButton.clientHeight,
      size: dieObject.offsetWidth,
      body: dieBody,
    });
    motion.lift = motion.vz = motion.vx = motion.vy = motion.spin = 0;
    motion.settled = true;
  }
  paintMotion();

  rollHistory.innerHTML = "";
  if (!rolls.length) {
    const empty = document.createElement("li");
    empty.className = "dice-history-empty";
    empty.textContent = "No rolls yet";
    rollHistory.appendChild(empty);
    return;
  }

  for (const [index, entry] of rolls.entries()) {
    const item = document.createElement("li");
    const latest = index === 0;
    if (latest) {
      item.className = "dice-history-latest";
      item.setAttribute("aria-current", "true");
    }
    item.innerHTML = `<span>${latest ? '<span class="dice-history-latest-label">latest roll</span>' : ""}roll ${entry.number} · d${entry.sides}</span><strong>${entry.value}</strong>`;
    rollHistory.appendChild(item);
  }
}

function secureRandomInt(max) {
  const range = 0x1_0000_0000;
  const ceiling = Math.floor(range / max) * max;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value);
  while (value[0] >= ceiling);
  return value[0] % max;
}

function openSettings() {
  for (const radio of els.themeRadios)
    radio.checked = radio.value === themeSetting();
  els.settingsDialog.showModal();
}

function themeSetting() {
  return document.documentElement.dataset.theme || "system";
}

function applyTheme(value) {
  if (value === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  try {
    if (value === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", value);
  } catch {}
  updateThemeColor();
}

function updateThemeColor() {
  const setting = themeSetting();
  const dark =
    setting === "dark" ||
    (setting === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  els.themeColor.content = dark ? "#161614" : "#f4f0e7";
  darkDice = dark;
  paintMotion();
}
