import assert from "node:assert/strict";
import test from "node:test";
import { createDiceMotion, diceBounds, DICE_STEP, resizeDiceMotion, stepDiceMotion } from "../src/client/dice-motion.js";
import { dieCollisionOutline } from "../src/client/dice-visual.js";

function seededRandom(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function motion(options = {}) {
  return createDiceMotion({ width: 460, height: 360, size: 116,
    outline: dieCollisionOutline("cube"), random: seededRandom(2), ...options });
}
function assertInside(s) {
  const b = diceBounds(s);
  assert.ok(s.x + b.left >= 16 - 1e-7 && s.x + b.right <= s.width - 16 + 1e-7, "die stays inside left/right walls");
  assert.ok(s.y + b.top >= 16 - 1e-7 && s.y + b.bottom <= s.height - 16 + 1e-7, "die stays inside top/bottom walls");
}

test("each wall reflects incoming velocity and triggers impact deformation", () => {
  for (const [wall, start, vx, vy] of [
    ["left", {x:55,y:180}, -700,0], ["right", {x:405,y:180},700,0],
    ["top", {x:230,y:55},0,-700], ["bottom", {x:230,y:305},0,700],
  ]) {
    const s = motion({start});
    Object.assign(s, {vx,vy,spin:4,vz:0});
    const hits = stepDiceMotion(s);
    assert.ok(hits.some(h => h.wall === wall));
    assert.ok(vx ? s.vx * vx < 0 : s.vy * vy < 0);
    assert.ok(Math.hypot(s.vx,s.vy) < 700, "impact dissipates energy");
    assert.ok(vx ? s.springX < 0 : s.springY < 0);
    assert.notEqual(s.spin, 4);
    assertInside(s);
  }
});

test("different dice ricochet repeatedly then settle inside mobile and desktop trays", () => {
  for (const [width,height,size] of [[288,320,92],[406,350,110],[530,380,124]]) {
    for (const shape of ["tetrahedron","cube","octahedron","trapezohedron","dodecahedron","icosahedron","multifaceted","zocchihedron"]) {
      for (let seed = 1; seed <= 12; seed++) {
        const s = motion({width,height,size,outline:dieCollisionOutline(shape),random:seededRandom(seed)});
        let walls = 0;
        while (!s.settled && s.elapsed < 8) {
          walls += stepDiceMotion(s).filter(h=>h.wall !== "floor").length;
          assertInside(s);
        }
        assert.ok(walls >= 3, `${shape} at ${width}px gets multiple wall bounces (${walls})`);
        assert.ok(s.settled, `${shape} settles, speed ${Math.hypot(s.vx,s.vy)}, spin ${s.spin}`);
        const ending = {...s};
        assert.deepEqual(stepDiceMotion(s), []);
        assert.deepEqual(s, ending, "no extra bounce or jump after settling");
      }
    }
  }
});

test("resize during a roll keeps the moving die in the new tray", () => {
  const s = motion();
  for(let i=0;i<36;i++) stepDiceMotion(s);
  resizeDiceMotion(s, 275, 305, 88);
  assertInside(s);
  while(!s.settled && s.elapsed < 8) { stepDiceMotion(s); assertInside(s); }
  assert.ok(s.settled);
});

test("input direction steers a roll and fixed steps produce repeatable motion", () => {
  const right = motion({direction:{x:1,y:0}}), left = motion({direction:{x:-1,y:0}});
  assert.ok(right.vx > 0 && left.vx < 0);
  const a = motion(), b = motion();
  for(let frame=0;frame<120;frame++) { stepDiceMotion(a,DICE_STEP); stepDiceMotion(a,DICE_STEP); }
  for(let frame=0;frame<240;frame++) stepDiceMotion(b,DICE_STEP);
  assert.deepEqual(a,b);
});
