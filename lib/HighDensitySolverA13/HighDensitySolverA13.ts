import { WasmSearchKernel } from "./search/WasmSearchKernel"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { getConnectionPortPointPairs } from "../getConnectionPortPointPairs"
import {
  findRouteGeometryViolations,
  type RouteGeometryViolation,
} from "../routeGeometryValidation"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../types"

type Point = { x: number; y: number; z: number }
type Connection = { start: PortPoint; end: PortPoint; root: string }
type Routed = {
  output: HighDensityIntraNodeRoute
  clearanceOutput: HighDensityIntraNodeRoute
  traceFootprint: number[]
  traceFootprintSet: Set<number>
  viaFootprint: number[]
  viaFootprintSet: Set<number>
  cells: number[]
  viaCells: number[]
}
/** Reusable structure-of-arrays heap. Tie comparisons intentionally match the
 * original heap so the optimization does not change route ordering. */
class Heap {
  private indices = new Int32Array(1024)
  private costs = new Float64Array(1024)
  private priorities = new Float64Array(1024)
  size = 0
  index = 0
  g = 0
  clear() {
    this.size = 0
  }
  push(index: number, g: number, f: number) {
    if (this.size === this.indices.length) {
      const indices = new Int32Array(this.size * 2)
      const costs = new Float64Array(this.size * 2)
      const priorities = new Float64Array(this.size * 2)
      indices.set(this.indices)
      costs.set(this.costs)
      priorities.set(this.priorities)
      this.indices = indices
      this.costs = costs
      this.priorities = priorities
    }
    let i = this.size++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.priorities[parent]! <= f) break
      this.indices[i] = this.indices[parent]!
      this.costs[i] = this.costs[parent]!
      this.priorities[i] = this.priorities[parent]!
      i = parent
    }
    this.indices[i] = index
    this.costs[i] = g
    this.priorities[i] = f
  }
  pop() {
    this.index = this.indices[0]!
    this.g = this.costs[0]!
    const last = --this.size
    if (!last) return
    const index = this.indices[last]!,
      g = this.costs[last]!,
      f = this.priorities[last]!
    let i = 0
    while (i * 2 + 1 < last) {
      let child = i * 2 + 1
      if (
        child + 1 < last &&
        this.priorities[child + 1]! < this.priorities[child]!
      )
        child++
      if (f <= this.priorities[child]!) break
      this.indices[i] = this.indices[child]!
      this.costs[i] = this.costs[child]!
      this.priorities[i] = this.priorities[child]!
      i = child
    }
    this.indices[i] = index
    this.costs[i] = g
    this.priorities[i] = f
  }
}

export interface HighDensitySolverA13Props {
  nodeWithPortPoints: NodeWithPortPoints
  /** Auto uses WebAssembly when permitted, otherwise the identical JS search. */
  searchBackend?: "auto" | "javascript" | "wasm"
  cellSizeMm?: number
  traceThickness?: number
  traceMargin?: number
  viaDiameter?: number
  viaMinDistFromBorder?: number
  stepMultiplier?: number
  maxRounds?: number
  maxSearchIterations?: number
  hyperParameters?: { shuffleSeed?: number; greedyMultiplier?: number }
}

/** Pathfinder-style negotiated congestion at fixed physical node dimensions.
 * Routes remain provisional until independent geometry validation succeeds.
 */
export class HighDensitySolverA13 extends BaseSolver {
  readonly nodeWithPortPoints: NodeWithPortPoints
  readonly props: HighDensitySolverA13Props
  readonly traceThickness: number
  readonly traceMargin: number
  readonly viaDiameter: number
  readonly hyperParameters: { shuffleSeed: number; greedyMultiplier: number }
  phase: "routing" | "negotiating" | "complete" = "routing"
  round = 0
  routingIterations = 0
  routedCount = 0
  conflictCount = 0
  rerouteCount = 0
  bestConflictCount = Infinity
  broadNegotiations = 0
  private stagnantRounds = 0
  violations: RouteGeometryViolation[] = []
  connections: Connection[] = []
  activeConnectionIndex = -1
  rows = 0
  cols = 0
  private plane = 0
  private layers: number[] = []
  private pitchX = 0
  private pitchY = 0
  private left = 0
  private bottom = 0
  private routes = new Map<number, Routed>()
  // Routed records are replaced, never edited, so weak keys invalidate pairs
  // automatically and do not retain obsolete search rounds.
  private pairCache = new WeakMap<
    Routed,
    WeakMap<
      Routed,
      {
        cells: number[]
        vias: number[]
        violations: RouteGeometryViolation[]
      }
    >
  >()
  private queue: number[] = []
  private traceCost!: Uint16Array
  private viaCost!: Uint16Array
  private fixed!: Uint8Array
  private fixedVia!: Uint8Array
  private history!: Float64Array
  private viaHistory!: Float64Array
  private distance!: Float64Array
  private parent!: Int32Array
  private heap = new Heap()
  private searchKernel?: WasmSearchKernel
  private heuristicCost!: Float64Array
  private heuristicCache = new Map<number, Float64Array>()
  private viaAllowed!: Uint8Array
  private goal = 0
  private presentCost = 0.5
  private randomState = 1

  constructor(props: HighDensitySolverA13Props) {
    super()
    this.props = props
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.traceThickness = props.traceThickness ?? 0.1
    this.traceMargin = props.traceMargin ?? 0.1
    this.viaDiameter = props.viaDiameter ?? 0.3
    this.hyperParameters = {
      shuffleSeed: 0,
      greedyMultiplier: 1.1,
      ...props.hyperParameters,
    }
    for (const value of [
      props.cellSizeMm ?? 0.1,
      this.traceThickness,
      this.viaDiameter,
      props.stepMultiplier ?? 1000,
      props.maxRounds ?? 200,
      props.maxSearchIterations ?? 50_000_000,
      this.hyperParameters.greedyMultiplier,
    ]) {
      if (!Number.isFinite(value) || value <= 0)
        throw new Error(
          "A13 dimensions and search limits must be positive and finite",
        )
    }
    if (!Number.isFinite(this.traceMargin) || this.traceMargin < 0)
      throw new Error("traceMargin must be nonnegative")
    this.MAX_ITERATIONS = 100_000_000
  }
  override getSolverName() {
    return "HighDensitySolverA13"
  }
  override getConstructorParams(): [HighDensitySolverA13Props] {
    return [{ ...this.props }]
  }
  override _setup() {
    const n = this.nodeWithPortPoints
    if (n.width <= 0 || n.height <= 0)
      throw new Error("Node dimensions must be positive")
    this.cols = Math.ceil(n.width / (this.props.cellSizeMm ?? 0.1)) + 1
    this.rows = Math.ceil(n.height / (this.props.cellSizeMm ?? 0.1)) + 1
    this.pitchX = n.width / (this.cols - 1)
    this.pitchY = n.height / (this.rows - 1)
    this.left = n.center.x - n.width / 2
    this.bottom = n.center.y - n.height / 2
    this.layers =
      n.availableZ ??
      [...new Set(n.portPoints.map((p) => p.z))].sort((a, b) => a - b)
    this.plane = this.rows * this.cols
    const states = this.plane * this.layers.length
    if (states > 2_000_000)
      throw new Error("A13 grid exceeds two million states")
    this.traceCost = new Uint16Array(states)
    this.viaCost = new Uint16Array(this.plane)
    this.fixed = new Uint8Array(states)
    this.fixedVia = new Uint8Array(this.plane)
    this.history = new Float64Array(states)
    this.viaHistory = new Float64Array(this.plane)
    this.heuristicCost = new Float64Array(states)
    this.viaAllowed = new Uint8Array(this.plane)
    const inset = Math.max(
      this.viaDiameter / 2,
      this.props.viaMinDistFromBorder ?? this.viaDiameter / 2,
    )
    for (let xy = 0; xy < this.plane; xy++) {
      const p = this.point(xy)
      if (
        p.x - this.left >= inset &&
        this.left + n.width - p.x >= inset &&
        p.y - this.bottom >= inset &&
        this.bottom + n.height - p.y >= inset
      )
        this.viaAllowed[xy] = 1
    }
    this.distance = new Float64Array(states)
    this.parent = new Int32Array(states)
    if (this.props.searchBackend !== "javascript") {
      try {
        this.searchKernel = new WasmSearchKernel(
          this.cols,
          this.rows,
          this.layers.length,
          this.pitchX,
          this.pitchY,
        )
      } catch (error) {
        // Environments whose CSP disables WASM can still use A13 synchronously.
        if (this.props.searchBackend === "wasm") throw error
      }
    }
    const grouped = new Map<string, PortPoint[]>()
    for (const p of n.portPoints) {
      if (!this.layers.includes(p.z))
        throw new Error("Port is on an unavailable layer")
      const group = grouped.get(p.connectionName) ?? []
      group.push(p)
      grouped.set(p.connectionName, group)
    }
    for (const group of grouped.values())
      for (const [start, end] of getConnectionPortPointPairs(group)) {
        this.connections.push({
          start,
          end,
          root:
            start.rootConnectionName ??
            start.connectionName.replace(/_mst\d+$/, ""),
        })
      }
    this.randomState = (this.hyperParameters.shuffleSeed + 1) >>> 0
    this.queue = this.shuffle(this.connections.map((_, i) => i))
  }
  private shuffle(ids: number[]) {
    for (let i = ids.length - 1; i > 0; i--) {
      this.randomState =
        (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0
      const j = this.randomState % (i + 1)
      ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    }
    return ids
  }
  private index(p: Point) {
    const col = Math.max(
      0,
      Math.min(this.cols - 1, Math.round((p.x - this.left) / this.pitchX)),
    )
    const row = Math.max(
      0,
      Math.min(this.rows - 1, Math.round((p.y - this.bottom) / this.pitchY)),
    )
    return this.layers.indexOf(p.z) * this.plane + row * this.cols + col
  }
  private point(index: number): Point {
    const xy = index % this.plane
    return {
      x: this.left + (xy % this.cols) * this.pitchX,
      y: this.bottom + Math.floor(xy / this.cols) * this.pitchY,
      z: this.layers[Math.floor(index / this.plane)]!,
    }
  }
  /** Rasterize an exact physical capsule, including the off-grid terminal leads. */
  private capsule(
    a: { x: number; y: number },
    b: { x: number; y: number },
    radius: number,
    visit: (xy: number) => void,
  ) {
    const c0 = Math.max(
      0,
      Math.floor((Math.min(a.x, b.x) - radius - this.left) / this.pitchX),
    )
    const c1 = Math.min(
      this.cols - 1,
      Math.ceil((Math.max(a.x, b.x) + radius - this.left) / this.pitchX),
    )
    const r0 = Math.max(
      0,
      Math.floor((Math.min(a.y, b.y) - radius - this.bottom) / this.pitchY),
    )
    const r1 = Math.min(
      this.rows - 1,
      Math.ceil((Math.max(a.y, b.y) + radius - this.bottom) / this.pitchY),
    )
    const dx = b.x - a.x,
      dy = b.y - a.y,
      len = dx * dx + dy * dy
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = this.left + c * this.pitchX,
          y = this.bottom + r * this.pitchY
        const t = len
          ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len))
          : 0
        if (
          (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2 <
          radius * radius - 1e-12
        )
          visit(r * this.cols + c)
      }
  }
  private prepareSearch(id: number) {
    this.activeConnectionIndex = id
    const conn = this.connections[id]!
    this.traceCost.fill(0)
    this.viaCost.fill(0)
    this.fixed.fill(0)
    this.fixedVia.fill(0)
    // No route is deleted. Exclude just this net when searching its replacement.
    for (const [other, route] of this.routes) {
      if (this.connections[other]!.root === conn.root) continue
      for (const i of route.traceFootprint) this.traceCost[i]!++
      for (const i of route.viaFootprint) this.viaCost[i]!++
    }
    for (const other of this.connections) {
      if (other.root === conn.root) continue
      for (const p of [other.start, other.end]) {
        this.capsule(p, p, this.traceThickness + this.traceMargin, (xy) => {
          this.fixed[this.layers.indexOf(p.z) * this.plane + xy] = 1
        })
        this.capsule(
          p,
          p,
          (this.traceThickness + this.viaDiameter) / 2 + this.traceMargin,
          (xy) => {
            this.fixedVia[xy] = 1
          },
        )
      }
    }
    if (!this.searchKernel) {
      this.distance.fill(Infinity)
      this.parent.fill(-1)
      this.heap.clear()
    }
    const start = this.index(conn.start)
    this.goal = this.index(conn.end)
    const goal = this.point(this.goal)
    const cached = this.heuristicCache.get(this.goal)
    if (cached) this.heuristicCost = cached
    else {
      this.heuristicCost = new Float64Array(this.distance.length)
      // Cache the identical physical-coordinate heuristic once per search rather
      // than allocating two points for every edge relaxation.
      for (let z = 0; z < this.layers.length; z++)
        for (let row = 0; row < this.rows; row++) {
          const dy = Math.abs(this.bottom + row * this.pitchY - goal.y)
          for (let col = 0; col < this.cols; col++) {
            this.heuristicCost[z * this.plane + row * this.cols + col] =
              (Math.abs(this.left + col * this.pitchX - goal.x) +
                dy +
                (this.layers[z] === goal.z ? 0 : 0.8)) *
              this.hyperParameters.greedyMultiplier
          }
        }
      // Bound retained heuristics to 8 MiB, even for large/many-terminal nodes.
      const capacity = Math.floor(
        (8 * 1024 * 1024) / this.heuristicCost.byteLength,
      )
      if (capacity > 0) {
        if (this.heuristicCache.size >= capacity)
          this.heuristicCache.delete(this.heuristicCache.keys().next().value!)
        this.heuristicCache.set(this.goal, this.heuristicCost)
      }
    }
    if (!this.searchKernel) {
      this.distance[start] = 0
      this.heap.push(start, 0, this.heuristic(start))
    }
    this.searchKernel?.begin(
      {
        traceCost: this.traceCost,
        viaCost: this.viaCost,
        fixed: this.fixed,
        fixedVia: this.fixedVia,
        history: this.history,
        viaHistory: this.viaHistory,
        heuristicCost: this.heuristicCost,
        viaAllowed: this.viaAllowed,
      },
      start,
      this.goal,
      this.presentCost,
    )
  }
  private heuristic(index: number) {
    return this.heuristicCost[index]!
  }

  override _step() {
    if (this.phase === "negotiating") {
      this.negotiate()
      return
    }
    if (this.activeConnectionIndex < 0) {
      const id = this.queue.shift()
      if (id === undefined) {
        this.phase = "negotiating"
        return
      }
      this.prepareSearch(id)
    }
    if (this.searchKernel) {
      const { status, expansions } = this.searchKernel.run(
        this.props.stepMultiplier ?? 1000,
        (this.props.maxSearchIterations ?? 50_000_000) - this.routingIterations,
      )
      this.routingIterations += expansions
      if (status === 1) {
        this.searchKernel.copyParents(this.parent)
        this.commit(this.goal)
      } else if (status === 2) {
        this.failed = true
        this.error = `No path between fixed terminals of ${this.connections[this.activeConnectionIndex]!.start.connectionName}`
      } else if (status === 3) {
        this.failed = true
        this.error = "A13 exhausted its search budget"
      }
      return
    }
    for (let step = 0; step < (this.props.stepMultiplier ?? 1000); step++) {
      if (
        this.routingIterations >= (this.props.maxSearchIterations ?? 50_000_000)
      ) {
        this.failed = true
        this.error = "A13 exhausted its search budget"
        return
      }
      if (!this.heap.size) {
        this.failed = true
        this.error = `No path between fixed terminals of ${this.connections[this.activeConnectionIndex]!.start.connectionName}`
        return
      }
      this.heap.pop()
      const currentIndex = this.heap.index,
        currentG = this.heap.g
      if (currentG !== this.distance[currentIndex]) continue
      this.routingIterations++
      if (currentIndex === this.goal) {
        this.commit(currentIndex)
        return
      }
      const xy = currentIndex % this.plane,
        col = xy % this.cols,
        row = Math.floor(xy / this.cols),
        z = Math.floor(currentIndex / this.plane)
      const visit = (next: number, base: number, via: boolean) => {
        const nxy = next % this.plane
        if (this.fixed[next] && next !== this.goal) return
        if (via && this.fixedVia[nxy]) return
        const congestion = via ? this.viaCost[nxy]! : this.traceCost[next]!
        const history = via ? this.viaHistory[nxy]! : this.history[next]!
        const g = currentG + base + this.presentCost * congestion + history
        if (g >= this.distance[next]!) return
        this.distance[next] = g
        this.parent[next] = currentIndex
        this.heap.push(next, g, g + this.heuristic(next))
      }
      if (col > 0)
        visit(currentIndex - 1, this.pitchX * (z % 2 ? 1.05 : 1), false)
      if (col + 1 < this.cols)
        visit(currentIndex + 1, this.pitchX * (z % 2 ? 1.05 : 1), false)
      if (row > 0)
        visit(currentIndex - this.cols, this.pitchY * (z % 2 ? 1 : 1.05), false)
      if (row + 1 < this.rows)
        visit(currentIndex + this.cols, this.pitchY * (z % 2 ? 1 : 1.05), false)
      if (this.viaAllowed[xy]) {
        for (let layer = 0; layer < this.layers.length; layer++)
          if (layer !== z) visit(layer * this.plane + xy, 0.8, true)
      }
    }
  }
  private commit(goal: number) {
    const id = this.activeConnectionIndex,
      conn = this.connections[id]!,
      cells: number[] = []
    for (let i = goal; i !== -1; i = this.parent[i]!) cells.push(i)
    cells.reverse()
    // Preserve exact terminals with explicit leads; never overwrite a via anchor.
    const points: Point[] = [
      { ...conn.start },
      ...cells.map((i) => this.point(i)),
      { ...conn.end },
    ]
    const compressed: Point[] = []
    for (const p of points) {
      const b = compressed.at(-1),
        a = compressed.at(-2)
      if (b && b.x === p.x && b.y === p.y && b.z === p.z) continue
      if (
        a &&
        b &&
        a.z === p.z &&
        b.z === p.z &&
        (b.x - a.x) * (p.y - b.y) === (b.y - a.y) * (p.x - b.x)
      )
        compressed.pop()
      compressed.push(p)
    }
    compressed[0] = { ...conn.start }
    compressed[compressed.length - 1] = { ...conn.end }
    const vias: { x: number; y: number }[] = [],
      viaCells: number[] = []
    for (let i = 1; i < cells.length; i++)
      if (
        Math.floor(cells[i]! / this.plane) !==
        Math.floor(cells[i - 1]! / this.plane)
      ) {
        const p = this.point(cells[i]!)
        vias.push({ x: p.x, y: p.y })
        viaCells.push(cells[i]! % this.plane)
      }
    const output: HighDensityIntraNodeRoute = {
      connectionName: conn.start.connectionName,
      rootConnectionName: conn.root,
      regionId: this.nodeWithPortPoints.capacityMeshNodeId,
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      route: compressed,
      vias,
    }
    const traces = new Set<number>(),
      viaSet = new Set<number>(),
      centerline = new Set<number>()
    for (let i = 1; i < compressed.length; i++) {
      const a = compressed[i - 1]!,
        b = compressed[i]!
      if (a.z !== b.z) continue
      this.capsule(a, b, 1e-5, (xy) =>
        centerline.add(this.layers.indexOf(a.z) * this.plane + xy),
      )
      this.capsule(a, b, this.traceThickness + this.traceMargin, (xy) =>
        traces.add(this.layers.indexOf(a.z) * this.plane + xy),
      )
      this.capsule(
        a,
        b,
        (this.traceThickness + this.viaDiameter) / 2 + this.traceMargin,
        (xy) => viaSet.add(xy),
      )
    }
    for (const p of vias) {
      this.capsule(
        p,
        p,
        (this.viaDiameter + this.traceThickness) / 2 + this.traceMargin,
        (xy) => {
          for (let z = 0; z < this.layers.length; z++)
            traces.add(z * this.plane + xy)
        },
      )
      this.capsule(p, p, this.viaDiameter + this.traceMargin, (xy) =>
        viaSet.add(xy),
      )
    }
    if (this.routes.has(id)) this.rerouteCount++
    this.routes.set(id, {
      output,
      clearanceOutput: {
        ...output,
        traceThickness: output.traceThickness + this.traceMargin,
        viaDiameter: output.viaDiameter + this.traceMargin,
      },
      traceFootprint: [...traces],
      traceFootprintSet: traces,
      viaFootprint: [...viaSet],
      viaFootprintSet: viaSet,
      cells: [...centerline],
      viaCells,
    })
    this.routedCount = this.routes.size
    this.activeConnectionIndex = -1
  }
  private getPair(a: Routed, b: Routed) {
    let row = this.pairCache.get(a)
    if (!row) {
      row = new WeakMap()
      this.pairCache.set(a, row)
    }
    let pair = row.get(b)
    if (!pair) {
      pair = {
        cells: [
          ...a.cells.filter((cell) => b.traceFootprintSet.has(cell)),
          ...b.cells.filter((cell) => a.traceFootprintSet.has(cell)),
        ],
        vias: [
          ...a.viaCells.filter((cell) => b.viaFootprintSet.has(cell)),
          ...b.viaCells.filter((cell) => a.viaFootprintSet.has(cell)),
        ],
        violations: findRouteGeometryViolations([
          a.clearanceOutput,
          b.clearanceOutput,
        ]),
      }
      row.set(b, pair)
    }
    return pair
  }
  private negotiate() {
    this.round++
    const conflicted = new Set<number>(),
      historyCells = new Set<number>(),
      historyVias = new Set<number>()
    // Replay grid conflicts in the original insertion order: it affects shuffle.
    for (const [id, route] of this.routes)
      for (const [other, obstacle] of this.routes) {
        if (
          other <= id ||
          this.connections[id]!.root === this.connections[other]!.root
        )
          continue
        const pair = this.getPair(route, obstacle)
        if (pair.cells.length || pair.vias.length) {
          conflicted.add(id)
          conflicted.add(other)
          for (const cell of pair.cells) historyCells.add(cell)
          for (const cell of pair.vias) historyVias.add(cell)
        }
      }
    const ordered = [...this.routes.entries()].sort(([a], [b]) => a - b)
    const intersections = new Map<number, RouteGeometryViolation[]>()
    for (const [, route] of ordered)
      for (const point of route.output.route)
        if (!intersections.has(point.z)) intersections.set(point.z, [])
    const clearances: RouteGeometryViolation[] = []
    for (let i = 0; i < ordered.length; i++)
      for (let j = i + 1; j < ordered.length; j++) {
        const [id, route] = ordered[i]!,
          [other, obstacle] = ordered[j]!
        if (this.connections[id]!.root === this.connections[other]!.root)
          continue
        for (const violation of this.getPair(route, obstacle).violations) {
          // The exact validator emits intersections by global layer, then pair;
          // clearance findings follow in pair order. A13 copper sizes are > 0,
          // so only the intersection prepass uses requiredDistance === 0.
          if (violation.requiredDistance === 0)
            intersections.get(violation.z!)!.push(violation)
          else clearances.push(violation)
        }
      }
    this.violations = [...intersections.values()].flat().concat(clearances)
    for (const violation of this.violations) {
      for (let id = 0; id < this.connections.length; id++)
        if (
          [violation.trace1, violation.trace2].includes(
            this.connections[id]!.start.connectionName,
          )
        )
          conflicted.add(id)
      for (const p of [violation.point, violation.point2])
        if (p) {
          const xy = this.index({ ...p, z: this.layers[0]! }) % this.plane
          historyVias.add(xy)
          if (violation.z !== null)
            historyCells.add(this.layers.indexOf(violation.z) * this.plane + xy)
        }
    }
    this.conflictCount = conflicted.size
    this.stagnantRounds =
      this.conflictCount < this.bestConflictCount ? 0 : this.stagnantRounds + 1
    this.bestConflictCount = Math.min(
      this.bestConflictCount,
      this.conflictCount,
    )
    this.stats = {
      round: this.round,
      conflictedRoutes: this.conflictCount,
      geometryViolations: this.violations.length,
      reroutes: this.rerouteCount,
      searchExpansions: this.routingIterations,
    }
    if (
      !this.violations.length &&
      this.routes.size === this.connections.length
    ) {
      this.solved = true
      this.stats.conflictedRoutes = 0
      this.conflictCount = 0
      this.bestConflictCount = 0
      this.phase = "complete"
      return
    }
    if (this.round >= (this.props.maxRounds ?? 200)) {
      this.failed = true
      this.error = `Negotiation exhausted ${this.round} rounds (${this.conflictCount} conflicted routes)`
      return
    }
    for (const cell of historyCells) this.history[cell]! += 0.15
    for (const cell of historyVias) this.viaHistory[cell]! += 0.15
    this.presentCost = Math.min(20, this.presentCost * 1.08)
    // A conflict-free neighbor can still occupy the escape corridor needed by
    // a stuck pair. Periodically let those neighbors negotiate too, without
    // removing their provisional paths or erasing congestion history.
    if (this.stagnantRounds >= 8) {
      this.queue = this.shuffle(this.connections.map((_, id) => id))
      this.presentCost = Math.max(0.5, this.presentCost / 2)
      this.stagnantRounds = 0
      this.broadNegotiations++
    } else this.queue = this.shuffle([...conflicted])
    this.phase = "routing"
  }
  override getOutput() {
    return [...this.routes.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, r]) => r.output)
  }
  override visualize(): GraphicsObject {
    const n = this.nodeWithPortPoints
    const graphics: GraphicsObject = {
      title: `A13 negotiated congestion · round ${this.round} · ${this.conflictCount} conflicted routes`,
      rects: [
        {
          center: n.center,
          width: n.width,
          height: n.height,
          stroke: "#475569",
          fill: "transparent",
        },
      ],
      points: n.portPoints.map((p) => ({
        ...p,
        color: p.z === 0 ? "red" : "blue",
        layer: `z${p.z}`,
        label: p.connectionName,
      })),
      lines: [],
      circles: [],
    }
    for (const route of this.getOutput()) {
      for (let i = 1; i < route.route.length; i++) {
        const a = route.route[i - 1]!,
          b = route.route[i]!
        if (a.z === b.z)
          graphics.lines!.push({
            points: [a, b],
            strokeColor: a.z === 0 ? "#ef4444" : "#3b82f6",
            strokeWidth: this.traceThickness,
            layer: `z${a.z}`,
          })
      }
      for (const p of route.vias)
        graphics.circles!.push({
          center: p,
          radius: this.viaDiameter / 2,
          fill: "#cbd5e1",
          stroke: "#334155",
          layer: `z${this.layers.join(",")}`,
        })
    }
    for (const v of this.violations.slice(0, 50))
      if (v.point)
        graphics.circles!.push({
          center: v.point,
          radius: 0.2,
          stroke: "#f59e0b",
          fill: "transparent",
        })
    return graphics
  }
}
