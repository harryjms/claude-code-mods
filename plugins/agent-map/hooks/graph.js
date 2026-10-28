// agent-map's drawing. Lays the agents out as boxes, joins each agent to the
// one that started it, routes message lines around the boxes, and paints the
// result as a character canvas (for a terminal Raster) or as SVG (for the
// Desktop app and VS Code). Pure functions: nothing here calls the mods API.

export const BOX_HEIGHT = 4
const MARGIN = 2
const TURN = 2

// Line directions, as bits so one cell can hold several line ends
const N = 0, E = 1, S = 2, W = 3
const STEP = [[0, -1], [1, 0], [0, 1], [-1, 0]]
const opposite = (d) => (d + 2) % 4
const bit = (d) => 1 << d
const HORIZONTAL = bit(E) | bit(W)
const VERTICAL = bit(N) | bit(S)

// Glyphs indexed by a mask of line ends: N=1, E=2, S=4, W=8
const SOLID = [' ', '│', '─', '└', '│', '│', '┌', '├', '─', '┘', '─', '┴', '┐', '┤', '┬', '┼']
const DASHED = [' ', '╎', '╌', '╰', '╎', '╎', '╭', '├', '╌', '╯', '╌', '┴', '╮', '┤', '┬', '┼']
const ARROW = ['▲', '►', '▼', '◄']
// For a one-cell line with messages both ways, by the axis it runs on
const BOTH_WAYS = { [N]: '⇅', [S]: '⇅', [E]: '⇄', [W]: '⇄' }

const ROUND = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', out: ['┴', '├', '┬', '┤'], in: ['┴', '├', '┬', '┤'] }
const DOUBLE = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', out: ['╧', '╟', '╤', '╢'], in: ['╧', '╟', '╤', '╢'] }

// A Raster color is 0xRRGGBB, or this value for the terminal's own color
export const DEFAULT_COLOR = 0x01000000

export const STATUS = {
  main: { glyph: '◆', color: 0xd97757 },
  external: { glyph: '◇', color: 0x8e24aa },
  pending: { glyph: '…', color: 0x9e9e9e },
  running: { glyph: '●', color: 0x43a047 },
  waiting: { glyph: '◌', color: 0xf9a825 },
  idle: { glyph: '◌', color: 0xf9a825 },
  completed: { glyph: '✓', color: 0x1e88e5 },
  failed: { glyph: '✗', color: 0xe53935 },
  killed: { glyph: '⊘', color: 0x757575 },
}
const SPAWN_COLOR = 0x8a8a8a
const MESSAGE_COLOR = 0xab47bc
const DETAIL_COLOR = 0x9e9e9e

export function statusOf(name) {
  return STATUS[name] ?? STATUS.pending
}

// A Raster cell takes one width-1 character. Keep Latin text and this mod's own
// glyphs, and draw anything else, such as an emoji in an agent's name, as '?'.
const OWN_GLYPHS = new Set([...'…·↻→◆◇●◌✓✗⊘'])
export function cellSafe(text) {
  return Array.from(String(text ?? ''), (ch) => {
    const cp = ch.codePointAt(0)
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0x24f) || OWN_GLYPHS.has(ch)) return ch
    return cp < 0x20 ? ' ' : '?'
  }).join('')
}

// Cut text to `width` characters, marking a cut with an ellipsis
export function fit(text, width) {
  const chars = Array.from(String(text ?? ''))
  if (chars.length <= width) return chars.join('')
  return chars.slice(0, Math.max(0, width - 1)).join('') + '…'
}

// claude-haiku-5-5-20260101 -> haiku-5-5
export function shortModel(model) {
  if (!model) return ''
  return String(model).replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '')
}

// Place each node in a tidy tree. `orient` is 'down' (roots at the top) or
// 'right' (roots at the left). Returns the grid size and each node's box.
export function layoutMap(nodes, { orient = 'down', boxWidth = 18 } = {}) {
  const down = orient === 'down'
  // Room between neighbouring boxes for message lines: three columns, or one row
  const breadthUnit = down ? boxWidth + 3 : BOX_HEIGHT + 1
  const depthUnit = down ? BOX_HEIGHT + 3 : boxWidth + 5
  const ids = new Set(nodes.map((n) => n.id))
  const children = new Map()
  const roots = []
  for (const n of nodes) {
    if (n.parentId && n.parentId !== n.id && ids.has(n.parentId)) {
      if (!children.has(n.parentId)) children.set(n.parentId, [])
      children.get(n.parentId).push(n.id)
    } else {
      roots.push(n.id)
    }
  }

  // Leaves take the next slot across; a parent sits centred over its children
  const slot = new Map()
  const depth = new Map()
  let next = 0
  const place = (id, d) => {
    depth.set(id, d)
    const kids = (children.get(id) ?? []).filter((k) => !depth.has(k))
    for (const k of kids) place(k, d + 1)
    slot.set(id, kids.length ? (slot.get(kids[0]) + slot.get(kids[kids.length - 1])) / 2 : next++)
  }
  for (const id of roots) place(id, 0)
  // A parent loop, which shouldn't happen, is drawn from wherever it starts
  for (const n of nodes) if (!depth.has(n.id)) place(n.id, 0)

  const boxes = new Map()
  let cols = 0
  let rows = 0
  for (const n of nodes) {
    const across = Math.round(slot.get(n.id) * breadthUnit)
    const along = depth.get(n.id) * depthUnit
    const box = { x: MARGIN + (down ? across : along), y: MARGIN + (down ? along : across), w: boxWidth, h: BOX_HEIGHT }
    boxes.set(n.id, box)
    cols = Math.max(cols, box.x + box.w + MARGIN)
    rows = Math.max(rows, box.y + box.h + MARGIN)
  }

  const spawns = []
  for (const [from, kids] of children) {
    for (const to of kids) if (depth.get(to) === depth.get(from) + 1) spawns.push({ from, to })
  }
  return { orient, boxWidth, cols, rows, boxes, spawns }
}

// Cells from one corner point to the next, inclusive, along straight lines
function walk(points) {
  const cells = [points[0]]
  for (let i = 1; i < points.length; i++) {
    let [x, y] = cells[cells.length - 1]
    const [tx, ty] = points[i]
    while (x !== tx || y !== ty) {
      if (x !== tx) x += Math.sign(tx - x)
      else y += Math.sign(ty - y)
      cells.push([x, y])
    }
  }
  return cells
}

// The cell on a box's border where a spawn line leaves the parent or enters the child
function spawnPorts(layout, from, to) {
  const a = layout.boxes.get(from)
  const b = layout.boxes.get(to)
  if (layout.orient === 'down') {
    const ax = a.x + Math.floor(a.w / 2)
    const bx = b.x + Math.floor(b.w / 2)
    const mid = a.y + a.h + 1
    return { out: [ax, a.y + a.h - 1, S], in: [bx, b.y, N], points: [[ax, a.y + a.h], [ax, mid], [bx, mid], [bx, b.y - 1]] }
  }
  const ay = a.y + 1
  const by = b.y + 1
  const mid = a.x + a.w + 2
  return { out: [a.x + a.w - 1, ay, E], in: [b.x, by, W], points: [[a.x + a.w, ay], [mid, ay], [mid, by], [b.x - 1, by]] }
}

// Add a path's line ends to a mask grid. `first` is the direction from the
// first cell back to where the line starts; `last`, from the last cell on.
function trace(mask, cols, cells, first, last) {
  cells.forEach(([x, y], i) => {
    const c = y * cols + x
    if (i === 0) mask[c] |= bit(first)
    if (i === cells.length - 1) mask[c] |= bit(last)
    if (i < cells.length - 1) {
      const [nx, ny] = cells[i + 1]
      const d = nx > x ? E : nx < x ? W : ny > y ? S : N
      mask[c] |= bit(d)
      mask[ny * cols + nx] |= bit(opposite(d))
    }
  })
}

// A binary min-heap of grid states, ordered by cost and then by insertion
class Heap {
  constructor() { this.items = []; this.seq = 0 }
  get size() { return this.items.length }
  push(state, cost) {
    const items = this.items
    items.push([cost, this.seq++, state])
    let i = items.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!less(items[i], items[p])) break
      ;[items[i], items[p]] = [items[p], items[i]]
      i = p
    }
  }
  pop() {
    const items = this.items
    const top = items[0]
    const end = items.pop()
    if (items.length) {
      items[0] = end
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < items.length && less(items[l], items[m])) m = l
        if (r < items.length && less(items[r], items[m])) m = r
        if (m === i) break
        ;[items[i], items[m]] = [items[m], items[i]]
        i = m
      }
    }
    return top
  }
}
const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])

// The cells just outside a box's four sides, skipping the corners, each with
// the direction that points away from the box and a small cost that favours
// the middle of a side
function sideCells(box) {
  const out = []
  const cx = box.x + (box.w - 1) / 2
  const cy = box.y + (box.h - 1) / 2
  for (let x = box.x + 1; x < box.x + box.w - 1; x++) {
    out.push([x, box.y - 1, N, Math.abs(x - cx) * 0.3])
    out.push([x, box.y + box.h, S, Math.abs(x - cx) * 0.3])
  }
  for (let y = box.y + 1; y < box.y + box.h - 1; y++) {
    out.push([box.x - 1, y, W, Math.abs(y - cy) * 0.3])
    out.push([box.x + box.w, y, E, Math.abs(y - cy) * 0.3])
  }
  return out
}

// The extra cost of running a message line through a cell other lines use:
// crossing is cheap, running alongside is dear
function overlap(grid, c, d) {
  const along = d === E || d === W ? HORIZONTAL : VERTICAL
  let cost = 0
  if (grid.solid[c]) cost += grid.solid[c] & along ? 8 : 2
  if (grid.dash[c]) cost += grid.dash[c] & along ? 4 : 1
  return cost
}

// The cheapest line from box `a` to box `b` that goes around every box, with
// few turns. Returns the cells and the directions at each end, or null.
function routeBetween(layout, grid, a, b) {
  const { cols, rows } = layout
  const dist = new Float64Array(cols * rows * 4).fill(Infinity)
  const prev = new Int32Array(cols * rows * 4).fill(-1)
  const heap = new Heap()
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows

  for (const [x, y, d, bias] of sideCells(layout.boxes.get(a))) {
    const c = y * cols + x
    if (!inBounds(x, y) || grid.blocked[c]) continue
    const s = c * 4 + d
    const cost = bias + overlap(grid, c, d)
    if (cost < dist[s]) {
      dist[s] = cost
      heap.push(s, cost)
    }
  }
  const goals = new Map()
  for (const [x, y, d, bias] of sideCells(layout.boxes.get(b))) {
    if (inBounds(x, y)) goals.set(y * cols + x, { inward: opposite(d), bias })
  }

  let best = Infinity
  let bestState = -1
  while (heap.size) {
    const [cost, , s] = heap.pop()
    if (cost > dist[s]) continue
    if (cost >= best) break
    const c = s >> 2
    const d = s & 3
    const goal = goals.get(c)
    if (goal) {
      const total = cost + goal.bias + (d === goal.inward ? 0 : TURN)
      if (total < best) {
        best = total
        bestState = s
      }
    }
    const x = c % cols
    const y = (c - x) / cols
    for (let nd = 0; nd < 4; nd++) {
      if (nd === opposite(d)) continue
      const nx = x + STEP[nd][0]
      const ny = y + STEP[nd][1]
      if (!inBounds(nx, ny)) continue
      const nc = ny * cols + nx
      if (grid.blocked[nc]) continue
      const ns = nc * 4 + nd
      const next = cost + 1 + (nd === d ? 0 : TURN) + overlap(grid, nc, nd)
      if (next < dist[ns]) {
        dist[ns] = next
        prev[ns] = s
        heap.push(ns, next)
      }
    }
  }
  if (bestState < 0) return null

  const cells = []
  let s = bestState
  let start = s
  while (s >= 0) {
    const c = s >> 2
    cells.push([c % cols, Math.floor(c / cols)])
    start = s
    s = prev[s]
  }
  cells.reverse()
  return { cells, out: start & 3, inward: goals.get(bestState >> 2).inward }
}

// Join each agent to the one that started it, then route a dashed line for
// each pair of nodes that exchanged messages. `pairs` is a list of
// `{ a, b, toA, toB, count }`, with `toB` set when `a` sent to `b`.
export function connect(layout, pairs = []) {
  const { cols, rows } = layout
  const grid = {
    blocked: new Uint8Array(cols * rows),
    solid: new Uint8Array(cols * rows),
    dash: new Uint8Array(cols * rows),
  }
  for (const box of layout.boxes.values()) {
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) grid.blocked[y * cols + x] = 1
    }
  }

  const spawnPaths = layout.spawns.map(({ from, to }) => {
    const ports = spawnPorts(layout, from, to)
    const cells = walk(ports.points)
    trace(grid.solid, cols, cells, opposite(ports.out[2]), opposite(ports.in[2]))
    return { from, to, cells, out: ports.out, in: ports.in }
  })

  // Busier pairs go first, so they get the cleanest routes
  const messagePaths = []
  for (const pair of [...pairs].sort((p, q) => q.count - p.count)) {
    if (!layout.boxes.has(pair.a) || !layout.boxes.has(pair.b) || pair.a === pair.b) continue
    const route = routeBetween(layout, grid, pair.a, pair.b)
    if (!route) continue
    trace(grid.dash, cols, route.cells, opposite(route.out), route.inward)
    messagePaths.push({ ...pair, ...route })
  }
  return { ...layout, solid: grid.solid, dash: grid.dash, spawnPaths, messagePaths }
}

// Lay out and connect the map, choosing the orientation and box width that fit
// `maxCols`. `prefer` is tried first; `force` allows only that orientation.
export function chooseMap(nodes, pairs, { maxCols = 80, prefer = 'down', force } = {}) {
  const orients = force ? [force] : [prefer, prefer === 'down' ? 'right' : 'down']
  let narrowest = null
  for (const boxWidth of [18, 14]) {
    for (const orient of orients) {
      const layout = layoutMap(nodes, { orient, boxWidth })
      if (layout.cols <= maxCols) return connect(layout, pairs)
      if (!narrowest || layout.cols < narrowest.cols) narrowest = layout
    }
  }
  return connect(narrowest, pairs)
}

// Paint the map onto a grid of characters and colors. Each node has `id`,
// `status` (a key of STATUS), `label` and `detail`.
export function paintCanvas(map, nodes, selectedId) {
  const { cols, rows } = map
  const chars = new Array(cols * rows).fill(' ')
  const colors = new Uint32Array(cols * rows).fill(DEFAULT_COLOR)
  const put = (x, y, ch, color) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return
    chars[y * cols + x] = ch
    colors[y * cols + x] = color
  }

  for (let c = 0; c < cols * rows; c++) {
    if (map.solid[c]) {
      chars[c] = SOLID[map.solid[c] | map.dash[c]]
      colors[c] = SPAWN_COLOR
    } else if (map.dash[c]) {
      chars[c] = DASHED[map.dash[c]]
      colors[c] = MESSAGE_COLOR
    }
  }

  const styles = new Map()
  for (const n of nodes) {
    const box = map.boxes.get(n.id)
    if (!box) continue
    const style = n.id === selectedId ? DOUBLE : ROUND
    styles.set(n.id, style)
    const { glyph, color } = statusOf(n.status)
    const right = box.x + box.w - 1
    const bottom = box.y + box.h - 1
    for (let x = box.x + 1; x < right; x++) {
      put(x, box.y, style.h, color)
      put(x, bottom, style.h, color)
    }
    for (let y = box.y + 1; y < bottom; y++) {
      put(box.x, y, style.v, color)
      put(right, y, style.v, color)
      for (let x = box.x + 1; x < right; x++) put(x, y, ' ', DEFAULT_COLOR)
    }
    put(box.x, box.y, style.tl, color)
    put(right, box.y, style.tr, color)
    put(box.x, bottom, style.bl, color)
    put(right, bottom, style.br, color)

    const inner = box.w - 4
    put(box.x + 2, box.y + 1, glyph, color)
    Array.from(fit(cellSafe(n.label), inner - 2)).forEach((ch, i) => put(box.x + 4 + i, box.y + 1, ch, DEFAULT_COLOR))
    Array.from(fit(cellSafe(n.detail), inner)).forEach((ch, i) => put(box.x + 2 + i, box.y + 2, ch, DETAIL_COLOR))
  }

  // Where a spawn line meets a border, draw the border's junction
  for (const p of map.spawnPaths) {
    const from = styles.get(p.from)
    const to = styles.get(p.to)
    if (from) put(p.out[0], p.out[1], from.out[p.out[2]], colors[p.out[1] * cols + p.out[0]])
    if (to) put(p.in[0], p.in[1], to.in[p.in[2]], colors[p.in[1] * cols + p.in[0]])
  }

  // An arrowhead next to each node that received messages
  for (const m of map.messagePaths) {
    const first = m.cells[0]
    const last = m.cells[m.cells.length - 1]
    if (m.toB) put(last[0], last[1], ARROW[m.inward], MESSAGE_COLOR)
    if (m.toA) put(first[0], first[1], ARROW[opposite(m.out)], MESSAGE_COLOR)
    if (m.toA && m.toB && m.cells.length === 1) put(first[0], first[1], BOTH_WAYS[m.inward], MESSAGE_COLOR)
  }
  return { cols, rows, chars, colors }
}

// The `cells` string a Raster takes: base64 of [codePoint, color, background]
// for every cell, row by row
export function canvasToRaster(canvas) {
  const words = new Uint32Array(canvas.cols * canvas.rows * 3)
  for (let c = 0; c < canvas.cols * canvas.rows; c++) {
    words[c * 3] = canvas.chars[c].codePointAt(0)
    words[c * 3 + 1] = canvas.colors[c]
    words[c * 3 + 2] = DEFAULT_COLOR
  }
  return new Uint8Array(words.buffer).toBase64()
}

// The canvas as plain lines of text, with trailing spaces trimmed
export function canvasToLines(canvas) {
  const lines = []
  for (let y = 0; y < canvas.rows; y++) {
    lines.push(canvas.chars.slice(y * canvas.cols, (y + 1) * canvas.cols).join('').replace(/\s+$/, ''))
  }
  return lines
}

const hex = (color) => '#' + color.toString(16).padStart(6, '0')
const xml = (text) => String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])

// Remove the points in the middle of straight runs
function corners(points) {
  return points.filter((p, i) => {
    if (i === 0 || i === points.length - 1) return true
    const [a, b] = [points[i - 1], points[i + 1]]
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]))
  })
}

// The same map as an SVG document, scaled from cells to pixels, for the apps
// that draw Svg and not Raster
export function mapToSvg(map, nodes, selectedId, { cell = [8, 18] } = {}) {
  const [cw, ch] = cell
  const X = (x) => x * cw + cw / 2
  const Y = (y) => y * ch + ch / 2
  const poly = (points) => corners(points).map(([x, y]) => X(x) + ',' + Y(y)).join(' ')
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${map.cols * cw} ${map.rows * ch}" width="${map.cols * cw}" height="${map.rows * ch}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${hex(MESSAGE_COLOR)}"/></marker></defs>`,
  ]
  for (const p of map.spawnPaths) {
    const points = [[p.out[0], p.out[1]], ...p.cells, [p.in[0], p.in[1]]]
    parts.push(`<polyline points="${poly(points)}" fill="none" stroke="${hex(SPAWN_COLOR)}" stroke-width="1.5"/>`)
  }
  for (const m of map.messagePaths) {
    const [fx, fy] = m.cells[0]
    const [lx, ly] = m.cells[m.cells.length - 1]
    const points = [[fx - STEP[m.out][0], fy - STEP[m.out][1]], ...m.cells, [lx + STEP[m.inward][0], ly + STEP[m.inward][1]]]
    const ends = (m.toB ? ' marker-end="url(#arrow)"' : '') + (m.toA ? ' marker-start="url(#arrow)"' : '')
    parts.push(`<polyline points="${poly(points)}" fill="none" stroke="${hex(MESSAGE_COLOR)}" stroke-width="1.5" stroke-dasharray="5 4"${ends}/>`)
  }
  for (const n of nodes) {
    const box = map.boxes.get(n.id)
    if (!box) continue
    const { color } = statusOf(n.status)
    const x = X(box.x)
    const y = Y(box.y)
    const inner = box.w - 4
    parts.push(
      `<rect x="${x}" y="${y}" width="${(box.w - 1) * cw}" height="${(box.h - 1) * ch}" rx="6" fill="#fafafa" stroke="${hex(color)}" stroke-width="${n.id === selectedId ? 3 : 1.5}"/>`,
      `<circle cx="${x + 12}" cy="${y + ch * 0.9}" r="4" fill="${hex(color)}"/>`,
      `<text x="${x + 22}" y="${y + ch * 0.9 + 4}" fill="#1f1f1f" font-weight="600">${xml(fit(n.label, inner - 2))}</text>`,
      `<text x="${x + 8}" y="${y + ch * 1.9 + 4}" fill="#666666" font-size="11">${xml(fit(n.detail, inner))}</text>`,
    )
  }
  parts.push('</svg>')
  return parts.join('')
}

// The map as an indented outline: the Svg's alt text, and the fallback when a
// map is too big to draw
export function outline(nodes, pairs = []) {
  const byParent = new Map()
  const ids = new Set(nodes.map((n) => n.id))
  const roots = []
  for (const n of nodes) {
    if (n.parentId && ids.has(n.parentId) && n.parentId !== n.id) {
      if (!byParent.has(n.parentId)) byParent.set(n.parentId, [])
      byParent.get(n.parentId).push(n)
    } else {
      roots.push(n)
    }
  }
  const lines = []
  const seen = new Set()
  const visit = (n, depth) => {
    if (seen.has(n.id)) return
    seen.add(n.id)
    const status = n.status === 'main' || n.status === 'external' ? '' : ' (' + n.status + ')'
    lines.push('  '.repeat(depth) + statusOf(n.status).glyph + ' ' + n.label + status)
    for (const kid of byParent.get(n.id) ?? []) visit(kid, depth + 1)
  }
  for (const n of roots) visit(n, 0)
  const label = (id) => nodes.find((n) => n.id === id)?.label ?? id
  for (const p of pairs) {
    if (p.toB) lines.push('message: ' + label(p.a) + ' → ' + label(p.b))
    if (p.toA) lines.push('message: ' + label(p.b) + ' → ' + label(p.a))
  }
  return lines.join('\n')
}
