import assert from "node:assert/strict";
import test from "node:test";
import {
  axisRotation,
  createDieBody,
  dot,
  drawDie,
  faceOrientation,
  frontFace,
  multiplyRotation,
  rotatePoint,
} from "../src/client/dice-body.js";
import {
  createDiceMotion,
  diceBounds,
  resizeDiceMotion,
  stepDiceMotion,
} from "../src/client/dice-motion.js";

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("all 4–200 sided meshes are closed convex solids with exactly one face per result", () => {
  for (let sides = 4; sides <= 200; sides++) {
    const body = createDieBody(sides),
      edges = new Map();
    assert.equal(body.faces.length, sides);
    assert.deepEqual(
      body.faces.map((f) => f.value),
      Array.from({ length: sides }, (_, i) => i),
    );
    for (const f of body.faces) {
      assert.ok(f.indices.length >= 3 && f.inradius > 0);
      for (const v of body.vertices)
        assert.ok(
          dot(f.normal, v) - dot(f.normal, f.center) < 1e-7,
          "every vertex is inside every face plane",
        );
      for (let j = 0; j < f.indices.length; j++) {
        const a = f.indices[j],
          b = f.indices[(j + 1) % f.indices.length],
          key = [a, b].sort((x, y) => x - y).join(",");
        const e = edges.get(key) || { count: 0, direction: 0 };
        e.count++;
        e.direction += a < b ? 1 : -1;
        edges.set(key, e);
      }
    }
    for (const e of edges.values()) {
      assert.equal(e.count, 2);
      assert.equal(e.direction, 0);
    }
    assert.equal(
      body.vertices.length - edges.size + body.faces.length,
      2,
      "Euler characteristic",
    );
  }
});

test("idle preview poses show the requested face, including d100 and d200", () => {
  for (let sides = 4; sides <= 200; sides++) {
    const body = createDieBody(sides);
    for (const face of body.faces) {
      const orientation = faceOrientation(face),
        up = rotatePoint(face.up, orientation);
      assert.equal(frontFace(body, orientation).value, face.value);
      assert.ok(up[1] > 0.9, "face text is upright");
    }
  }
});

test("3D tumbles show multiple numbered faces, rebound energetically, and finish without snapping", () => {
  for (const sides of [4, 5, 6, 8, 10, 12, 20, 37, 100, 200]) {
    for (const [width, height, size] of [
      [288, 310, 112],
      [590, 410, 178],
    ]) {
      for (let seed = 1; seed <= 4; seed++) {
        const body = createDieBody(sides);
        const state = createDiceMotion({
          width,
          height,
          size,
          body,
          random: random(seed),
        });
        const seen = new Set();
        let bounces = 0;
        let previous;
        assert.ok(
          Math.hypot(state.vx, state.vy) > Math.hypot(width, height) * 3.4,
        );
        while (!state.settled && state.elapsed < 5) {
          assert.equal(state.value, undefined, "no result exists before rest");
          previous = [...state.orientation];
          bounces += stepDiceMotion(state).filter(
            (h) => h.wall !== "floor",
          ).length;
          seen.add(frontFace(body, state.orientation).value);
          const b = diceBounds(state);
          assert.ok(
            state.x + b.left >= 16 - 1e-7 &&
              state.x + b.right <= width - 16 + 1e-7,
          );
          assert.ok(
            state.y + b.top >= 16 - 1e-7 &&
              state.y + b.bottom <= height - 16 + 1e-7,
          );
          assert.ok(Math.abs(Math.hypot(...state.orientation) - 1) < 1e-7);
        }
        assert.ok(state.settled && state.elapsed < 3.8);
        assert.ok(bounces >= 6, `${sides}: ${bounces} wall contacts`);
        assert.ok(
          seen.size >= 3,
          "numbers rotate into view on different faces",
        );
        assert.equal(state.value, frontFace(body, state.orientation).value);
        assert.ok(
          Math.abs(dot(previous, state.orientation)) > 0.9999,
          "no final-frame orientation jump",
        );
        const end = structuredClone(state);
        stepDiceMotion(state);
        assert.deepEqual(state, end);
      }
    }
  }
});

test("resize during a 3D roll preserves orientation and confines the new silhouette", () => {
  const body = createDieBody(200),
    state = createDiceMotion({
      width: 600,
      height: 400,
      size: 178,
      body,
      random: random(9),
    });
  for (let i = 0; i < 80; i++) stepDiceMotion(state);
  const orientation = [...state.orientation];
  resizeDiceMotion(state, 270, 290, 112);
  assert.deepEqual(state.orientation, orientation);
  while (!state.settled && state.elapsed < 5) stepDiceMotion(state);
  assert.equal(state.value, frontFace(body, state.orientation).value);
  assert.ok(state.settled);
});

test("face numbers have no influence on the trajectory or final orientation", () => {
  for (const sides of [6, 20, 100, 200]) {
    const body = createDieBody(sides);
    const relabeled = {
      ...body,
      faces: body.faces.map((face) => ({
        ...face,
        value: sides - 1 - face.value,
      })),
    };
    const options = { width: 460, height: 360, size: 150 };
    const a = createDiceMotion({ ...options, body, random: random(41) });
    const b = createDiceMotion({
      ...options,
      body: relabeled,
      random: random(41),
    });
    while (!a.settled && a.elapsed < 5) {
      assert.deepEqual(stepDiceMotion(a), stepDiceMotion(b));
      assert.deepEqual(a.orientation, b.orientation);
      assert.deepEqual([a.x, a.y, a.settled], [b.x, b.y, b.settled]);
    }
    assert.ok(a.settled && b.settled);
    assert.equal(b.value, sides - 1 - a.value);
  }
});

test("late angular momentum still changes the landed result instead of locking a face", () => {
  const body = createDieBody(6);
  const state = createDiceMotion({
    width: 460,
    height: 360,
    size: 150,
    body,
    random: random(3),
  });
  Object.assign(state, {
    elapsed: 2.5,
    vx: 0,
    vy: 0,
    lift: 0,
    vz: 0,
    spin: 0,
    angularX: 40,
    angularY: 0,
  });
  const initialFace = frontFace(body, state.orientation).value;
  while (!state.settled && state.elapsed < 6) stepDiceMotion(state);
  assert.ok(state.settled);
  assert.notEqual(state.value, initialFace);
  assert.equal(state.value, frontFace(body, state.orientation).value);
});

test("the renderer paints permanent face numbers at every sampled orientation", () => {
  const labels = [];
  const context = new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === "fillText") return (label) => labels.push(Number(label));
        if (key === "measureText")
          return (label) => ({
            width: String(label).length * 58,
            actualBoundingBoxAscent: 86,
            actualBoundingBoxDescent: 0,
          });
        if (key === "createLinearGradient")
          return () => ({ addColorStop() {} });
        return () => {};
      },
    },
  );
  for (const sides of [4, 6, 10, 20, 100, 200]) {
    const body = createDieBody(sides);
    for (let frame = 0; frame < 24; frame++) {
      labels.length = 0;
      drawDie(
        context,
        body,
        multiplyRotation(
          axisRotation([1, 0.3, 0], frame * 0.32),
          axisRotation([0, 1, 0.3], frame * 0.17),
        ),
        140,
        2,
        true,
      );
      assert.ok(labels.length > 0);
      assert.ok(
        labels.every((n) => Number.isInteger(n) && n >= 0 && n < sides),
      );
    }
  }
});

test("only the settled result gets an inverted face, including zero and d200", () => {
  const labels = [];
  const context = new Proxy(
    {},
    {
      get(target, key) {
        if (key === "measureText")
          return (label) => ({
            width: String(label).length * 58,
            actualBoundingBoxAscent: 86,
            actualBoundingBoxDescent: 0,
          });
        if (key === "fillText")
          return (label) =>
            labels.push({ value: Number(label), color: target.fillStyle });
        if (key === "createLinearGradient")
          return () => ({ addColorStop() {} });
        return typeof target[key] === "undefined" ? () => {} : target[key];
      },
    },
  );
  for (const sides of [4, 6, 10, 20, 100, 200]) {
    const body = createDieBody(sides);
    for (const value of [0, sides - 1]) {
      const orientation = faceOrientation(body.faces[value]);
      const original = [...orientation];
      for (const dark of [false, true]) {
        labels.length = 0;
        drawDie(context, body, orientation, 140, 2, dark);
        assert.equal(
          labels.filter((label) => label.color === "#fffdf4").length,
          0,
          "idle and rolling faces are not highlighted",
        );
        labels.length = 0;
        drawDie(context, body, orientation, 140, 2, dark, value);
        assert.deepEqual(
          labels
            .filter((label) => label.color === "#fffdf4")
            .map((label) => label.value),
          [value],
        );
        assert.ok(labels.some((label) => label.value === value));
        assert.deepEqual(
          orientation,
          original,
          "highlighting never turns the die",
        );
      }
    }
  }
});

test("dice numerals use the bundled sans serif and fit long labels without distortion", () => {
  const labels = [],
    scales = [];
  const context = new Proxy(
    {},
    {
      get(target, key) {
        if (key === "measureText")
          return (label) => ({
            width: label.length * 58,
            actualBoundingBoxAscent: 86,
            actualBoundingBoxDescent: 2,
          });
        if (key === "fillText")
          return (label, x, y, maxWidth) =>
            labels.push({
              label,
              x,
              y,
              maxWidth,
              font: target.font,
              baseline: target.textBaseline,
            });
        if (key === "scale") return (x, y) => scales.push([x, y]);
        if (key === "createLinearGradient")
          return () => ({ addColorStop() {} });
        return typeof target[key] === "undefined" ? () => {} : target[key];
      },
    },
  );
  const body = createDieBody(200);
  drawDie(context, body, faceOrientation(body.faces[199]), 140, 2, true, 199);
  assert.ok(labels.some((label) => label.label === "199"));
  for (const label of labels) {
    assert.match(label.font, /600 (120|128)px "Dice Numerals".*sans-serif/);
    assert.equal(label.baseline, "alphabetic");
    assert.ok(
      label.y === 42 || label.y === 43.5,
      "numerals are optically centered by their actual ink bounds",
    );
    assert.equal(
      label.maxWidth,
      undefined,
      "canvas must not squeeze the glyphs horizontally",
    );
  }
  assert.ok(
    scales.some(([scale]) => scale < 1),
    "three digits fit within the face",
  );
  for (const [x, y] of scales) assert.ok(x === y && x > 0 && x <= 1);
});
