import { BaseSolver } from "@tscircuit/solver-utils"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../types"
import {
  type AffineTransform,
  computeGridToAffineTransform,
  applyAffineTransformToPoint,
} from "../gridToAffineTransform"

// --- Interned connection ID ---
type ConnId = number

// --- Persistent ripped-trace linked list ---
interface RippedNode {
  id: ConnId
  prev: RippedNode | null
}

function rippedContains(r: RippedNode | null, id: ConnId): boolean {
  for (let cur = r; cur; cur = cur.prev) if (cur.id === id) return true
  return false
}

// --- A* search node (stored in a pool) ---
interface SearchNode {
  z: number
  row: number
  col: number
  g: number
  f: number
  parentIdx: number // -1 = root
  ripped: RippedNode | null
}

// --- Connection segment ---
interface ConnectionSeg {
  connId: ConnId
  startZ: number
  startRow: number
  startCol: number
  endZ: number
  endRow: number
  endCol: number
}

// --- Internal solved route (cell-based) ---
interface SolvedRouteInternal {
  connId: ConnId
  cells: Array<{ z: number; row: number; col: number }>
  viaCells: Array<{ row: number; col: number }>
}

// --- Min-heap for A* open set ---
class MinHeap {
  private f: number[] = []
  private seq: number[] = []
  private id: number[] = []
  private n = 0

  push(f: number, seq: number, id: number) {
    let i = this.n++
    this.f[i] = f
    this.seq[i] = seq
    this.id[i] = id
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.less(p, i)) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const out = this.id[0]!
    this.n--
    if (this.n > 0) {
      this.f[0] = this.f[this.n]!
      this.seq[0] = this.seq[this.n]!
      this.id[0] = this.id[this.n]!
      this.siftDown(0)
    }
    return out
  }

  get size() {
    return this.n
  }

  clear() {
    this.n = 0
  }

  private siftDown(i: number) {
    while (true) {
      const l = i * 2 + 1
      const r = l + 1
      if (l >= this.n) return
      let m = l
      if (r < this.n && !this.less(l, r)) m = r
      if (this.less(i, m)) return
      this.swap(i, m)
      i = m
    }
  }

  private less(i: number, j: number) {
    const fi = this.f[i]!
    const fj = this.f[j]!
    if (fi !== fj) return fi < fj
    return this.seq[i]! < this.seq[j]!
  }

  private swap(i: number, j: number) {
    const tmpF = this.f[i]!
    this.f[i] = this.f[j]!
    this.f[j] = tmpF
    const tmpS = this.seq[i]!
    this.seq[i] = this.seq[j]!
    this.seq[j] = tmpS
    const tmpI = this.id[i]!
    this.id[i] = this.id[j]!
    this.id[j] = tmpI
  }
}

// --- Types ---
interface HyperParameters {
  shuffleSeed: number
  ripCost: number
  ripTracePenalty: number
  ripViaPenalty: number
  viaBaseCost: number
}

interface HighDensitySolverA01Props {
  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm: number
  viaDiameter: number
  traceThickness?: number
  traceMargin?: number
  viaMinDistFromBorder?: number
  showPenaltyMap?: boolean
  showUsedCellMap?: boolean
  hyperParameters?: Partial<HyperParameters>
  initialPenaltyFn?: (params: {
    x: number
    y: number
    px: number
    py: number
    row: number
    col: number
  }) => number
}

// Static direction offsets for 8-connected neighbor expansion
const DIRS_DR = [-1, -1, -1, 0, 0, 1, 1, 1] as const
const DIRS_DC = [-1, 0, 1, -1, 1, -1, 0, 1] as const

export class HighDensitySolverA01 extends BaseSolver {
  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm: number
  viaDiameter: number
  traceThickness: number
  traceMargin: number
  viaMinDistFromBorder: number
  showPenaltyMap: boolean
  showUsedCellMap: boolean
  hyperParameters: HyperParameters
  initialPenaltyFn?: HighDensitySolverA01Props["initialPenaltyFn"]

  // Grid dimensions
  rows!: number
  cols!: number
  layers!: number
  gridOrigin!: { x: number; y: number }
  gridToBoundsTransform!: AffineTransform

  // Z-layer mapping
  availableZ!: number[]
  zToLayer!: Map<number, number>
  layerToZ!: Map<number, number>

  // --- Interned connections ---
  private connNameToId!: Map<string, ConnId>
  private connIdToName!: string[]

  // --- Flat arrays ---
  private planeSize!: number // rows * cols
  private usedCellsFlat!: Int32Array // layers * planeSize; -1 = empty
  private penalty2d!: Float64Array // planeSize
  private visitedStamp!: Uint32Array // layers * planeSize
  private stamp = 0

  // --- Precomputed via footprint offsets ---
  private viaOffsetsDr!: Int32Array
  private viaOffsetsDc!: Int32Array
  private viaOffsetsLen!: number

  // --- Per-connection used-cell tracking ---
  private usedIndicesByConn!: number[][] // connId -> [flatCellIdx, ...]

  // --- Connection queues ---
  private unsolvedSegs!: ConnectionSeg[]
  private solvedRoutes!: Map<ConnId, SolvedRouteInternal>

  // --- A* state ---
  private activeConnSeg: ConnectionSeg | null = null
  private activeConnId: ConnId = -1
  private nodePool!: SearchNode[]
  private heap!: MinHeap
  private seqCounter = 0

  // --- Reusable scratch for via occupant scan ---
  private _viaOccs: ConnId[] = []

  // --- Reusable scratch for computeMoveCostAndRips ---
  private _moveCost = 0
  private _moveRipped: RippedNode | null = null

  // --- Test/debug compatibility getters ---
  get unsolvedConnections() {
    return this.unsolvedSegs
  }
  get solvedConnectionsMap() {
    return this.solvedRoutes
  }
  get activeConnection() {
    if (!this.activeConnSeg) return null
    const s = this.activeConnSeg
    return {
      connectionName: this.connIdToName[s.connId] ?? "",
      start: { row: s.startRow, col: s.startCol, z: s.startZ, x: 0, y: 0 },
      end: { row: s.endRow, col: s.endCol, z: s.endZ, x: 0, y: 0 },
    }
  }
  get openSet() {
    return { length: this.heap?.size ?? 0 }
  }

  constructor(props: HighDensitySolverA01Props) {
    super()
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.cellSizeMm = props.cellSizeMm
    this.viaDiameter = props.viaDiameter
    this.traceThickness = props.traceThickness ?? 0.1
    this.traceMargin = props.traceMargin ?? 0.15
    this.viaMinDistFromBorder = props.viaMinDistFromBorder ?? 1
    this.showPenaltyMap = props.showPenaltyMap ?? false
    this.showUsedCellMap = props.showUsedCellMap ?? false
    this.hyperParameters = {
      shuffleSeed: 0,
      ripCost: 10,
      ripTracePenalty: 0.5,
      ripViaPenalty: 0.75,
      viaBaseCost: 0.1,
      ...props.hyperParameters,
    }
    this.MAX_ITERATIONS = 1e6
    this.initialPenaltyFn = props.initialPenaltyFn
  }

  override _setup(): void {
    const { nodeWithPortPoints, cellSizeMm } = this
    const { width, height, center } = nodeWithPortPoints

    // Z layers
    this.availableZ =
      nodeWithPortPoints.availableZ ??
      [...new Set(nodeWithPortPoints.portPoints.map((pp) => pp.z))].sort(
        (a, b) => a - b,
      )
    this.zToLayer = new Map()
    this.layerToZ = new Map()
    for (let i = 0; i < this.availableZ.length; i++) {
      const z = this.availableZ[i]!
      this.zToLayer.set(z, i)
      this.layerToZ.set(i, z)
    }

    this.rows = Math.floor(height / cellSizeMm)
    this.cols = Math.floor(width / cellSizeMm)
    this.layers = this.availableZ.length
    this.planeSize = this.rows * this.cols
    const totalCells = this.layers * this.planeSize
    this.gridOrigin = {
      x: center.x - width / 2,
      y: center.y - height / 2,
    }
    this.gridToBoundsTransform = computeGridToAffineTransform({
      originX: this.gridOrigin.x,
      originY: this.gridOrigin.y,
      rows: this.rows,
      cols: this.cols,
      cellSizeMm,
      width,
      height,
    })

    // Intern connections
    this.connNameToId = new Map()
    this.connIdToName = []

    // Flat penalty map (Float64Array is zero-initialized)
    this.penalty2d = new Float64Array(this.planeSize)
    if (this.initialPenaltyFn) {
      for (let row = 0; row < this.rows; row++) {
        const rowBase = row * this.cols
        for (let col = 0; col < this.cols; col++) {
          const x = this.gridOrigin.x + (col + 0.5) * cellSizeMm
          const y = this.gridOrigin.y + (row + 0.5) * cellSizeMm
          const px = (col + 0.5) / this.cols
          const py = (row + 0.5) / this.rows
          this.penalty2d[rowBase + col] = this.initialPenaltyFn({
            x,
            y,
            px,
            py,
            row,
            col,
          })
        }
      }
    }

    // Flat used cells (Int32Array, -1 = empty)
    this.usedCellsFlat = new Int32Array(totalCells).fill(-1)

    // Visited stamp array (Uint32Array is zero-initialized)
    this.visitedStamp = new Uint32Array(totalCells)
    this.stamp = 0

    // Precompute via footprint offsets
    const viaRadiusCells = Math.ceil(this.viaDiameter / 2 / cellSizeMm)
    const r2 = viaRadiusCells * viaRadiusCells
    const drList: number[] = []
    const dcList: number[] = []
    for (let dr = -viaRadiusCells; dr <= viaRadiusCells; dr++) {
      for (let dc = -viaRadiusCells; dc <= viaRadiusCells; dc++) {
        if (dr * dr + dc * dc <= r2) {
          drList.push(dr)
          dcList.push(dc)
        }
      }
    }
    this.viaOffsetsLen = drList.length
    this.viaOffsetsDr = new Int32Array(drList)
    this.viaOffsetsDc = new Int32Array(dcList)

    // Build and shuffle connections
    this.unsolvedSegs = this.buildConnectionSegs()
    this.solvedRoutes = new Map()
    this.usedIndicesByConn = []
    this.shuffleConnections()

    // A* state
    this.activeConnSeg = null
    this.activeConnId = -1
    this.nodePool = []
    this.heap = new MinHeap()
    this.seqCounter = 0
  }

  override _step(): void {
    // 1. If no active connection, dequeue next
    if (!this.activeConnSeg) {
      if (this.unsolvedSegs.length === 0) {
        this.solved = true
        return
      }
      const next = this.unsolvedSegs.shift()!
      this.activeConnSeg = next
      this.activeConnId = next.connId

      // Reset A* state for this connection
      this.nodePool = []
      this.heap.clear()
      this.seqCounter = 0
      this.nextStamp()

      // Push start node
      const h = this.computeH(
        next.startRow,
        next.startCol,
        next.endRow,
        next.endCol,
      )
      this.nodePool.push({
        z: next.startZ,
        row: next.startRow,
        col: next.startCol,
        g: 0,
        f: h,
        parentIdx: -1,
        ripped: null,
      })
      this.heap.push(h, this.seqCounter++, 0)
      return
    }

    // 2. Open set empty → fail
    if (this.heap.size === 0) {
      this.error = `No path found for ${this.connIdToName[this.activeConnId]}`
      this.failed = true
      return
    }

    // 3. Pop best node (O(log n))
    const nodeIdx = this.heap.pop()
    const node = this.nodePool[nodeIdx]!
    const { z, row, col, g, ripped } = node

    // 4. Skip if already visited (stamp check)
    const cellIdx = (z * this.rows + row) * this.cols + col
    if (this.visitedStamp[cellIdx] === this.stamp) return
    this.visitedStamp[cellIdx] = this.stamp

    // 5. Check end condition
    const seg = this.activeConnSeg
    if (z === seg.endZ && row === seg.endRow && col === seg.endCol) {
      this.finalizeRoute(nodeIdx)
      this.activeConnSeg = null
      this.activeConnId = -1
      return
    }

    // 6. Expand neighbors inline (no array allocation)
    const endRow = seg.endRow
    const endCol = seg.endCol
    const activeConn = this.activeConnId
    const rows = this.rows
    const cols = this.cols
    const cellSizeMm = this.cellSizeMm
    const visited = this.visitedStamp
    const stamp = this.stamp

    // 6a. 8-directional lateral moves
    for (let d = 0; d < 8; d++) {
      const nr = row + DIRS_DR[d]!
      const nc = col + DIRS_DC[d]!
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue

      const nIdx = (z * rows + nr) * cols + nc
      if (visited[nIdx] === stamp) continue

      this.computeMoveCostAndRips(activeConn, z, row, col, z, nr, nc, ripped)
      const g2 = g + this._moveCost
      const f2 = g2 + this.computeH(nr, nc, endRow, endCol)

      const newNodeIdx = this.nodePool.length
      this.nodePool.push({
        z,
        row: nr,
        col: nc,
        g: g2,
        f: f2,
        parentIdx: nodeIdx,
        ripped: this._moveRipped,
      })
      this.heap.push(f2, this.seqCounter++, newNodeIdx)
    }

    // 6b. Via moves (to other layers at same position)
    const canVia =
      this.viaMinDistFromBorder <= 0 ||
      Math.min(
        col * cellSizeMm,
        (cols - 1 - col) * cellSizeMm,
        row * cellSizeMm,
        (rows - 1 - row) * cellSizeMm,
      ) >= this.viaMinDistFromBorder

    if (canVia) {
      for (let nz = 0; nz < this.layers; nz++) {
        if (nz === z) continue

        const nIdx = (nz * rows + row) * cols + col
        if (visited[nIdx] === stamp) continue

        this.computeMoveCostAndRips(
          activeConn,
          z,
          row,
          col,
          nz,
          row,
          col,
          ripped,
        )
        const g2 = g + this._moveCost
        const f2 = g2 + this.computeH(row, col, endRow, endCol)

        const newNodeIdx = this.nodePool.length
        this.nodePool.push({
          z: nz,
          row,
          col,
          g: g2,
          f: f2,
          parentIdx: nodeIdx,
          ripped: this._moveRipped,
        })
        this.heap.push(f2, this.seqCounter++, newNodeIdx)
      }
    }
  }

  // --- Merged cost + rip computation (writes to _moveCost/_moveRipped) ---
  private computeMoveCostAndRips(
    activeConn: ConnId,
    fromZ: number,
    fromRow: number,
    fromCol: number,
    toZ: number,
    toRow: number,
    toCol: number,
    ripped: RippedNode | null,
  ): void {
    let cost = 0
    let r = ripped
    const cols = this.cols

    if (fromZ !== toZ) {
      // Via transition
      cost += this.hyperParameters.viaBaseCost
      cost += this.penalty2d[toRow * cols + toCol]!

      // Via footprint occupants (reusable scratch array)
      this.fillViaOccupants(toRow, toCol, activeConn)
      const occs = this._viaOccs
      for (let i = 0; i < occs.length; i++) {
        const occ = occs[i]!
        if (!rippedContains(r, occ)) {
          cost += this.hyperParameters.ripCost
          r = { id: occ, prev: r }
        }
        cost += this.hyperParameters.ripViaPenalty
      }
    } else {
      // Lateral movement
      const dr = fromRow > toRow ? fromRow - toRow : toRow - fromRow
      const dc = fromCol > toCol ? fromCol - toCol : toCol - fromCol
      cost += (dr + dc > 1 ? Math.SQRT2 : 1) * this.cellSizeMm
      cost += this.penalty2d[toRow * cols + toCol]!

      const flatIdx = (toZ * this.rows + toRow) * cols + toCol
      const occ = this.usedCellsFlat[flatIdx]!
      if (occ !== -1 && occ !== activeConn) {
        if (!rippedContains(r, occ)) {
          cost += this.hyperParameters.ripCost
          r = { id: occ, prev: r }
        }
        cost += this.hyperParameters.ripTracePenalty
      }
    }

    this._moveCost = cost
    this._moveRipped = r
  }

  // --- Via footprint unique occupants (fills _viaOccs scratch array) ---
  private fillViaOccupants(
    row: number,
    col: number,
    activeConn: ConnId,
  ): void {
    const occs = this._viaOccs
    occs.length = 0
    const rows = this.rows
    const cols = this.cols
    const offDr = this.viaOffsetsDr
    const offDc = this.viaOffsetsDc
    const offLen = this.viaOffsetsLen
    const used = this.usedCellsFlat

    for (let z = 0; z < this.layers; z++) {
      const zBase = z * this.planeSize
      for (let i = 0; i < offLen; i++) {
        const r = row + offDr[i]!
        const c = col + offDc[i]!
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue
        const occ = used[zBase + r * cols + c]!
        if (occ === -1 || occ === activeConn) continue
        // Small unique check (typically very few occupants)
        let seen = false
        for (let j = 0; j < occs.length; j++) {
          if (occs[j] === occ) {
            seen = true
            break
          }
        }
        if (!seen) occs.push(occ)
      }
    }
  }

  // --- Visited stamp management ---
  private nextStamp(): void {
    this.stamp = (this.stamp + 1) >>> 0
    if (this.stamp === 0) {
      this.visitedStamp.fill(0)
      this.stamp = 1
    }
  }

  // --- Heuristic: Manhattan distance * cellSizeMm ---
  private computeH(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number,
  ): number {
    return (
      (Math.abs(fromRow - toRow) + Math.abs(fromCol - toCol)) * this.cellSizeMm
    )
  }

  // --- Connection interning ---
  private internConn(name: string): ConnId {
    const existing = this.connNameToId.get(name)
    if (existing !== undefined) return existing
    const id = this.connIdToName.length
    this.connIdToName.push(name)
    this.connNameToId.set(name, id)
    return id
  }

  // --- Build connection segments from port points ---
  private buildConnectionSegs(): ConnectionSeg[] {
    const byName = new Map<
      string,
      Array<{ x: number; y: number; z: number }>
    >()
    for (const pp of this.nodeWithPortPoints.portPoints) {
      const name = pp.connectionName
      if (!byName.has(name)) byName.set(name, [])
      byName.get(name)!.push(pp)
    }

    const segs: ConnectionSeg[] = []
    for (const [name, pts] of byName) {
      if (pts.length < 2) continue
      const connId = this.internConn(name)
      for (let i = 0; i < pts.length - 1; i++) {
        const s = this.pointToCell(pts[i]!)
        const e = this.pointToCell(pts[i + 1]!)
        segs.push({
          connId,
          startZ: s.z,
          startRow: s.row,
          startCol: s.col,
          endZ: e.z,
          endRow: e.row,
          endCol: e.col,
        })
      }
    }
    return segs
  }

  private pointToCell(pt: {
    x: number
    y: number
    z: number
  }): { z: number; row: number; col: number } {
    const col = Math.max(
      0,
      Math.min(
        this.cols - 1,
        Math.round((pt.x - this.gridOrigin.x) / this.cellSizeMm - 0.5),
      ),
    )
    const row = Math.max(
      0,
      Math.min(
        this.rows - 1,
        Math.round((pt.y - this.gridOrigin.y) / this.cellSizeMm - 0.5),
      ),
    )
    const z = this.zToLayer.get(pt.z) ?? 0
    return { z, row, col }
  }

  private shuffleConnections(): void {
    const arr = this.unsolvedSegs
    let s = this.hyperParameters.shuffleSeed
    const rng = () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff
      return (s >>> 0) / 0xffffffff
    }
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = arr[i]!
      arr[i] = arr[j]!
      arr[j] = tmp
    }
  }

  // --- Finalize a found route ---
  private finalizeRoute(goalNodeIdx: number): void {
    // Reconstruct path from parent chain (cell-based)
    const cells: Array<{ z: number; row: number; col: number }> = []
    let idx = goalNodeIdx
    while (idx >= 0) {
      const n = this.nodePool[idx]!
      cells.push({ z: n.z, row: n.row, col: n.col })
      idx = n.parentIdx
    }
    cells.reverse()

    // Detect vias (z-level changes)
    const viaCells: Array<{ row: number; col: number }> = []
    for (let i = 1; i < cells.length; i++) {
      if (cells[i]!.z !== cells[i - 1]!.z) {
        viaCells.push({ row: cells[i]!.row, col: cells[i]!.col })
      }
    }

    const connId = this.activeConnId

    // Collect ripped traces from goal node's persistent list
    const goalNode = this.nodePool[goalNodeIdx]!
    const rippedIds: ConnId[] = []
    for (let cur = goalNode.ripped; cur; cur = cur.prev) {
      rippedIds.push(cur.id)
    }

    // Rip displaced traces
    for (let i = 0; i < rippedIds.length; i++) {
      this.ripTrace(rippedIds[i]!)
    }

    // Mark cells as used (with margin)
    const marginCells = Math.ceil(this.traceMargin / this.cellSizeMm)
    const indices: number[] = []
    const rows = this.rows
    const cols = this.cols
    const used = this.usedCellsFlat

    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci]!
      for (let dr = -marginCells; dr <= marginCells; dr++) {
        for (let dc = -marginCells; dc <= marginCells; dc++) {
          const r = cell.row + dr
          const c = cell.col + dc
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue
          const flatIdx = (cell.z * rows + r) * cols + c
          const existing = used[flatIdx]!
          if (existing !== -1 && existing !== connId) continue
          used[flatIdx] = connId
          indices.push(flatIdx)
        }
      }
    }

    // Mark via footprint cells
    const displacedByVias: ConnId[] = []
    const offDr = this.viaOffsetsDr
    const offDc = this.viaOffsetsDc
    const offLen = this.viaOffsetsLen

    for (let vi = 0; vi < viaCells.length; vi++) {
      const via = viaCells[vi]!
      for (let z = 0; z < this.layers; z++) {
        const zBase = z * this.planeSize
        for (let oi = 0; oi < offLen; oi++) {
          const r = via.row + offDr[oi]!
          const c = via.col + offDc[oi]!
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue
          const flatIdx = zBase + r * cols + c
          const existing = used[flatIdx]!
          if (existing !== -1 && existing !== connId) {
            // Track displaced (small unique check)
            let seen = false
            for (let k = 0; k < displacedByVias.length; k++) {
              if (displacedByVias[k] === existing) {
                seen = true
                break
              }
            }
            if (!seen) displacedByVias.push(existing)
          }
          used[flatIdx] = connId
          indices.push(flatIdx)
        }
      }
    }

    // Store used indices for this connection
    while (this.usedIndicesByConn.length <= connId) {
      this.usedIndicesByConn.push([])
    }
    this.usedIndicesByConn[connId] = indices

    // Store solved route (cell-based)
    this.solvedRoutes.set(connId, { connId, cells, viaCells })

    // Rip connections displaced by via footprints
    for (let i = 0; i < displacedByVias.length; i++) {
      this.ripTrace(displacedByVias[i]!)
    }
  }

  // --- Rip a trace ---
  private ripTrace(connId: ConnId): void {
    const route = this.solvedRoutes.get(connId)

    // Add rip penalties to penalty map along the ripped route
    if (route) {
      const cols = this.cols
      for (let i = 0; i < route.cells.length; i++) {
        const cell = route.cells[i]!
        const cellIdx = cell.row * cols + cell.col
        this.penalty2d[cellIdx] = this.penalty2d[cellIdx]! +
          this.hyperParameters.ripTracePenalty
      }
      for (let i = 0; i < route.viaCells.length; i++) {
        const via = route.viaCells[i]!
        const viaIdx = via.row * cols + via.col
        this.penalty2d[viaIdx] = this.penalty2d[viaIdx]! +
          this.hyperParameters.ripViaPenalty
      }
    }

    // Clear used cells using tracked indices
    const indices = this.usedIndicesByConn[connId]
    if (indices) {
      const used = this.usedCellsFlat
      for (let i = 0; i < indices.length; i++) {
        const flatIdx = indices[i]!
        if (used[flatIdx] === connId) {
          used[flatIdx] = -1
        }
      }
      this.usedIndicesByConn[connId] = []
    }

    // Move from solved back to unsolved
    if (route) {
      this.solvedRoutes.delete(connId)
      const first = route.cells[0]!
      const last = route.cells[route.cells.length - 1]!
      this.unsolvedSegs.push({
        connId,
        startZ: first.z,
        startRow: first.row,
        startCol: first.col,
        endZ: last.z,
        endRow: last.row,
        endCol: last.col,
      })
    }
  }

  override visualize() {
    const LAYER_COLORS = ["red", "blue", "orange", "green"]

    const points: Array<{
      x: number
      y: number
      color?: string
      label?: string
    }> = []
    const lines: Array<{
      points: Array<{ x: number; y: number }>
      strokeColor?: string
      strokeWidth?: number
    }> = []
    const circles: Array<{
      center: { x: number; y: number }
      radius: number
      fill?: string
      stroke?: string
    }> = []
    const rects: Array<{
      center: { x: number; y: number }
      width: number
      height: number
      fill?: string
      stroke?: string
    }> = []

    // Draw grid bounds
    const { width, height, center } = this.nodeWithPortPoints
    rects.push({
      center: { x: center.x, y: center.y },
      width,
      height,
      stroke: "gray",
    })

    const vt = this.gridToBoundsTransform

    // Draw penalty map as transparent rects
    if (this.showPenaltyMap && this.penalty2d) {
      let maxPenalty = 0
      for (let i = 0; i < this.penalty2d.length; i++) {
        if (this.penalty2d[i]! > maxPenalty) maxPenalty = this.penalty2d[i]!
      }
      if (maxPenalty > 0) {
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            const p = this.penalty2d[row * this.cols + col]!
            if (p <= 0) continue
            const alpha = Math.min(0.6, (p / maxPenalty) * 0.6)
            const tc = applyAffineTransformToPoint(vt, {
              x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
              y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
            })
            rects.push({
              center: tc,
              width: this.cellSizeMm * vt.a,
              height: this.cellSizeMm * vt.e,
              fill: `rgba(255,165,0,${alpha.toFixed(3)})`,
            })
          }
        }
      }
    }

    // Draw used cells as transparent blue rects
    if (this.showUsedCellMap && this.usedCellsFlat) {
      for (let z = 0; z < this.layers; z++) {
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            const occ =
              this.usedCellsFlat[(z * this.rows + row) * this.cols + col]!
            if (occ === -1) continue
            const tc = applyAffineTransformToPoint(vt, {
              x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
              y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
            })
            rects.push({
              center: tc,
              width: this.cellSizeMm * vt.a,
              height: this.cellSizeMm * vt.e,
              fill: "rgba(0,0,255,0.5)",
            })
          }
        }
      }
    }

    // Draw port points colored by layer
    for (const pp of this.nodeWithPortPoints.portPoints) {
      points.push({
        x: pp.x,
        y: pp.y,
        color: LAYER_COLORS[pp.z] ?? "gray",
        label: pp.connectionName,
      })
    }

    // Draw solved routes, splitting segments by z-layer for coloring
    const TRACE_COLORS = [
      "rgba(255,0,0,0.75)",
      "rgba(0,0,255,0.75)",
      "rgba(255,165,0,0.75)",
      "rgba(0,128,0,0.75)",
    ]
    const transformedRoutes = this.getOutput()
    for (const route of transformedRoutes) {
      if (route.route.length < 2) continue

      let segStart = 0
      for (let i = 1; i < route.route.length; i++) {
        const prev = route.route[i - 1]!
        const curr = route.route[i]!
        if (curr.z !== prev.z) {
          if (i - segStart >= 2) {
            lines.push({
              points: route.route
                .slice(segStart, i)
                .map((p) => ({ x: p.x, y: p.y })),
              strokeColor: TRACE_COLORS[prev.z] ?? "rgba(128,128,128,0.75)",
              strokeWidth: this.traceThickness,
            })
          }
          segStart = i
        }
      }
      if (route.route.length - segStart >= 2) {
        const lastZ = route.route[segStart]!.z
        lines.push({
          points: route.route
            .slice(segStart)
            .map((p) => ({ x: p.x, y: p.y })),
          strokeColor: TRACE_COLORS[lastZ] ?? "rgba(128,128,128,0.75)",
          strokeWidth: this.traceThickness,
        })
      }
    }

    // Draw vias
    for (const route of transformedRoutes) {
      for (const via of route.vias) {
        circles.push({
          center: { x: via.x, y: via.y },
          radius: this.viaDiameter / 2,
          fill: "rgba(0,0,0,0.3)",
          stroke: "black",
        })
      }
    }

    // Draw active A* exploration (scan visitedStamp for current stamp)
    if (this.activeConnSeg && this.visitedStamp) {
      const currentStamp = this.stamp
      for (let z = 0; z < this.layers; z++) {
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            if (
              this.visitedStamp[(z * this.rows + row) * this.cols + col] !==
              currentStamp
            )
              continue
            const tc = applyAffineTransformToPoint(vt, {
              x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
              y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
            })
            points.push({
              x: tc.x,
              y: tc.y,
              color: "rgba(0,0,255,0.2)",
            })
          }
        }
      }
    }

    return {
      points,
      lines,
      circles,
      rects,
      coordinateSystem: "cartesian" as const,
      title: `HighDensityA01 [${this.solvedRoutes?.size ?? 0} solved, ${this.unsolvedSegs?.length ?? 0} remaining]`,
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const t = this.gridToBoundsTransform
    const result: HighDensityIntraNodeRoute[] = []

    for (const [connId, route] of this.solvedRoutes) {
      const connName = this.connIdToName[connId]!
      result.push({
        connectionName: connName,
        traceThickness: this.traceThickness,
        viaDiameter: this.viaDiameter,
        route: route.cells.map((cell) => {
          const rawX =
            this.gridOrigin.x + (cell.col + 0.5) * this.cellSizeMm
          const rawY =
            this.gridOrigin.y + (cell.row + 0.5) * this.cellSizeMm
          const tp = applyAffineTransformToPoint(t, { x: rawX, y: rawY })
          return { x: tp.x, y: tp.y, z: this.layerToZ.get(cell.z) ?? cell.z }
        }),
        vias: route.viaCells.map((via) => {
          const rawX = this.gridOrigin.x + (via.col + 0.5) * this.cellSizeMm
          const rawY = this.gridOrigin.y + (via.row + 0.5) * this.cellSizeMm
          return applyAffineTransformToPoint(t, { x: rawX, y: rawY })
        }),
      })
    }

    return result
  }
}
