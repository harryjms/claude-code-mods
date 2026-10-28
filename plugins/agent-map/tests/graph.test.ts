import { expect, test } from 'claude-code/testing'
import { canvasToLines, canvasToRaster, cellSafe, chooseMap, fit, layoutMap, mapToSvg, outline, paintCanvas } from '../hooks/graph.js'

const NODES = [
  { id: 'main', parentId: null, status: 'main', label: 'main', detail: '4 calls' },
  { id: 'a1', parentId: 'main', status: 'running', label: 'Explore', detail: '↻ Grep' },
  { id: 'a2', parentId: 'a1', status: 'completed', label: 'reader', detail: 'haiku-5-5' },
  { id: 'a3', parentId: 'main', status: 'idle', label: 'scout', detail: 'teammate' },
]
const PAIRS = [{ a: 'a1', b: 'main', toA: false, toB: true, count: 2 }]

function draw(orient: 'down' | 'right') {
  const map = chooseMap(NODES, PAIRS, { maxCols: 200, force: orient })
  return { map, lines: canvasToLines(paintCanvas(map, NODES, 'a1')) }
}

test('a parent sits above its children, top-down', () => {
  const layout = layoutMap(NODES, { orient: 'down' })
  const main = layout.boxes.get('main')
  const explore = layout.boxes.get('a1')
  const reader = layout.boxes.get('a2')
  expect(explore.y).toBeGreaterThan(main.y)
  expect(reader.y).toBeGreaterThan(explore.y)
  expect(layout.spawns).toEqual([{ from: 'main', to: 'a1' }, { from: 'main', to: 'a3' }, { from: 'a1', to: 'a2' }])
})

test('a parent sits left of its children, left-to-right', () => {
  const layout = layoutMap(NODES, { orient: 'right' })
  expect(layout.boxes.get('a1').x).toBeGreaterThan(layout.boxes.get('main').x)
  expect(layout.boxes.get('a2').x).toBeGreaterThan(layout.boxes.get('a1').x)
})

test('spawn lines meet the boxes at junctions, and the selected box is doubled', () => {
  const { lines } = draw('down')
  const text = lines.join('\n')
  expect(text).toContain('╭────────┬───────╯'.slice(-9))
  expect(text).toContain('╧')
  expect(text).toContain('║ ● Explore')
  expect(text).toContain('│ ◌ scout')
})

test('a message line ends in an arrow beside the box that received it', () => {
  for (const orient of ['down', 'right'] as const) {
    const { map, lines } = draw(orient)
    expect(map.messagePaths.length).toBe(1)
    const path = map.messagePaths[0]
    const [x, y] = path.cells[path.cells.length - 1]
    expect('▲►▼◄').toContain(lines[y][x])
    // The arrow points into the main box
    const main = map.boxes.get('main')
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][path.inward]
    const inside = (cx: number, cy: number) => cx >= main.x && cx < main.x + main.w && cy >= main.y && cy < main.y + main.h
    expect(inside(x + dx, y + dy)).toBe(true)
  }
})

test('no line runs through a box', () => {
  const { map } = draw('down')
  for (const box of map.boxes.values()) {
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        expect(map.dash[y * map.cols + x]).toBe(0)
      }
    }
  }
})

test('the map picks the orientation and box width that fit', () => {
  const wide = chooseMap(NODES, PAIRS, { maxCols: 200, prefer: 'down' })
  expect(wide.orient).toBe('down')
  expect(wide.boxWidth).toBe(18)
  const narrow = chooseMap(NODES, PAIRS, { maxCols: 50, prefer: 'down' })
  expect(narrow.cols).toBeLessThanOrEqual(50)
})

test('Raster cells hold three 32-bit numbers per cell', () => {
  const { map } = draw('down')
  const cells = canvasToRaster(paintCanvas(map, NODES, 'a1'))
  expect(cells.length).toBe(Math.ceil((map.cols * map.rows * 12) / 3) * 4)
})

test('characters a Raster cell refuses become ?', () => {
  expect(cellSafe('fixer 🔧 日本')).toBe('fixer ? ??')
  expect(cellSafe('café · ok')).toBe('café · ok')
  expect(fit('general-purpose', 10)).toBe('general-p…')
})

test('the Svg draws a box per node and an arrow marker for messages', () => {
  const { map } = draw('down')
  const svg = mapToSvg(map, NODES, 'a1')
  expect(svg.match(/<rect /g)?.length).toBe(4)
  expect(svg).toContain('marker-end="url(#arrow)"')
  expect(svg).toContain('>Explore<')
})

test('the outline lists the tree and the messages', () => {
  expect(outline(NODES, PAIRS)).toBe(
    ['◆ main', '  ● Explore (running)', '    ✓ reader (completed)', '  ◌ scout (idle)', 'message: Explore → main'].join('\n'),
  )
})
