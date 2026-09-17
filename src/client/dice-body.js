// Small, dependency-free convex dice meshes. Every face owns one permanent
// number: the artwork and its labels rotate together in three dimensions.
export const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, n) => a.map((v) => v * n);
export const unit = (a) => scale(a, 1 / (Math.hypot(...a) || 1));
const average = (points) =>
  scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
const cache = new Map();

export function multiplyRotation(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function axisRotation(axis, angle) {
  return [...scale(unit(axis), Math.sin(angle / 2)), Math.cos(angle / 2)];
}
export function rotatePoint(point, q) {
  const t = scale(cross(q, point), 2);
  return add(point, add(scale(t, q[3]), cross(q, t)));
}
// Initial display pose only. An actual roll is never steered into this pose.
export function faceOrientation(face) {
  const z = [0, 0, 1],
    cosine = dot(face.normal, z);
  const align =
    cosine < -0.99999
      ? axisRotation([1, 0, 0], Math.PI)
      : unit([...cross(face.normal, z), 1 + cosine]);
  const up = rotatePoint(face.up, align);
  // Tiny faces need a more overhead view so a neighbouring number cannot
  // become the most prominent face when the winning face settles.
  const tilt = Math.min(1, face.inradius / 0.6);
  const restTilt = multiplyRotation(
    axisRotation([1, 0, 0], 0.25 * tilt),
    axisRotation([0, 1, 0], -0.28 * tilt),
  );
  return multiplyRotation(
    restTilt,
    multiplyRotation(axisRotation(z, Math.atan2(up[0], up[1])), align),
  );
}

// Shallow perspective, with enough margin for the bevel and the largest corner.
export function projectPoint([x, y, z]) {
  const perspective = 6 / (6 - z);
  return [x * 0.43 * perspective, -y * 0.43 * perspective];
}

function orderedFace(vertices, indices, normal) {
  const center = average(indices.map((i) => vertices[i]));
  const right = unit(
    cross(Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], normal),
  );
  const up = cross(normal, right);
  return [...indices].sort((a, b) => {
    const p = sub(vertices[a], center),
      q = sub(vertices[b], center);
    return (
      Math.atan2(dot(p, up), dot(p, right)) -
      Math.atan2(dot(q, up), dot(q, right))
    );
  });
}

// Incremental hull, followed by coplanar merging (cube faces stay quadrilateral).
function hull(vertices) {
  const a = 0;
  const furthest = (score) =>
    vertices.reduce(
      (best, p, i) => (score(p) > score(vertices[best]) ? i : best),
      0,
    );
  const b = furthest((p) => Math.hypot(...sub(p, vertices[a])));
  const c = furthest((p) =>
    Math.hypot(...cross(sub(vertices[b], vertices[a]), sub(p, vertices[a]))),
  );
  const normal = unit(
    cross(sub(vertices[b], vertices[a]), sub(vertices[c], vertices[a])),
  );
  const d = furthest((p) => Math.abs(dot(sub(p, vertices[a]), normal)));
  const interior = average([a, b, c, d].map((i) => vertices[i]));
  function triangle(i, j, k) {
    let n = unit(
      cross(sub(vertices[j], vertices[i]), sub(vertices[k], vertices[i])),
    );
    if (dot(n, sub(interior, vertices[i])) > 0) {
      [j, k] = [k, j];
      n = scale(n, -1);
    }
    return { indices: [i, j, k], normal: n, distance: dot(n, vertices[i]) };
  }
  let faces = [
    triangle(a, b, c),
    triangle(a, c, d),
    triangle(a, d, b),
    triangle(b, d, c),
  ];
  for (let index = 0; index < vertices.length; index++) {
    if ([a, b, c, d].includes(index)) continue;
    const visible = faces.filter(
      (f) => dot(f.normal, vertices[index]) - f.distance > 1e-8,
    );
    const edges = new Map();
    for (const face of visible)
      for (let j = 0; j < 3; j++) {
        const p = face.indices[j],
          q = face.indices[(j + 1) % 3],
          key = [p, q].sort((x, y) => x - y).join(",");
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, [p, q]);
      }
    faces = faces.filter((f) => !visible.includes(f));
    for (const [p, q] of edges.values()) faces.push(triangle(p, q, index));
  }
  const merged = [];
  for (const face of faces) {
    const plane = merged.find(
      (f) =>
        dot(f.normal, face.normal) > 1 - 1e-12 &&
        Math.abs(f.distance - face.distance) < 1e-12,
    );
    if (plane)
      plane.indices = [...new Set([...plane.indices, ...face.indices])];
    else merged.push({ ...face });
  }
  return merged.map((f) => ({
    ...f,
    indices: orderedFace(vertices, f.indices, f.normal),
  }));
}

function dual(vertices) {
  const faces = hull(vertices);
  const points = faces.map((f) => scale(f.normal, 1 / f.distance));
  return {
    vertices: points,
    faces: vertices.map((v, i) =>
      orderedFace(
        points,
        faces.flatMap((f, j) => (f.indices.includes(i) ? [j] : [])),
        unit(v),
      ),
    ),
  };
}

function rawMesh(sides) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const ico = [];
  for (const a of [-1, 1])
    for (const b of [-phi, phi]) ico.push([0, a, b], [a, b, 0], [b, 0, a]);
  let vertices;
  if (sides === 4)
    vertices = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ];
  else if (sides === 5)
    vertices = Array.from({ length: 6 }, (_, i) => [
      Math.cos(((i % 3) * Math.PI * 2) / 3),
      Math.sin(((i % 3) * Math.PI * 2) / 3),
      i < 3 ? 0.72 : -0.72,
    ]);
  else if (sides === 6)
    vertices = Array.from({ length: 8 }, (_, i) => [
      i & 1 ? 1 : -1,
      i & 2 ? 1 : -1,
      i & 4 ? 1 : -1,
    ]);
  else if (sides === 8)
    vertices = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
  else if (sides === 10)
    return dual(
      Array.from({ length: 10 }, (_, i) => {
        const angle = (i * Math.PI) / 5;
        return [Math.cos(angle), Math.sin(angle), i % 2 ? 0.52 : -0.52];
      }),
    );
  else if (sides === 12) return dual(ico);
  else if (sides === 20) vertices = ico;
  else {
    // A spherical Voronoi-style body gives arbitrary counts exactly N faces,
    // including genuinely round, densely faceted d100 and d200 bodies.
    return dual(
      Array.from({ length: sides }, (_, i) => {
        const y = 1 - (2 * (i + 0.5)) / sides,
          r = Math.sqrt(1 - y * y),
          angle = i * Math.PI * (3 - Math.sqrt(5));
        return [Math.cos(angle) * r, y, Math.sin(angle) * r];
      }),
    );
  }
  return { vertices, faces: hull(vertices).map((f) => f.indices) };
}

export function createDieBody(sides) {
  if (!Number.isInteger(sides) || sides < 4 || sides > 200)
    throw new RangeError("Die sides must be 4–200.");
  if (cache.has(sides)) return cache.get(sides);
  const mesh = rawMesh(sides);
  const radius = Math.max(...mesh.vertices.map((p) => Math.hypot(...p)));
  const vertices = mesh.vertices.map((p) => scale(p, 1 / radius));
  const faces = mesh.faces.map((indices, value) => {
    const points = indices.map((i) => vertices[i]),
      center = average(points);
    let normal = unit(
      cross(sub(points[1], points[0]), sub(points[2], points[0])),
    );
    if (dot(normal, center) < 0) {
      indices = [...indices].reverse();
      normal = scale(normal, -1);
    }
    const right = unit(sub(vertices[indices[1]], vertices[indices[0]])),
      up = cross(normal, right);
    const inradius = Math.min(
      ...indices.map((index, i) => {
        const edge = sub(
          vertices[indices[(i + 1) % indices.length]],
          vertices[index],
        );
        return (
          Math.hypot(...cross(sub(center, vertices[index]), edge)) /
          Math.hypot(...edge)
        );
      }),
    );
    return { indices, value, center, normal, right, up, inradius };
  });
  const body = { sides, vertices, faces };
  cache.set(sides, body);
  return body;
}

export function frontFace(body, orientation) {
  return body.faces.reduce((best, face) =>
    rotatePoint(face.normal, orientation)[2] >
    rotatePoint(best.normal, orientation)[2]
      ? face
      : best,
  );
}

// Canvas rendering uses the same projected vertices as collision detection.
// No WebGL/CDN startup, and only the small die canvas is repainted each frame.
export function drawDie(
  ctx,
  body,
  orientation,
  size,
  pixelRatio = 1,
  dark = false,
  settledValue = null,
) {
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  const rotated = body.vertices.map((p) => rotatePoint(p, orientation));
  const projected = rotated.map((p) => projectPoint(p).map((v) => v * size));
  const light = unit([-0.5, 0.75, 1]);
  const visible = body.faces
    .map((face) => ({
      ...face,
      n: rotatePoint(face.normal, orientation),
      c: rotatePoint(face.center, orientation),
    }))
    .filter((f) => dot(f.n, sub([0, 0, 6], f.c)) > 0)
    .sort((a, b) => a.c[2] - b.c[2]);
  const path = (points) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  for (const face of visible) {
    const highlighted = face.value === settledValue;
    const shade = Math.max(0, dot(face.n, light));
    const tone = highlighted
      ? 23 + shade * 8
      : (dark ? 130 : 142) + shade * 102;
    const color = (offset = 0) =>
      `rgb(${Math.round(tone + offset)} ${Math.round(tone - (highlighted ? 1 : 5) + offset)} ${Math.round(tone - (highlighted ? 3 : 16) + offset)})`;
    const outer = face.indices.map((i) => projected[i]);
    const bevel = body.sides <= 20 ? 0.075 : 0.045;
    const inset3 = face.indices.map((i) =>
      add(scale(rotated[i], 1 - bevel), scale(face.c, bevel)),
    );
    const inner = inset3.map((p) => projectPoint(p).map((v) => v * size));
    path(outer);
    ctx.fillStyle = color(highlighted ? -10 : -26);
    ctx.fill();
    // Each bevel catches the fixed light independently as the body tumbles.
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      path([outer[i], outer[j], inner[j], inner[i]]);
      const edge = unit(sub(rotated[face.indices[i]], face.c));
      ctx.fillStyle = color(dot(edge, light) * (highlighted ? 15 : 34));
      ctx.fill();
    }
    path(inner);
    const gradient = ctx.createLinearGradient(
      0,
      -size * 0.45,
      size * 0.2,
      size * 0.45,
    );
    gradient.addColorStop(0, color(13));
    gradient.addColorStop(1, color(-7));
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = highlighted
      ? "rgba(255,250,232,.95)"
      : "rgba(255,250,232,.3)";
    ctx.lineWidth = highlighted ? 1.2 : 0.6;
    ctx.stroke();
    if (face.n[2] < 0.06) continue;
    const center = projectPoint(face.c),
      u = projectPoint(add(face.c, rotatePoint(face.right, orientation))),
      v = projectPoint(add(face.c, rotatePoint(face.up, orientation)));
    ctx.save();
    path(inner);
    ctx.clip();
    const fontScale = face.inradius * 0.012;
    ctx.transform(
      (u[0] - center[0]) * size * fontScale,
      (u[1] - center[1]) * size * fontScale,
      -(v[0] - center[0]) * size * fontScale,
      -(v[1] - center[1]) * size * fontScale,
      center[0] * size,
      center[1] * size,
    );
    const label = String(face.value);
    ctx.font = `600 ${highlighted ? 128 : 120}px "Dice Numerals", "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText(label);
    // Fit uniformly rather than squeezing three-digit numbers horizontally.
    const fit = Math.min(1, 140 / metrics.width);
    ctx.scale(fit, fit);
    const ascent = metrics.actualBoundingBoxAscent;
    const descent = metrics.actualBoundingBoxDescent;
    const baseline = (ascent - descent) / 2;
    // Only the landed face inverts. Its orientation and number never change.
    ctx.fillStyle = highlighted ? "rgba(0,0,0,.65)" : "rgba(255,255,245,.55)";
    ctx.fillText(label, 0, baseline + 1.5);
    ctx.fillStyle = highlighted ? "#fffdf4" : "#25231f";
    ctx.fillText(label, 0, baseline);
    if (face.value === 6 || face.value === 9) {
      ctx.fillRect(-16, baseline + descent + 8, 32, 3);
    }
    ctx.restore();
  }
}
