const SVG_START = '<svg class="dice-shape-svg" viewBox="0 0 220 220" aria-hidden="true" focusable="false">';

const SHAPES = Object.freeze({
  tetrahedron: `
    <path class="dice-shape-base" d="M110 15 205 194H15Z" />
    <path class="dice-facet dice-facet-light" d="M110 15 110 124 15 194Z" />
    <path class="dice-facet dice-facet-dark" d="m110 15 95 179-95-70Z" />
    <path class="dice-facet-line" d="m15 194 95-70 95 70" />`,
  cube: `
    <rect class="dice-shape-base" x="20" y="20" width="180" height="180" rx="35" />
    <path class="dice-highlight" d="M49 31h122a18 18 0 0 1 18 18v19C151 49 91 48 31 72V49a18 18 0 0 1 18-18Z" />
    <rect class="dice-bevel" x="29" y="29" width="162" height="162" rx="29" />`,
  octahedron: `
    <path class="dice-shape-base" d="M110 8 207 110 110 212 13 110Z" />
    <path class="dice-facet dice-facet-light" d="M110 8 110 110 13 110Z" />
    <path class="dice-facet dice-facet-mid" d="m110 8 97 102h-97Z" />
    <path class="dice-facet dice-facet-dark" d="m13 110 97 102V110Z" />
    <path class="dice-facet-line" d="m207 110-97 102V110Z" />`,
  trapezohedron: `
    <path class="dice-shape-base" d="m110 7 69 39 28 78-42 82H55l-42-82 28-78Z" />
    <path class="dice-facet dice-facet-light" d="M110 7 83 109 41 46Z" />
    <path class="dice-facet dice-facet-mid" d="m110 7 69 39-42 63Z" />
    <path class="dice-facet dice-facet-dark" d="m41 46 42 63-70 15ZM179 46l-42 63 70 15Z" />
    <path class="dice-facet-line" d="m13 124 70-15-28 97m152-82-70-15 28 97M83 109h54l28 97H55Z" />`,
  dodecahedron: `
    <path class="dice-shape-base" d="m110 7 55 18 39 43v84l-39 43-55 18-55-18-39-43V68l39-43Z" />
    <path class="dice-facet dice-facet-light" d="m110 33 50 36-19 59H79L60 69Z" />
    <path class="dice-facet dice-facet-mid" d="M55 25 60 69 16 68ZM165 25l-5 44 44-1Z" />
    <path class="dice-facet dice-facet-dark" d="m16 152 63-24-24 67Zm188 0-63-24 24 67Z" />
    <path class="dice-facet-line" d="M16 68 60 69m100 0 44-1M16 152l63-24m62 0 63 24M55 195l24-67m62 0 24 67" />`,
  icosahedron: `
    <path class="dice-shape-base" d="m110 5 63 20 39 53v65l-39 52-63 20-63-20-39-52V78l39-53Z" />
    <path class="dice-facet dice-facet-light" d="m110 5 27 69-72-28ZM8 78l57-32 1 75Z" />
    <path class="dice-facet dice-facet-mid" d="m173 25-36 49 75 4ZM66 121l71-47 17 72Z" />
    <path class="dice-facet dice-facet-dark" d="m8 143 58-22 9 71Zm204 0-58 3 19 49Z" />
    <path class="dice-facet-line" d="M65 46 137 74l36-49M65 46l1 75 88 25 58-68M8 143l58-22 9 71 79-46 19 49M110 215l-35-23" />`,
  multifaceted: `
    <path class="dice-shape-base" d="m110 4 52 13 40 35 15 58-15 58-40 35-52 13-52-13-40-35-15-58 15-58 40-35Z" />
    <path class="dice-facet dice-facet-light" d="m110 4 22 51-55-27ZM18 52l59-24-19 57ZM3 110l55-25 17 54Z" />
    <path class="dice-facet dice-facet-mid" d="m162 17-30 38 70-3ZM132 55l70-3-36 56ZM75 139l35-51 45 55Z" />
    <path class="dice-facet dice-facet-dark" d="m3 110 72 29-57 29Zm199 58-47-25 7 60ZM58 203l17-64 35 77Z" />
    <path class="dice-facet-line" d="m77 28 55 27-22 33-52-3 19-57m55 27 34 53-11 35-45-55-35 51m127-87-36 56 51 2M18 168l57-29-17 64m104 0-7-60 47 25m-92 48v-56" />`,
  zocchihedron: `
    <circle class="dice-shape-base" cx="110" cy="110" r="105" />
    <path class="dice-facet dice-facet-light" d="M110 5 76 38l34 31 35-31ZM38 30 22 71l54-33ZM5 110l17-39 37 39-37 39Z" />
    <path class="dice-facet dice-facet-mid" d="m145 38 53 33-37 39-51-41Zm-86 72 51-41 51 41-51 42Zm-37 39 53 34 35-31-51-42Z" />
    <path class="dice-facet dice-facet-dark" d="m198 71 17 39-17 39-37-39Zm-88 81 35 31-35 32-35-32Zm35 31 53-34-16 41Z" />
    <path class="dice-facet-line" d="m38 30 38 8m69 0 37-8M22 71l37 39M198 71l-37 39M22 149l53 34m123-34-53 34M76 38 59 110l51-41 51 41-16-72M59 110l16 73 35-31 35 31 16-73" />
    <ellipse class="dice-gloss" cx="81" cy="57" rx="45" ry="27" transform="rotate(-24 81 57)" />`,
});

export function dieSvgMarkup(shape) {
  return `${SVG_START}${SHAPES[shape] || SHAPES.multifaceted}</svg>`;
}

// Matching silhouettes for contact detection; points use the SVG's coordinates.
export function dieCollisionOutline(shape) {
  const polygons = {
    tetrahedron: [[110,15],[205,194],[15,194]],
    octahedron: [[110,8],[207,110],[110,212],[13,110]],
    trapezohedron: [[110,7],[179,46],[207,124],[165,206],[55,206],[13,124],[41,46]],
    dodecahedron: [[110,7],[165,25],[204,68],[204,152],[165,195],[110,213],[55,195],[16,152],[16,68],[55,25]],
    icosahedron: [[110,5],[173,25],[212,78],[212,143],[173,195],[110,215],[47,195],[8,143],[8,78],[47,25]],
    multifaceted: [[110,4],[162,17],[202,52],[217,110],[202,168],[162,203],[110,216],[58,203],[18,168],[3,110],[18,52],[58,17]],
  };
  let points = polygons[shape];
  if (shape === "cube") {
    points = [];
    for (const [cx, cy, start] of [[165,165,0],[55,165,90],[55,55,180],[165,55,270]]) {
      for (let i = 0; i <= 8; i++) {
        const angle = (start + i * 90 / 8) * Math.PI / 180;
        points.push([cx + 35 * Math.cos(angle), cy + 35 * Math.sin(angle)]);
      }
    }
  }
  if (!points) points = Array.from({ length: 48 }, (_, i) => {
    const a = i * Math.PI / 24;
    return [110 + 105 * Math.cos(a), 110 + 105 * Math.sin(a)];
  });
  return points.map(([x,y]) => [(x - 110) / 220, (y - 110) / 220]);
}
