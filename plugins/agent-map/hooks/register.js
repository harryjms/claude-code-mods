// agent-map: /agent-map opens a pane that draws this session's agents as a
// node map. Each box is an agent, a solid line joins an agent to the one that
// started it, and a dashed arrow shows who sent messages to whom. The terminal
// draws the map as a Raster; the Desktop app and VS Code draw it as an Svg.
import { canvasToLines, canvasToRaster, chooseMap, fit, mapToSvg, outline, paintCanvas, shortModel, statusOf } from './graph.js'

const PANE = 'agent-map'
const FINISHED = ['completed', 'failed', 'killed']
const POLL_MS = 2000
// The largest Raster and Svg the apps draw
const MAX_RASTER = { cols: 512, rows: 256 }
const MAX_SVG_CHARS = 131072

// The map's data. Module state: after a reload, session.start rebuilds the
// agents from $.agent.list(), and tool counts and messages start again.
let nodes = new Map()
let messages = new Map()
let messageSeq = 0
let selectedId = 'main'
let hideFinished = false
let orient = 'auto'
let poll = null
// The last laid-out map, reused until the agents or their links change
let cached = { key: '', map: null }

reset()

function reset() {
  nodes = new Map([['main', { id: 'main', kind: 'main', status: 'main', calls: 0 }]])
  messages = new Map()
  selectedId = 'main'
  cached = { key: '', map: null }
}

// Add an agent, or update the fields given; undefined fields are left alone
function upsert(id, fields) {
  const node = nodes.get(id) ?? { id, kind: 'agent', status: 'pending', calls: 0 }
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) node[key] = value
  nodes.set(id, node)
  return node
}

// Take the engine's roster as the truth for parents and statuses
async function refreshRoster($) {
  try {
    for (const agent of await $.agent.list()) {
      upsert(agent.id, {
        parentId: agent.parentId ?? 'main',
        name: agent.name,
        type: agent.type,
        description: agent.description,
        status: agent.status,
        teammateId: agent.teammateId,
        spawnedBy: agent.spawnedBy,
      })
    }
  } catch {
    // Nothing to list, as in a test or a run with no session yet
  }
  $.ui.invalidate('ui.render')
}

function startPolling($) {
  if (!poll) poll = $.clock.every(POLL_MS, () => refreshRoster($))
}

function stopPolling() {
  poll?.cancel()
  poll = null
}

// The node a SendMessage address names: an agent's id, its name, or its
// teammate address. Anything else, such as another session, gets a node of its own.
function resolveAddress(to) {
  for (const node of nodes.values()) {
    if (node.id === to || node.name === to || node.teammateId === to) return node.id
    if (node.teammateId && node.teammateId.split('@')[0] === to) return node.id
  }
  if (to === 'main' || to === 'team-lead') return 'main'
  const id = 'ext:' + to
  if (!nodes.has(id)) nodes.set(id, { id, kind: 'external', status: 'external', label: to, calls: 0 })
  return id
}

function recordMessage(from, to, text) {
  const target = resolveAddress(to)
  if (target === from) return
  const key = from + '>' + target
  const entry = messages.get(key) ?? { from, to: target, count: 0 }
  entry.count += 1
  entry.last = String(text ?? '').replace(/\s+/g, ' ').trim()
  entry.seq = ++messageSeq
  messages.set(key, entry)
}

function labelOf(node) {
  if (node.kind === 'main') return 'main'
  if (node.kind === 'external') return node.label
  return node.name || node.type || 'agent'
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's')
}

function duration(node, now) {
  if (!node.startedAt) return ''
  const seconds = Math.max(0, Math.round(((node.endedAt ?? now) - node.startedAt) / 1000))
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}

// What a box shows: the status glyph and label, then one line of detail
function toDisplay(node) {
  let detail
  if (node.kind === 'main') detail = plural(node.calls, 'call')
  else if (node.kind === 'external') detail = 'another session'
  else if (node.status === 'running' && node.current) detail = '↻ ' + node.current
  else detail = [node.calls ? plural(node.calls, 'call') : '', shortModel(node.model)].filter(Boolean).join(' · ') || node.type || ''
  return { id: node.id, parentId: node.parentId, status: node.status, label: labelOf(node), detail }
}

// With finished agents hidden, keep one only while something under it still runs
function visibleNodes() {
  const all = [...nodes.values()]
  if (!hideFinished) return all
  const keep = new Set()
  for (const node of all) {
    if (node.kind === 'agent' && FINISHED.includes(node.status)) continue
    let current = node
    while (current && !keep.has(current.id)) {
      keep.add(current.id)
      current = nodes.get(current.parentId)
    }
  }
  return all.filter((node) => keep.has(node.id))
}

// One line per pair of nodes, with arrows for the directions messages went
function messagePairs(shown) {
  const ids = new Set(shown.map((n) => n.id))
  const pairs = new Map()
  for (const m of messages.values()) {
    if (!ids.has(m.from) || !ids.has(m.to)) continue
    const [a, b] = m.from < m.to ? [m.from, m.to] : [m.to, m.from]
    const pair = pairs.get(a + '|' + b) ?? { a, b, toA: false, toB: false, count: 0 }
    if (m.from === a) pair.toB = true
    else pair.toA = true
    pair.count += m.count
    pairs.set(a + '|' + b, pair)
  }
  return [...pairs.values()]
}

// Lay out and route only when the agents, their links or the room change
function mapFor(display, pairs, maxCols, prefer) {
  const key = JSON.stringify([
    orient, maxCols, prefer,
    display.map((n) => [n.id, n.parentId]),
    pairs.map((p) => [p.a, p.b, p.toA, p.toB]),
  ])
  if (cached.key !== key) {
    cached = { key, map: chooseMap(display, pairs, { maxCols, prefer, force: orient === 'auto' ? undefined : orient }) }
  }
  return cached.map
}

// The lines under the map about the selected node
function details(node, now) {
  if (!node) return []
  const agents = [...nodes.values()].filter((n) => n.kind === 'agent')
  const sent = [...messages.values()].filter((m) => m.from === node.id).reduce((n, m) => n + m.count, 0)
  const received = [...messages.values()].filter((m) => m.to === node.id).reduce((n, m) => n + m.count, 0)
  const traffic = sent || received ? plural(sent, 'message') + ' sent · ' + received + ' received' : ''
  if (node.kind === 'main') {
    const running = agents.filter((n) => n.status === 'running').length
    return ['◆ main conversation · ' + plural(node.calls, 'tool call'), plural(agents.length, 'agent') + ' · ' + running + ' running', traffic]
  }
  if (node.kind === 'external') return ['◇ ' + node.label + ' · another session or an address not in this map', traffic]
  const parent = nodes.get(node.parentId)
  const kind = [
    node.type !== labelOf(node) ? node.type : '',
    node.teammateId ? 'teammate ' + node.teammateId : '',
    node.background ? 'background' : '',
    node.fork ? 'fork' : '',
  ]
  const facts = [
    'parent ' + (parent ? labelOf(parent) : node.parentId ?? 'main'),
    shortModel(node.model),
    plural(node.calls, 'tool call'),
    node.current ? 'now ' + node.current : '',
    node.spawnedBy ? 'started by ' + node.spawnedBy : '',
  ]
  const time = duration(node, now)
  return [
    [statusOf(node.status).glyph + ' ' + labelOf(node), node.status + (time ? ' ' + time : ''), ...kind].filter(Boolean).join(' · '),
    node.description ? '"' + node.description + '"' : '',
    facts.filter(Boolean).join(' · '),
    traffic,
  ]
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await refreshRoster($)
    // After a reload the pane can still be open, with its timer gone
    try {
      if ((await $.ui.panes()).some((pane) => pane.id === PANE)) startPolling($)
    } catch {
      // No interface to ask, as in a claude -p run
    }
    // Registered last: a taken name throws, which would skip the rest
    await $.command.register({ name: 'agent-map', description: "Show this session's agents as a node map", immediate: true })
    return next(e)
  })

  // /clear and /resume start another conversation, with agents of its own
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') reset()
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const id = result.agentId ?? e.resume?.agentId
    if (!id || result.deny) return result
    upsert(id, {
      parentId: e.parentAgentId ?? 'main',
      name: e.name,
      type: e.subagentType,
      description: e.description,
      model: result.model,
      background: e.background || undefined,
      fork: e.fork || undefined,
      teammateId: result.teammateId,
      status: 'running',
      startedAt: await $.clock.now(),
      endedAt: null,
    })
    $.ui.invalidate('ui.render')
    return result
  })

  // Count each loop's tool calls, and show the one an agent is running now
  on('tool.call', async ($, e, next) => {
    const node = nodes.get(e.agentId ?? 'main')
    if (node) {
      node.calls += 1
      node.current = e.tool
      $.ui.invalidate('ui.render')
    }
    const result = await next(e)
    if (node && node.current === e.tool) node.current = undefined
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId || !nodes.has(e.agentId)) return next(e)
    await refreshRoster($)
    const node = nodes.get(e.agentId)
    node.endedAt = await $.clock.now()
    node.current = undefined
    // The roster can lag behind the turn that just ended
    if (node.status === 'running') {
      if (e.reason === 'error') node.status = 'failed'
      else if (e.isAborted) node.status = 'killed'
      else node.status = node.teammateId ? 'idle' : 'completed'
    }
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Every SendMessage, from the main conversation or from any agent
  on('session.send', async ($, e, next) => {
    const result = await next(e)
    if (result.isDelivered) {
      recordMessage(e.agentId ?? 'main', e.to, e.text)
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('command.run', { command: 'agent-map' }, async ($) => {
    await refreshRoster($)
    await $.ui.open({ id: PANE, title: 'Agent map', focus: true, closeOnEscape: true })
    startPolling($)
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) stopPolling()
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button, Raster, Svg } = $.ui.resolve(e)
    const now = await $.clock.now()
    const shown = visibleNodes()
    if (!shown.some((n) => n.id === selectedId)) selectedId = 'main'
    const display = shown.map(toDisplay)
    const pairs = messagePairs(shown)
    const maxCols = Math.max(24, e.props.bodyColumns ?? 80)
    const prefer = e.props.placement === 'dock' ? 'right' : 'down'
    const map = mapFor(display, pairs, maxCols, prefer)

    // The terminal draws a Raster, Desktop and VS Code an Svg, and anything
    // else, or a map too big for either, the outline as text
    let picture
    const tooBig = map.cols > MAX_RASTER.cols || map.rows > MAX_RASTER.rows
    if (e.surface === 'terminal' && Raster && !tooBig) {
      const canvas = paintCanvas(map, display, selectedId)
      picture = Raster({ key: 'map', columns: map.cols, rows: map.rows, cells: canvasToRaster(canvas) })
    } else if (Svg && e.surface !== 'terminal') {
      const source = mapToSvg(map, display, selectedId)
      if (source.length <= MAX_SVG_CHARS) picture = Svg({ source, alt: outline(display, pairs) })
    }
    if (!picture) {
      const lines = tooBig ? outline(display, pairs).split('\n') : canvasToLines(paintCanvas(map, display, selectedId))
      picture = Box({ flexDirection: 'column', children: lines.map((line) => Text({ wrap: 'truncate-end', children: [line || ' '] })) })
    }

    const ids = shown.map((n) => n.id)
    const select = (step) => {
      const at = ids.indexOf(selectedId)
      selectedId = ids[(at + step + ids.length) % ids.length]
      $.ui.invalidate('ui.render')
    }
    const recent = [...messages.values()]
      .filter((m) => ids.includes(m.from) && ids.includes(m.to))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, 4)
      .map((m) => {
        const from = labelOf(nodes.get(m.from))
        const to = labelOf(nodes.get(m.to))
        return Text({ wrap: 'truncate-end', children: [from + ' ╌► ' + to + ' ×' + m.count + '  "' + fit(m.last, 60) + '"'] })
      })
    const agentCount = shown.filter((n) => n.kind === 'agent').length

    return Box({
      flexDirection: 'column',
      children: [
        picture,
        Text({ dimColor: true, wrap: 'truncate-end', children: ['● running  ◌ idle  ✓ done  ✗ failed   ─ started   ╌► messaged'] }),
        ...(agentCount === 0 ? [Text({ dimColor: true, children: ['No agents yet. They appear here as Claude starts them.'] })] : []),
        Text({ children: [' '] }),
        ...details(nodes.get(selectedId), now)
          .filter(Boolean)
          .map((line, i) => Text({ wrap: 'truncate-end', dimColor: i > 0, children: [line] })),
        ...(recent.length ? [Text({ children: [' '] }), ...recent] : []),
        Text({ children: [' '] }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({ key: 'prev', label: 'Previous', hotkey: 'p', plain: true, onPress: () => select(-1) }),
            Button({ key: 'next', label: 'Next', hotkey: 'n', plain: true, onPress: () => select(1) }),
            Button({
              key: 'finished',
              label: hideFinished ? 'Show finished' : 'Hide finished',
              hotkey: 'h',
              plain: true,
              onPress: () => {
                hideFinished = !hideFinished
                $.ui.invalidate('ui.render')
              },
            }),
            Button({
              key: 'layout',
              label: 'Layout: ' + orient,
              hotkey: 'l',
              plain: true,
              onPress: () => {
                orient = { auto: 'down', down: 'right', right: 'auto' }[orient]
                $.ui.invalidate('ui.render')
              },
            }),
          ],
        }),
      ],
    })
  })
}
