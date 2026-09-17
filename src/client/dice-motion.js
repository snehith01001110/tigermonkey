import {
  axisRotation,
  faceOrientation,
  frontFace,
  multiplyRotation,
  projectPoint,
  rotatePoint,
  unit,
} from "./dice-body.js";

// Tray-space motion, in CSS pixels and seconds. A fixed step keeps collisions
// identical on a 60 Hz phone and a 144 Hz desktop display.
export const DICE_STEP = 1 / 120;
const WALL_INSET = 16;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function createDiceMotion({
  width,
  height,
  size,
  outline,
  body,
  start,
  direction,
  random = Math.random,
}) {
  const bearing = random() * Math.PI * 2;
  const dx = direction?.x ?? Math.cos(bearing);
  const dy = direction?.y ?? Math.sin(bearing);
  const length = Math.hypot(dx, dy) || 1;
  // A slight off-axis bias also makes straight wheel gestures reach more walls.
  const angle = Math.atan2(dy / length, dx / length) + (random() - 0.5) * 0.32;
  const speed = Math.hypot(width, height) * (3.5 + random() * 0.35);
  const state = {
    width,
    height,
    size,
    outline,
    body,
    x: start?.x ?? width * 0.5,
    y: start?.y ?? height * 0.5,
    angle: start?.angle ?? 0,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    spin: (random() < 0.5 ? -1 : 1) * (7 + random() * 5),
    lift: 0,
    vz: 250 + random() * 60,
    squashX: 0,
    squashY: 0,
    springX: 0,
    springY: 0,
    elapsed: 0,
    quiet: 0,
    settled: false,
  };
  if (body) {
    state.orientation =
      start?.body === body
        ? [...start.orientation]
        : faceOrientation(body.faces[0]);
    state.angularX = (state.vy / size) * 1.8;
    state.angularY = (state.vx / size) * 1.8;
  }
  confineDice(state);
  return state;
}

export function diceBounds(state) {
  const cos = Math.cos(state.angle),
    sin = Math.sin(state.angle);
  const liftScale = 1 + state.lift * 0.0015;
  const sx = (1 + state.squashX) * liftScale;
  const sy = (1 + state.squashY) * liftScale;
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  const points = state.body
    ? state.body.vertices.map((p) =>
        projectPoint(rotatePoint(p, state.orientation)),
      )
    : state.outline;
  for (const [px, py] of points) {
    const x = (state.body ? px : px * cos - py * sin) * state.size * sx;
    const y = (state.body ? py : px * sin + py * cos) * state.size * sy;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return { left, right, top, bottom };
}

export function confineDice(state) {
  const b = diceBounds(state);
  state.x = clamp(
    state.x,
    WALL_INSET - b.left,
    state.width - WALL_INSET - b.right,
  );
  state.y = clamp(
    state.y,
    WALL_INSET - b.top,
    state.height - WALL_INSET - b.bottom,
  );
}

export function resizeDiceMotion(state, width, height, size) {
  state.x *= width / state.width;
  state.y *= height / state.height;
  Object.assign(state, { width, height, size });
  confineDice(state);
}

export function stepDiceMotion(state, dt = DICE_STEP) {
  if (state.settled) return [];
  // The caller may supply a shorter final step, never a frame-sized leap.
  dt = Math.min(dt, DICE_STEP);
  const hits = [];
  state.elapsed += dt;
  for (const axis of ["X", "Y"]) {
    state[`spring${axis}`] +=
      (-320 * state[`squash${axis}`] - 22 * state[`spring${axis}`]) * dt;
    state[`squash${axis}`] = clamp(
      state[`squash${axis}`] + state[`spring${axis}`] * dt,
      -0.13,
      0.09,
    );
  }

  const airborne = state.lift > 0 || state.vz > 0;
  if (airborne) {
    state.vz -= 1600 * dt;
    state.lift += state.vz * dt;
    if (state.lift <= 0) {
      const speed = Math.abs(state.vz);
      state.lift = 0;
      state.vz = speed > 65 ? speed * 0.52 : 0;
      state.vx *= 0.985;
      state.vy *= 0.985;
      state.spin *= 0.94;
      if (speed > 65) {
        state.springY -= Math.min(1.9, speed * 0.007);
        state.springX += Math.min(1, speed * 0.003);
        hits.push({ wall: "floor", x: state.x, y: state.y, speed });
      }
    }
  }

  // Preserve the energy of the opening ricochets, then brake decisively.
  // This avoids a slow, floaty drift at the end of an otherwise quick throw.
  const braking = Math.max(0, state.elapsed - 1.2);
  const drag = Math.exp(-(0.12 + braking * 0.48) * dt);
  const speed = Math.hypot(state.vx, state.vy);
  const friction = airborne ? 0 : (85 + braking * 360) * dt;
  const slow = speed ? Math.max(0, speed * drag - friction) / speed : 0;
  state.vx *= slow;
  state.vy *= slow;
  state.spin *= Math.exp(-(0.5 + braking * 2.8) * dt);
  state.angle += state.spin * dt;
  if (state.body) {
    const coupling = 1 - Math.exp(-(airborne ? 3 : 12) * dt);
    state.angularX +=
      ((state.vy / state.size) * 2.4 - state.angularX) * coupling;
    state.angularY +=
      ((state.vx / state.size) * 2.4 - state.angularY) * coupling;
    const angular = [state.angularX, state.angularY, state.spin];
    // Keep integrating the actual tumble all the way to rest. No destination
    // face, upright-number correction, or separate landing animation.
    state.orientation = unit(
      multiplyRotation(
        axisRotation(angular, Math.hypot(...angular) * dt),
        state.orientation,
      ),
    );
  }
  state.x += state.vx * dt;
  state.y += state.vy * dt;

  const b = diceBounds(state);
  const left = WALL_INSET - b.left,
    right = state.width - WALL_INSET - b.right;
  const top = WALL_INSET - b.top,
    bottom = state.height - WALL_INSET - b.bottom;

  function collide(axis, wall, sign, x, y) {
    const velocity = axis === "X" ? "vx" : "vy";
    const tangent = axis === "X" ? "vy" : "vx";
    const impact = Math.abs(state[velocity]);
    if (state[velocity] * sign <= 0) return;
    state[velocity] *= -0.93;
    state[tangent] *= 0.99;
    // A glancing contact redirects the tumble as well as the travel direction.
    const nextSpin =
      -state.spin * 0.64 + (state[tangent] / state.size) * sign * 0.36;
    state.spin = clamp(
      nextSpin,
      -Math.abs(state.spin) - 2,
      Math.abs(state.spin) + 2,
    );
    if (state.body) {
      const angularAxis = axis === "X" ? "angularY" : "angularX";
      state[angularAxis] = (state[velocity] / state.size) * 2.8;
    }
    state[`spring${axis}`] -= Math.min(2.2, impact * 0.003);
    state[`spring${axis === "X" ? "Y" : "X"}`] += Math.min(
      1.1,
      impact * 0.0016,
    );
    if (impact > 160 && state.lift < 8)
      state.vz = Math.max(state.vz, Math.min(110, impact * 0.16));
    hits.push({ wall, x, y, speed: impact });
  }

  if (state.x < left) {
    state.x = left;
    collide("X", "left", -1, WALL_INSET, state.y);
  } else if (state.x > right) {
    state.x = right;
    collide("X", "right", 1, state.width - WALL_INSET, state.y);
  }
  if (state.y < top) {
    state.y = top;
    collide("Y", "top", -1, state.x, WALL_INSET);
  } else if (state.y > bottom) {
    state.y = bottom;
    collide("Y", "bottom", 1, state.x, state.height - WALL_INSET);
  }

  const atRest =
    Math.hypot(state.vx, state.vy) < 4 &&
    Math.abs(state.spin) < 0.08 &&
    (!state.body || Math.hypot(state.angularX, state.angularY) < 0.08) &&
    state.lift === 0 &&
    state.vz === 0 &&
    Math.abs(state.squashX) + Math.abs(state.squashY) < 0.002;
  state.quiet = atRest ? state.quiet + dt : 0;
  if (state.quiet > 0.16) {
    state.settled = true;
    state.vx = state.vy = state.spin = 0;
    if (state.body) {
      state.angularX = state.angularY = 0;
      // The stopped body's upward-facing number is the result, not an input.
      state.value = frontFace(state.body, state.orientation).value;
    }
    state.squashX = state.squashY = state.springX = state.springY = 0;
    confineDice(state);
  }
  return hits;
}
