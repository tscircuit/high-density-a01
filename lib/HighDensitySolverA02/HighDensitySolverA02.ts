import { BaseSolver } from "@tscircuit/solver-utils"
import Flatbush from "flatbush"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../types"

type ConnId = number

interface ConnectionSeg {
  connId: ConnId
  startZ: number
  startCellId: number
  endZ: number
  endCellId: number
}

interface SolvedRouteInternal {
  connId: ConnId
  states: Int32Array
  viaCellIds: Int32Array
}

interface HyperParameters {
  shuffleSeed: number
  ripCost: number
  ripTracePenalty: number
  ripViaPenalty: number
  viaBaseCost: number
  greedyMultiplier: number
}

class TypedMinHeap {
  private f = new Float64Array(1024)
  private seq = new Uint32Array(1024)
  private id = new Int32Array(1024)
  private n = 0

  push(f: number, seq: number, id: number) {
    this.ensureCapacity(this.n + 1)
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

  private ensureCapacity(size: number) {
    if (size <= this.f.length) return
    let next = this.f.length
    while (next < size) next *= 2

    const nf = new Float64Array(next)
    nf.set(this.f)
    this.f = nf

    const ns = new Uint32Array(next)
    ns.set(this.seq)
    this.seq = ns

    const ni = new Int32Array(next)
    ni.set(this.id)
    this.id = ni
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
    const tf = this.f[i]!
    this.f[i] = this.f[j]!
    this.f[j] = tf

    const ts = this.seq[i]!
    this.seq[i] = this.seq[j]!
    this.seq[j] = ts

    const ti = this.id[i]!
    this.id[i] = this.id[j]!
    this.id[j] = ti
  }
}

class TypedNodePool {
  z = new Int32Array(1024)
  cellId = new Int32Array(1024)
  g = new Float64Array(1024)
  parent = new Int32Array(1024)
  ripHead = new Int32Array(1024).fill(-1)
  length = 0

  clear() {
    this.length = 0
  }

  push(z: number, cellId: number, g: number, parent: number, ripHead: number) {
    this.ensureCapacity(this.length + 1)
    const idx = this.length++
    this.z[idx] = z
    this.cellId[idx] = cellId
    this.g[idx] = g
    this.parent[idx] = parent
    this.ripHead[idx] = ripHead
    return idx
  }

  private ensureCapacity(size: number) {
    if (size <= this.z.length) return
    let next = this.z.length
    while (next < size) next *= 2

    const nz = new Int32Array(next)
    nz.set(this.z)
    this.z = nz

    const nc = new Int32Array(next)
    nc.set(this.cellId)
    this.cellId = nc

    const ng = new Float64Array(next)
    ng.set(this.g)
    this.g = ng

    const np = new Int32Array(next)
    np.set(this.parent)
    this.parent = np

    const nr = new Int32Array(next)
    nr.fill(-1)
    nr.set(this.ripHead.subarray(0, this.length))
    this.ripHead = nr
  }
}

class TypedRipChain {
  connId = new Int32Array(1024)
  prev = new Int32Array(1024).fill(-1)
  length = 0

  clear() {
    this.length = 0
  }

  append(prevHead: number, connId: number) {
    this.ensureCapacity(this.length + 1)
    const idx = this.length++
    this.connId[idx] = connId
    this.prev[idx] = prevHead
    return idx
  }

  contains(head: number, connId: number) {
    for (let cur = head; cur >= 0; cur = this.prev[cur]!) {
      if (this.connId[cur] === connId) return true
    }
    return false
  }

  collect(head: number, out: number[]) {
    out.length = 0
    for (let cur = head; cur >= 0; cur = this.prev[cur]!) {
      out.push(this.connId[cur]!)
    }
  }

  private ensureCapacity(size: number) {
    if (size <= this.connId.length) return
    let next = this.connId.length
    while (next < size) next *= 2

    const nc = new Int32Array(next)
    nc.set(this.connId)
    this.connId = nc

    const np = new Int32Array(next)
    np.fill(-1)
    np.set(this.prev.subarray(0, this.length))
    this.prev = np
  }
}

interface AxisSegment {
  min: number
  max: number
  center: number
  size: number
  index: number
}

interface CompositeCell {
  id: number
  grid: "outer" | "inner"
  row: number
  col: number
  centerX: number
  centerY: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  width: number
  height: number
}

interface NeighborEdge {
  cellId: number
  cost: number
}

function toRootNetName(
  connectionName: string,
  rootConnectionName?: string,
): string {
  return rootConnectionName ?? connectionName.replace(/_mst\d+$/, "")
}

function intervalGap(aMin: number, aMax: number, bMin: number, bMax: number) {
  if (aMax < bMin) return bMin - aMax
  if (bMax < aMin) return aMin - bMax
  return 0
}

function rectDistanceSq(a: CompositeCell, b: CompositeCell) {
  const dx = intervalGap(a.minX, a.maxX, b.minX, b.maxX)
  const dy = intervalGap(a.minY, a.maxY, b.minY, b.maxY)
  return dx * dx + dy * dy
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function circleIntersectsRect(
  cx: number,
  cy: number,
  r: number,
  rect: CompositeCell,
) {
  const qx = clamp(cx, rect.minX, rect.maxX)
  const qy = clamp(cy, rect.minY, rect.maxY)
  const dx = cx - qx
  const dy = cy - qy
  return dx * dx + dy * dy <= r * r
}

function pushUnique(arr: number[], value: number) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === value) return
  }
  arr.push(value)
}

function buildOuterAxisSegments(
  start: number,
  total: number,
  nominalSize: number,
): AxisSegment[] {
  const count = Math.max(1, Math.floor(total / nominalSize))
  const segments: AxisSegment[] = []
  let cur = start

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1
    const size = isLast ? start + total - cur : nominalSize
    const max = cur + size
    segments.push({
      min: cur,
      max,
      center: cur + size / 2,
      size,
      index: i,
    })
    cur = max
  }

  return segments
}

function buildInnerAxisSegments(
  start: number,
  total: number,
  nominalSize: number,
): AxisSegment[] {
  if (total <= nominalSize) {
    return [
      {
        min: start,
        max: start + total,
        center: start + total / 2,
        size: total,
        index: 0,
      },
    ]
  }

  const count = Math.max(1, Math.floor(total / nominalSize))
  const coverage = count * nominalSize
  const gap = Math.max(0, total - coverage)
  const origin = start + gap / 2
  const segments: AxisSegment[] = []

  for (let i = 0; i < count; i++) {
    const min = origin + i * nominalSize
    const max = min + nominalSize
    segments.push({
      min,
      max,
      center: min + nominalSize / 2,
      size: nominalSize,
      index: i,
    })
  }

  return segments
}

export interface HighDensitySolverA02Props {
  nodeWithPortPoints: NodeWithPortPoints
  outerGridCellSize: number
  outerGridCellThickness: number
  innerGridCellSize: number
  viaDiameter: number
  edgePenaltyStrength?: number
  edgePenaltyFalloff?: number
  maxCellCount?: number
  stepMultiplier?: number
  traceThickness?: number
  traceMargin?: number
  viaMinDistFromBorder?: number
  showPenaltyMap?: boolean
  showUsedCellMap?: boolean
  enableDeferredConflictRepair?: boolean
  maxDeferredRepairPasses?: number
  enableProfiling?: boolean
  hyperParameters?: Partial<HyperParameters>
  initialPenaltyFn?: (params: {
    x: number
    y: number
    px: number
    py: number
    cellId: number
    grid: "outer" | "inner"
    row: number
    col: number
  }) => number
}

export class HighDensitySolverA02 extends BaseSolver {
  nodeWithPortPoints: NodeWithPortPoints
  outerGridCellSize: number
  outerGridCellThickness: number
  innerGridCellSize: number
  viaDiameter: number
  edgePenaltyStrength: number
  edgePenaltyFalloff: number
  maxCellCount?: number
  traceThickness: number
  traceMargin: number
  viaMinDistFromBorder: number
  showPenaltyMap: boolean
  showUsedCellMap: boolean
  stepMultiplier: number
  enableDeferredConflictRepair: boolean
  maxDeferredRepairPasses: number
  enableProfiling: boolean
  hyperParameters: HyperParameters
  initialPenaltyFn?: HighDensitySolverA02Props["initialPenaltyFn"]

  boundsMinX!: number
  boundsMaxX!: number
  boundsMinY!: number
  boundsMaxY!: number

  cells!: CompositeCell[]
  viaAllowed!: Uint8Array
  spatialIndex!: Flatbush
  cellCenterX!: Float64Array
  cellCenterY!: Float64Array
  cellWidth!: Float64Array
  cellHeight!: Float64Array
  cellGridType!: Uint8Array
  cellRow!: Int32Array
  cellCol!: Int32Array
  neighborOffset!: Int32Array
  neighborIds!: Int32Array
  neighborCosts!: Float32Array
  traceKeepoutOffset!: Int32Array
  traceKeepoutIds!: Int32Array
  viaFootprintOffset!: Int32Array
  viaFootprintIds!: Int32Array

  availableZ!: number[]
  zToLayer!: Map<number, number>
  layerToZ!: Map<number, number>
  layers!: number

  private planeSize!: number
  private usedCellsFlat!: Int32Array
  private portOwnerFlat!: Int32Array
  private penalty2d!: Float64Array
  private visitedStamp!: Uint32Array
  private bestGStamp!: Uint32Array
  private bestGValue!: Float64Array
  private sharedCrossRootPortFlat!: Uint8Array
  private stamp = 0

  private connNameToId!: Map<string, ConnId>
  private connIdToName!: string[]
  private connIdToRootNet!: string[]
  private overlapFriendlyRootNets!: Set<string>

  private usedIndicesByConn!: Array<Int32Array | undefined>
  private unsolvedSegs!: ConnectionSeg[]
  private solvedRoutes!: Array<SolvedRouteInternal | undefined>

  private activeConnSeg: ConnectionSeg | null = null
  private activeConnId: ConnId = -1
  private crossLayerSearch = false
  private nodePool!: TypedNodePool
  private heap!: TypedMinHeap
  private ripChain!: TypedRipChain
  private seqCounter = 0

  private _viaOccs: ConnId[] = []
  private _rippedIds: ConnId[] = []
  private ripCount!: number[]
  private totalRipEvents = 0
  private searchIterations = 0
  private consecutiveSkips = 0
  private penaltyCap!: number
  private postSolveRepairPasses = 0
  private deferredConflictStampByConn!: Uint32Array
  private deferredPenaltyStampByCell!: Uint32Array
  private deferredConflictConnIds: number[] = []
  private deferredPenaltyCellIds: number[] = []
  private deferredConflictStamp = 1
  private deferredPenaltyStamp = 1
  private profileData = {
    setupMs: 0,
    buildGridMs: 0,
    keepoutMs: 0,
    searchMs: 0,
    fallbackMs: 0,
    repairMs: 0,
    repairs: 0,
  }

  private _moveCost = 0
  private _moveRippedHead = -1

  get unsolvedConnections() {
    return this.unsolvedSegs
  }

  get solvedConnectionsMap() {
    const map = new Map<ConnId, SolvedRouteInternal>()
    for (let connId = 0; connId < this.solvedRoutes.length; connId++) {
      const route = this.solvedRoutes[connId]
      if (route) map.set(connId, route)
    }
    return map
  }

  get activeConnection() {
    if (!this.activeConnSeg) return null
    const start = this.cells[this.activeConnSeg.startCellId]!
    const end = this.cells[this.activeConnSeg.endCellId]!
    return {
      connectionName: this.connIdToName[this.activeConnSeg.connId] ?? "",
      start: {
        cellId: start.id,
        grid: start.grid,
        row: start.row,
        col: start.col,
        x: start.centerX,
        y: start.centerY,
        z: this.activeConnSeg.startZ,
      },
      end: {
        cellId: end.id,
        grid: end.grid,
        row: end.row,
        col: end.col,
        x: end.centerX,
        y: end.centerY,
        z: this.activeConnSeg.endZ,
      },
    }
  }

  get openSet() {
    return { length: this.heap?.size ?? 0 }
  }

  get profiling() {
    return {
      ...this.profileData,
    }
  }

  get gridStats() {
    return {
      cells: this.planeSize || 0,
      layers: this.layers || 0,
      states: (this.planeSize || 0) * (this.layers || 0),
      neighborEdges: this.neighborIds?.length ?? 0,
      traceKeepoutEntries: this.traceKeepoutIds?.length ?? 0,
      viaFootprintEntries: this.viaFootprintIds?.length ?? 0,
    }
  }

  constructor(props: HighDensitySolverA02Props) {
    super()
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.outerGridCellSize = props.outerGridCellSize
    this.outerGridCellThickness = props.outerGridCellThickness
    this.innerGridCellSize = props.innerGridCellSize
    this.viaDiameter = props.viaDiameter
    this.edgePenaltyStrength = props.edgePenaltyStrength ?? 0.2
    this.edgePenaltyFalloff =
      props.edgePenaltyFalloff ??
      Math.max(this.outerGridCellThickness * 1.5, this.innerGridCellSize * 3)
    this.maxCellCount = props.maxCellCount
    this.traceThickness = props.traceThickness ?? 0.1
    this.traceMargin = props.traceMargin ?? 0.15
    this.viaMinDistFromBorder = props.viaMinDistFromBorder ?? 0.15
    this.showPenaltyMap = props.showPenaltyMap ?? false
    this.showUsedCellMap = props.showUsedCellMap ?? false
    this.enableDeferredConflictRepair =
      props.enableDeferredConflictRepair ?? false
    this.maxDeferredRepairPasses = props.maxDeferredRepairPasses ?? 32
    this.enableProfiling = props.enableProfiling ?? false
    this.stepMultiplier = Math.max(1, Math.floor(props.stepMultiplier ?? 1))
    this.hyperParameters = {
      shuffleSeed: 0,
      ripCost: 6,
      ripTracePenalty: 0.5,
      ripViaPenalty: 0.75,
      viaBaseCost: 0.1,
      greedyMultiplier: 1.6,
      ...props.hyperParameters,
    }
    this.MAX_ITERATIONS = 100e6
    this.initialPenaltyFn = props.initialPenaltyFn
  }

  override _setup(): void {
    this.profileData.setupMs = 0
    this.profileData.buildGridMs = 0
    this.profileData.keepoutMs = 0
    this.profileData.searchMs = 0
    this.profileData.fallbackMs = 0
    this.profileData.repairMs = 0
    this.profileData.repairs = 0
    const setupStart = this.enableProfiling ? performance.now() : 0
    const { nodeWithPortPoints } = this
    const { width, height, center } = nodeWithPortPoints

    this.availableZ =
      nodeWithPortPoints.availableZ ??
      [...new Set(nodeWithPortPoints.portPoints.map((pp) => pp.z))].sort(
        (a, b) => a - b,
      )

    this.layers = this.availableZ.length
    this.zToLayer = new Map()
    this.layerToZ = new Map()
    for (let i = 0; i < this.availableZ.length; i++) {
      const z = this.availableZ[i]!
      this.zToLayer.set(z, i)
      this.layerToZ.set(i, z)
    }

    this.boundsMinX = center.x - width / 2
    this.boundsMaxX = center.x + width / 2
    this.boundsMinY = center.y - height / 2
    this.boundsMaxY = center.y + height / 2

    const buildGridStart = this.enableProfiling ? performance.now() : 0
    const { cells, cellNeighbors, viaAllowed, spatialIndex } =
      this.buildCompositeGrid()
    if (this.enableProfiling) {
      this.profileData.buildGridMs += performance.now() - buildGridStart
    }

    this.cells = cells
    this.viaAllowed = viaAllowed
    this.spatialIndex = spatialIndex
    this.cellCenterX = new Float64Array(cells.length)
    this.cellCenterY = new Float64Array(cells.length)
    this.cellWidth = new Float64Array(cells.length)
    this.cellHeight = new Float64Array(cells.length)
    this.cellGridType = new Uint8Array(cells.length)
    this.cellRow = new Int32Array(cells.length)
    this.cellCol = new Int32Array(cells.length)
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!
      this.cellCenterX[i] = cell.centerX
      this.cellCenterY[i] = cell.centerY
      this.cellWidth[i] = cell.width
      this.cellHeight[i] = cell.height
      this.cellGridType[i] = cell.grid === "outer" ? 0 : 1
      this.cellRow[i] = cell.row
      this.cellCol[i] = cell.col
    }
    const flattenedNeighbors = this.flattenNeighborLists(cellNeighbors)
    this.neighborOffset = flattenedNeighbors.offset
    this.neighborIds = flattenedNeighbors.ids
    this.neighborCosts = flattenedNeighbors.costs

    this.planeSize = this.cells.length
    const totalCells = this.layers * this.planeSize
    if (this.maxCellCount !== undefined && totalCells > this.maxCellCount) {
      this.error = `Cell count ${totalCells} exceeds maxCellCount ${this.maxCellCount}`
      this.failed = true
      return
    }

    this.connNameToId = new Map()
    this.connIdToName = []
    this.connIdToRootNet = []
    this.overlapFriendlyRootNets = new Set()

    this.penalty2d = new Float64Array(this.planeSize)
    const widthInv = width > 0 ? 1 / width : 0
    const heightInv = height > 0 ? 1 / height : 0
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]!
      let penalty = this.computeBasePenalty(i)
      if (this.initialPenaltyFn) {
        penalty += this.initialPenaltyFn({
          x: cell.centerX,
          y: cell.centerY,
          px: (cell.centerX - this.boundsMinX) * widthInv,
          py: (cell.centerY - this.boundsMinY) * heightInv,
          cellId: cell.id,
          grid: cell.grid,
          row: cell.row,
          col: cell.col,
        })
      }
      this.penalty2d[cell.id] = penalty
    }

    this.usedCellsFlat = new Int32Array(totalCells).fill(-1)
    this.portOwnerFlat = new Int32Array(totalCells).fill(-1)
    this.visitedStamp = new Uint32Array(totalCells)
    this.bestGStamp = new Uint32Array(totalCells)
    this.bestGValue = new Float64Array(totalCells)
    this.sharedCrossRootPortFlat = new Uint8Array(totalCells)
    this.stamp = 0

    this.unsolvedSegs = this.buildConnectionSegs()

    const rootByPortFlat = new Map<number, string>()
    for (const pp of this.nodeWithPortPoints.portPoints) {
      const connId = this.connNameToId.get(pp.connectionName)
      if (connId === undefined) continue
      const cell = this.pointToCell(pp)
      const flatIdx = cell.z * this.planeSize + cell.cellId
      const rootNet = this.connIdToRootNet[connId]!
      const existingRoot = rootByPortFlat.get(flatIdx)
      if (existingRoot === undefined) {
        rootByPortFlat.set(flatIdx, rootNet)
      } else if (existingRoot !== rootNet) {
        this.sharedCrossRootPortFlat[flatIdx] = 1
      }

      const existing = this.portOwnerFlat[flatIdx]!
      if (existing === -1 || existing === connId) {
        this.portOwnerFlat[flatIdx] = connId
      } else {
        this.portOwnerFlat[flatIdx] = -2
      }
    }

    const keepoutStart = this.enableProfiling ? performance.now() : 0
    const keepoutLists: number[][] = Array.from(
      { length: this.cells.length },
      () => [],
    )
    const viaLists: number[][] = Array.from(
      { length: this.cells.length },
      () => [],
    )
    const traceRadius = this.traceMargin + this.traceThickness / 2
    const viaRadius = this.viaDiameter / 2 + traceRadius
    for (let cellId = 0; cellId < this.cells.length; cellId++) {
      const cell = this.cells[cellId]!
      const keepoutCandidates = this.spatialIndex.search(
        cell.centerX - traceRadius,
        cell.centerY - traceRadius,
        cell.centerX + traceRadius,
        cell.centerY + traceRadius,
      )
      const keepouts = keepoutLists[cellId]!
      for (let i = 0; i < keepoutCandidates.length; i++) {
        const otherId = keepoutCandidates[i]!
        if (
          circleIntersectsRect(
            cell.centerX,
            cell.centerY,
            traceRadius,
            this.cells[otherId]!,
          )
        ) {
          keepouts.push(otherId)
        }
      }

      const viaCandidates = this.spatialIndex.search(
        cell.centerX - viaRadius,
        cell.centerY - viaRadius,
        cell.centerX + viaRadius,
        cell.centerY + viaRadius,
      )
      const viaFootprint = viaLists[cellId]!
      for (let i = 0; i < viaCandidates.length; i++) {
        const otherId = viaCandidates[i]!
        if (
          circleIntersectsRect(
            cell.centerX,
            cell.centerY,
            viaRadius,
            this.cells[otherId]!,
          )
        ) {
          viaFootprint.push(otherId)
        }
      }
    }
    const flattenedKeepouts = this.flattenIndexLists(keepoutLists)
    this.traceKeepoutOffset = flattenedKeepouts.offset
    this.traceKeepoutIds = flattenedKeepouts.ids
    const flattenedVia = this.flattenIndexLists(viaLists)
    this.viaFootprintOffset = flattenedVia.offset
    this.viaFootprintIds = flattenedVia.ids
    if (this.enableProfiling) {
      this.profileData.keepoutMs += performance.now() - keepoutStart
    }

    this.solvedRoutes = []
    this.usedIndicesByConn = []
    this.ripCount = []
    this.consecutiveSkips = 0
    this.penaltyCap = this.hyperParameters.ripCost * 0.5
    this.postSolveRepairPasses = 0
    this.deferredConflictStampByConn = new Uint32Array(
      Math.max(1, this.connIdToName.length),
    )
    this.deferredPenaltyStampByCell = new Uint32Array(this.planeSize)
    this.deferredConflictConnIds = []
    this.deferredPenaltyCellIds = []
    this.deferredConflictStamp = 1
    this.deferredPenaltyStamp = 1
    this.shuffleConnections()

    this.activeConnSeg = null
    this.activeConnId = -1
    this.nodePool = new TypedNodePool()
    this.heap = new TypedMinHeap()
    this.ripChain = new TypedRipChain()
    this.seqCounter = 0
    if (this.enableProfiling) {
      this.profileData.setupMs += performance.now() - setupStart
    }
  }

  override _step(): void {
    for (let i = 0; i < this.stepMultiplier; i++) {
      if (this.solved || this.failed) return
      this.stepOnce()
    }
  }

  private buildCompositeGrid() {
    const width = this.boundsMaxX - this.boundsMinX
    const height = this.boundsMaxY - this.boundsMinY

    const outerX = buildOuterAxisSegments(
      this.boundsMinX,
      width,
      this.outerGridCellSize,
    )
    const outerY = buildOuterAxisSegments(
      this.boundsMinY,
      height,
      this.outerGridCellSize,
    )

    const thicknessCols = Math.max(
      1,
      Math.round(this.outerGridCellThickness / this.outerGridCellSize),
    )
    const thicknessRows = thicknessCols

    const outerCells: CompositeCell[] = []
    const outerMap = new Map<string, number>()
    const outerBoundaryCellIds: number[] = []

    let nextCellId = 0
    for (let row = 0; row < outerY.length; row++) {
      for (let col = 0; col < outerX.length; col++) {
        const inOuterBand =
          row < thicknessRows ||
          row >= outerY.length - thicknessRows ||
          col < thicknessCols ||
          col >= outerX.length - thicknessCols
        if (!inOuterBand) continue

        const ys = outerY[row]!
        const xs = outerX[col]!
        const cell: CompositeCell = {
          id: nextCellId++,
          grid: "outer",
          row,
          col,
          centerX: xs.center,
          centerY: ys.center,
          minX: xs.min,
          maxX: xs.max,
          minY: ys.min,
          maxY: ys.max,
          width: xs.size,
          height: ys.size,
        }
        outerCells.push(cell)
        outerMap.set(`${row}:${col}`, cell.id)

        const touchesHoleBoundary =
          row === thicknessRows - 1 ||
          row === outerY.length - thicknessRows ||
          col === thicknessCols - 1 ||
          col === outerX.length - thicknessCols
        if (touchesHoleBoundary) outerBoundaryCellIds.push(cell.id)
      }
    }

    const holeMinX = outerX[Math.min(thicknessCols, outerX.length - 1)]?.min
    const holeMaxX = outerX[Math.max(0, outerX.length - thicknessCols - 1)]?.max
    const holeMinY = outerY[Math.min(thicknessRows, outerY.length - 1)]?.min
    const holeMaxY = outerY[Math.max(0, outerY.length - thicknessRows - 1)]?.max

    const innerCells: CompositeCell[] = []
    const innerMap = new Map<string, number>()
    const innerBoundaryCellIds: number[] = []

    if (
      holeMinX !== undefined &&
      holeMaxX !== undefined &&
      holeMinY !== undefined &&
      holeMaxY !== undefined &&
      holeMaxX > holeMinX &&
      holeMaxY > holeMinY
    ) {
      const innerX = buildInnerAxisSegments(
        holeMinX,
        holeMaxX - holeMinX,
        this.innerGridCellSize,
      )
      const innerY = buildInnerAxisSegments(
        holeMinY,
        holeMaxY - holeMinY,
        this.innerGridCellSize,
      )

      for (let row = 0; row < innerY.length; row++) {
        for (let col = 0; col < innerX.length; col++) {
          const ys = innerY[row]!
          const xs = innerX[col]!
          const cell: CompositeCell = {
            id: nextCellId++,
            grid: "inner",
            row,
            col,
            centerX: xs.center,
            centerY: ys.center,
            minX: xs.min,
            maxX: xs.max,
            minY: ys.min,
            maxY: ys.max,
            width: xs.size,
            height: ys.size,
          }
          innerCells.push(cell)
          innerMap.set(`${row}:${col}`, cell.id)

          const isBoundary =
            row === 0 ||
            row === innerY.length - 1 ||
            col === 0 ||
            col === innerX.length - 1
          if (isBoundary) innerBoundaryCellIds.push(cell.id)
        }
      }
    }

    const cells = [...outerCells, ...innerCells]
    const cellNeighbors: NeighborEdge[][] = Array.from(
      { length: cells.length },
      () => [],
    )

    const addBidirectionalEdge = (a: number, b: number) => {
      if (a === b) return
      const cellA = cells[a]!
      const cellB = cells[b]!
      const cost = Math.hypot(
        cellA.centerX - cellB.centerX,
        cellA.centerY - cellB.centerY,
      )
      pushUniqueNeighbor(cellNeighbors[a]!, { cellId: b, cost })
      pushUniqueNeighbor(cellNeighbors[b]!, { cellId: a, cost })
    }

    for (const cell of outerCells) {
      const candidates = [
        `${cell.row - 1}:${cell.col}`,
        `${cell.row + 1}:${cell.col}`,
        `${cell.row}:${cell.col - 1}`,
        `${cell.row}:${cell.col + 1}`,
      ]
      for (const key of candidates) {
        const other = outerMap.get(key)
        if (other !== undefined) addBidirectionalEdge(cell.id, other)
      }
    }

    for (const cell of innerCells) {
      const candidates = [
        `${cell.row - 1}:${cell.col}`,
        `${cell.row + 1}:${cell.col}`,
        `${cell.row}:${cell.col - 1}`,
        `${cell.row}:${cell.col + 1}`,
      ]
      for (const key of candidates) {
        const other = innerMap.get(key)
        if (other !== undefined) addBidirectionalEdge(cell.id, other)
      }
    }

    const bridgeGap =
      Math.max(this.outerGridCellSize, this.innerGridCellSize) * 0.75
    for (let i = 0; i < outerBoundaryCellIds.length; i++) {
      const outerId = outerBoundaryCellIds[i]!
      const outerCell = cells[outerId]!
      for (let j = 0; j < innerBoundaryCellIds.length; j++) {
        const innerId = innerBoundaryCellIds[j]!
        const innerCell = cells[innerId]!
        const xGap = intervalGap(
          outerCell.minX,
          outerCell.maxX,
          innerCell.minX,
          innerCell.maxX,
        )
        const yGap = intervalGap(
          outerCell.minY,
          outerCell.maxY,
          innerCell.minY,
          innerCell.maxY,
        )
        const xOverlap = xGap === 0
        const yOverlap = yGap === 0
        if (
          (xGap <= bridgeGap && yOverlap) ||
          (yGap <= bridgeGap && xOverlap)
        ) {
          addBidirectionalEdge(outerId, innerId)
        }
      }
    }

    const viaRadius = this.viaDiameter / 2
    const viaAllowed = new Uint8Array(cells.length)
    const spatialIndex = new Flatbush(cells.length)

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!
      spatialIndex.add(cell.minX, cell.minY, cell.maxX, cell.maxY)
      const minBorderDist = Math.min(
        cell.centerX - this.boundsMinX,
        this.boundsMaxX - cell.centerX,
        cell.centerY - this.boundsMinY,
        this.boundsMaxY - cell.centerY,
      )
      viaAllowed[i] = minBorderDist >= this.viaMinDistFromBorder ? 1 : 0
    }
    spatialIndex.finish()

    return {
      cells,
      cellNeighbors,
      viaAllowed,
      spatialIndex,
    }
  }

  private stepOnce(): void {
    const profileStart = this.enableProfiling ? performance.now() : 0
    if (!this.activeConnSeg) {
      if (this.unsolvedSegs.length === 0) {
        if (this.tryDeferredConflictRepair()) {
          if (this.enableProfiling) {
            this.profileData.searchMs += performance.now() - profileStart
          }
          return
        }
        this.solved = true
        if (this.enableProfiling) {
          this.profileData.searchMs += performance.now() - profileStart
        }
        return
      }

      const next = this.unsolvedSegs.shift()!
      this.activeConnSeg = next
      this.activeConnId = next.connId
      this.crossLayerSearch = next.startZ !== next.endZ

      this.nodePool.clear()
      this.ripChain.clear()
      this.heap.clear()
      this.seqCounter = 0
      this.searchIterations = 0
      this.nextStamp()

      const h = this.computeH(
        next.startZ,
        next.startCellId,
        next.endZ,
        next.endCellId,
      )
      const f = h * this.hyperParameters.greedyMultiplier
      const startIdx = this.nodePool.push(
        next.startZ,
        next.startCellId,
        0,
        -1,
        -1,
      )
      const startFlatIdx = next.startZ * this.planeSize + next.startCellId
      this.bestGStamp[startFlatIdx] = this.stamp
      this.bestGValue[startFlatIdx] = 0
      this.heap.push(f, this.seqCounter++, startIdx)
      if (this.enableProfiling) {
        this.profileData.searchMs += performance.now() - profileStart
      }
      return
    }

    this.searchIterations++
    const connRips = this.ripCount[this.activeConnId] ?? 0
    if (
      this.unsolvedSegs.length <= 2 &&
      this.MAX_ITERATIONS - this.iterations <= 50_000 &&
      this.tryLastConnectionFallback(this.activeConnSeg)
    ) {
      this.activeConnSeg = null
      this.activeConnId = -1
      this.heap.clear()
      this.nodePool.clear()
      return
    }

    const baseBudget = this.planeSize * this.layers * 60
    const budget = Math.min(
      baseBudget * (1 + connRips * 0.5),
      this.planeSize * this.layers * 600,
    )
    if (this.searchIterations > budget) {
      if (
        this.unsolvedSegs.length <= 2 &&
        this.tryLastConnectionFallback(this.activeConnSeg)
      ) {
        this.activeConnSeg = null
        this.activeConnId = -1
        this.heap.clear()
        this.nodePool.clear()
        return
      }

      const pen = this.penalty2d
      for (let i = 0; i < pen.length; i++) {
        pen[i] = pen[i]! * 0.9
      }
      this.unsolvedSegs.push(this.activeConnSeg)
      this.activeConnSeg = null
      this.activeConnId = -1
      this.heap.clear()
      this.nodePool.clear()
      this.consecutiveSkips++
      if (this.consecutiveSkips >= Math.max(3, this.unsolvedSegs.length * 3)) {
        this.error = `Convergence failure: ${this.unsolvedSegs.length} connections stuck`
        this.failed = true
      }
      if (this.enableProfiling) {
        this.profileData.searchMs += performance.now() - profileStart
      }
      return
    }

    if (this.heap.size === 0) {
      this.error = `No path found for ${this.connIdToName[this.activeConnId]}`
      this.failed = true
      if (this.enableProfiling) {
        this.profileData.searchMs += performance.now() - profileStart
      }
      return
    }

    const nodeIdx = this.heap.pop()
    const z = this.nodePool.z[nodeIdx]!
    const cellId = this.nodePool.cellId[nodeIdx]!
    const g = this.nodePool.g[nodeIdx]!
    const rippedHead = this.nodePool.ripHead[nodeIdx]!

    const flatIdx = z * this.planeSize + cellId
    if (this.visitedStamp[flatIdx] === this.stamp) {
      if (this.enableProfiling) {
        this.profileData.searchMs += performance.now() - profileStart
      }
      return
    }
    this.visitedStamp[flatIdx] = this.stamp

    const seg = this.activeConnSeg
    if (z === seg.endZ && cellId === seg.endCellId) {
      this.finalizeRoute(nodeIdx)
      this.activeConnSeg = null
      this.activeConnId = -1
      if (this.enableProfiling) {
        this.profileData.searchMs += performance.now() - profileStart
      }
      return
    }

    const visited = this.visitedStamp
    const stamp = this.stamp
    const activeConn = this.activeConnId
    const endZ = seg.endZ
    const endCellId = seg.endCellId
    const neighborStart = this.neighborOffset[cellId]!
    const neighborEnd = this.neighborOffset[cellId + 1]!

    for (let i = neighborStart; i < neighborEnd; i++) {
      const neighborCellId = this.neighborIds[i]!
      const nextFlatIdx = z * this.planeSize + neighborCellId
      if (visited[nextFlatIdx] === stamp) continue

      this.computeMoveCostAndRips(
        activeConn,
        z,
        cellId,
        z,
        neighborCellId,
        rippedHead,
        this.neighborCosts[i]!,
      )
      if (this._moveCost < 0) continue

      const g2 = g + this._moveCost
      if (
        this.bestGStamp[nextFlatIdx] === stamp &&
        g2 >= this.bestGValue[nextFlatIdx]!
      ) {
        continue
      }
      this.bestGStamp[nextFlatIdx] = stamp
      this.bestGValue[nextFlatIdx] = g2
      const f2 =
        g2 +
        this.computeH(z, neighborCellId, endZ, endCellId) *
          this.hyperParameters.greedyMultiplier

      const newNodeIdx = this.nodePool.push(
        z,
        neighborCellId,
        g2,
        nodeIdx,
        this._moveRippedHead,
      )
      this.heap.push(f2, this.seqCounter++, newNodeIdx)
    }

    if (this.viaAllowed[cellId]) {
      for (let nz = 0; nz < this.layers; nz++) {
        if (nz === z) continue
        const nextFlatIdx = nz * this.planeSize + cellId
        if (visited[nextFlatIdx] === stamp) continue

        this.computeMoveCostAndRips(
          activeConn,
          z,
          cellId,
          nz,
          cellId,
          rippedHead,
          0,
        )
        if (this._moveCost < 0) continue

        const g2 = g + this._moveCost
        if (
          this.bestGStamp[nextFlatIdx] === stamp &&
          g2 >= this.bestGValue[nextFlatIdx]!
        ) {
          continue
        }
        this.bestGStamp[nextFlatIdx] = stamp
        this.bestGValue[nextFlatIdx] = g2
        const f2 =
          g2 +
          this.computeH(nz, cellId, endZ, endCellId) *
            this.hyperParameters.greedyMultiplier

        const newNodeIdx = this.nodePool.push(
          nz,
          cellId,
          g2,
          nodeIdx,
          this._moveRippedHead,
        )
        this.heap.push(f2, this.seqCounter++, newNodeIdx)
      }
    }
    if (this.enableProfiling) {
      this.profileData.searchMs += performance.now() - profileStart
    }
  }

  private computeMoveCostAndRips(
    activeConn: ConnId,
    fromZ: number,
    fromCellId: number,
    toZ: number,
    toCellId: number,
    rippedHead: number,
    lateralCost: number,
  ): void {
    let cost = 0
    let head = rippedHead
    const toFlatIdx = toZ * this.planeSize + toCellId

    if (fromZ !== toZ) {
      cost += this.hyperParameters.viaBaseCost
      cost += Math.min(this.penalty2d[toCellId]!, this.penaltyCap)

      const fixedOwner = this.portOwnerFlat[toFlatIdx]!
      const fixedSameRoot =
        this.connIdToRootNet[fixedOwner] === this.connIdToRootNet[activeConn]
      const allowFixedOverlap =
        fixedSameRoot &&
        this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
      const seg = this.activeConnSeg
      const isSegEnd = !!seg && toZ === seg.endZ && toCellId === seg.endCellId
      if (
        fixedOwner >= 0 &&
        fixedOwner !== activeConn &&
        !allowFixedOverlap &&
        !isSegEnd
      ) {
        this._moveCost = -1
        this._moveRippedHead = head
        return
      }

      this.fillViaOccupants(toCellId, activeConn)
      const occs = this._viaOccs
      for (let i = 0; i < occs.length; i++) {
        const occ = occs[i]!
        if (!this.ripChain.contains(head, occ)) {
          cost += this.hyperParameters.ripCost
          head = this.ripChain.append(head, occ)
        }
        cost += this.hyperParameters.ripViaPenalty
      }
    } else {
      cost += lateralCost
      cost += Math.min(this.penalty2d[toCellId]!, this.penaltyCap)

      const fixedOwner = this.portOwnerFlat[toFlatIdx]!
      const fixedSameRoot =
        this.connIdToRootNet[fixedOwner] === this.connIdToRootNet[activeConn]
      const allowFixedOverlap =
        fixedSameRoot &&
        this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
      const seg = this.activeConnSeg
      const isSegEnd = !!seg && toZ === seg.endZ && toCellId === seg.endCellId
      if (
        fixedOwner >= 0 &&
        fixedOwner !== activeConn &&
        !allowFixedOverlap &&
        !isSegEnd
      ) {
        this._moveCost = -1
        this._moveRippedHead = head
        return
      }

      const occ = this.usedCellsFlat[toFlatIdx]!
      const allowSameRootOverlap = this.allowSharedUse(activeConn, occ)
      if (occ !== -1 && occ !== activeConn && !allowSameRootOverlap) {
        if (!this.ripChain.contains(head, occ)) {
          cost += this.hyperParameters.ripCost
          head = this.ripChain.append(head, occ)
        }
        cost += this.hyperParameters.ripTracePenalty
      }
    }

    this._moveCost = cost
    this._moveRippedHead = head
  }

  private fillViaOccupants(cellId: number, activeConn: ConnId): void {
    const occs = this._viaOccs
    occs.length = 0
    const start = this.viaFootprintOffset[cellId]!
    const end = this.viaFootprintOffset[cellId + 1]!

    for (let z = 0; z < this.layers; z++) {
      const zBase = z * this.planeSize
      for (let i = start; i < end; i++) {
        const occCellId = this.viaFootprintIds[i]!
        const occ = this.usedCellsFlat[zBase + occCellId]!
        if (occ === -1 || occ === activeConn) continue
        if (this.allowSharedUse(activeConn, occ)) {
          continue
        }
        pushUnique(occs, occ)
      }
    }
  }

  private allowSharedUse(activeConn: ConnId, existingConn: ConnId) {
    const sameRoot =
      this.connIdToRootNet[existingConn] === this.connIdToRootNet[activeConn]
    return (
      sameRoot &&
      this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
    )
  }

  private nextStamp(): void {
    this.stamp = (this.stamp + 1) >>> 0
    if (this.stamp === 0) {
      this.visitedStamp.fill(0)
      this.bestGStamp.fill(0)
      this.stamp = 1
    }
  }

  private computeH(
    z: number,
    cellId: number,
    toZ: number,
    toCellId: number,
  ): number {
    const dist = Math.hypot(
      this.cellCenterX[cellId]! - this.cellCenterX[toCellId]!,
      this.cellCenterY[cellId]! - this.cellCenterY[toCellId]!,
    )

    if (z === toZ) return dist
    return dist + this.hyperParameters.viaBaseCost
  }

  private computeBasePenalty(cellId: number) {
    if (this.edgePenaltyStrength <= 0 || this.edgePenaltyFalloff <= 0) return 0

    const distFromBorder = Math.min(
      this.cellCenterX[cellId]! - this.boundsMinX,
      this.boundsMaxX - this.cellCenterX[cellId]!,
      this.cellCenterY[cellId]! - this.boundsMinY,
      this.boundsMaxY - this.cellCenterY[cellId]!,
    )
    if (distFromBorder >= this.edgePenaltyFalloff) return 0

    const t = 1 - distFromBorder / this.edgePenaltyFalloff
    return this.edgePenaltyStrength * t * t
  }

  private internConn(name: string, rootNetName?: string): ConnId {
    const existing = this.connNameToId.get(name)
    if (existing !== undefined) return existing
    const id = this.connIdToName.length
    this.connIdToName.push(name)
    this.connIdToRootNet.push(toRootNetName(name, rootNetName))
    this.connNameToId.set(name, id)
    return id
  }

  private buildConnectionSegs(): ConnectionSeg[] {
    const byName = new Map<
      string,
      {
        points: Array<{ x: number; y: number; z: number }>
        rootConnectionName?: string
      }
    >()
    for (const pp of this.nodeWithPortPoints.portPoints) {
      const name = pp.connectionName
      if (!byName.has(name)) {
        byName.set(name, {
          points: [],
          rootConnectionName: pp.rootConnectionName,
        })
      }
      byName.get(name)!.points.push(pp)
    }

    const segs: ConnectionSeg[] = []
    const seenSegmentKeys = new Set<string>()

    for (const [name, conn] of byName) {
      const pts = conn.points
      if (pts.length < 2) continue

      const connId = this.internConn(name, conn.rootConnectionName)
      for (let i = 0; i < pts.length - 1; i++) {
        const s = this.pointToCell(pts[i]!)
        const e = this.pointToCell(pts[i + 1]!)

        const endpointA = `${s.z}:${s.cellId}`
        const endpointB = `${e.z}:${e.cellId}`
        const orderedEndpoints =
          endpointA < endpointB
            ? `${endpointA}|${endpointB}`
            : `${endpointB}|${endpointA}`
        const netName = conn.rootConnectionName ?? name
        const segKey = `${netName}|${orderedEndpoints}`
        if (seenSegmentKeys.has(segKey)) {
          this.overlapFriendlyRootNets.add(netName)
          continue
        }
        seenSegmentKeys.add(segKey)

        segs.push({
          connId,
          startZ: s.z,
          startCellId: s.cellId,
          endZ: e.z,
          endCellId: e.cellId,
        })
      }
    }

    return segs
  }

  private pointToCell(pt: { x: number; y: number; z: number }) {
    const candidateIds = this.spatialIndex.neighbors(pt.x, pt.y, 32)
    const cellsToSearch =
      candidateIds.length > 0
        ? candidateIds.map((cellId) => this.cells[cellId]!)
        : this.cells

    let bestCell = cellsToSearch[0] ?? this.cells[0]!
    let bestDistanceSq = Number.POSITIVE_INFINITY
    let bestArea = Number.POSITIVE_INFINITY

    for (let i = 0; i < cellsToSearch.length; i++) {
      const cell = cellsToSearch[i]!
      const dx =
        pt.x < cell.minX
          ? cell.minX - pt.x
          : pt.x > cell.maxX
            ? pt.x - cell.maxX
            : 0
      const dy =
        pt.y < cell.minY
          ? cell.minY - pt.y
          : pt.y > cell.maxY
            ? pt.y - cell.maxY
            : 0
      const distanceSq = dx * dx + dy * dy
      const area = cell.width * cell.height
      if (
        distanceSq < bestDistanceSq ||
        (distanceSq === bestDistanceSq && area < bestArea)
      ) {
        bestCell = cell
        bestDistanceSq = distanceSq
        bestArea = area
      }
    }

    return {
      z: this.zToLayer.get(pt.z) ?? 0,
      cellId: bestCell.id,
    }
  }

  private shuffleConnections(): void {
    const arr = this.unsolvedSegs
    let s = this.hyperParameters.shuffleSeed
    const rng = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 0xffffffff
    }
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = arr[i]!
      arr[i] = arr[j]!
      arr[j] = tmp
    }
  }

  private finalizeRoute(goalNodeIdx: number): void {
    this.consecutiveSkips = Math.max(0, this.consecutiveSkips - 1)

    const states: number[] = []
    let idx = goalNodeIdx
    while (idx >= 0) {
      const z = this.nodePool.z[idx]!
      const cellId = this.nodePool.cellId[idx]!
      states.push(z * this.planeSize + cellId)
      idx = this.nodePool.parent[idx]!
    }
    states.reverse()

    while (states.length > 1) {
      if (!this.sharedCrossRootPortFlat[states[0]!]!) break
      states.shift()
    }
    while (states.length > 1) {
      if (!this.sharedCrossRootPortFlat[states[states.length - 1]!]!) break
      states.pop()
    }

    const viaCellIds = this.extractViaCellIds(states)

    const connId = this.activeConnId
    this.ripChain.collect(this.nodePool.ripHead[goalNodeIdx]!, this._rippedIds)
    const deferRipup =
      this.enableDeferredConflictRepair && this.unsolvedSegs.length <= 1
    this.commitRoute(connId, states, this._rippedIds, viaCellIds, deferRipup)
  }

  private commitRoute(
    connId: ConnId,
    states: number[],
    rippedIds: ConnId[],
    viaCellIds?: number[],
    deferRipup = false,
  ) {
    const normalizedStates = states.slice()

    while (normalizedStates.length > 1) {
      if (!this.sharedCrossRootPortFlat[normalizedStates[0]!]!) break
      normalizedStates.shift()
    }
    while (normalizedStates.length > 1) {
      if (
        !this.sharedCrossRootPortFlat[
          normalizedStates[normalizedStates.length - 1]!
        ]!
      )
        break
      normalizedStates.pop()
    }

    const routeViaCellIds = viaCellIds
      ? viaCellIds.slice()
      : this.extractViaCellIds(normalizedStates)

    if (!deferRipup) {
      for (let i = 0; i < rippedIds.length; i++) {
        this.ripTrace(rippedIds[i]!)
      }
    }

    const indices: number[] = []
    for (let i = 0; i < normalizedStates.length; i++) {
      const state = normalizedStates[i]!
      const z = Math.floor(state / this.planeSize)
      const cellId = state - z * this.planeSize
      const keepoutStart = this.traceKeepoutOffset[cellId]!
      const keepoutEnd = this.traceKeepoutOffset[cellId + 1]!
      for (let j = keepoutStart; j < keepoutEnd; j++) {
        const occCellId = this.traceKeepoutIds[j]!
        const flatIdx = z * this.planeSize + occCellId
        const existing = this.usedCellsFlat[flatIdx]!
        const allowSameRootOverlap = this.allowSharedUse(connId, existing)
        if (existing !== -1 && existing !== connId && !allowSameRootOverlap) {
          if (deferRipup) {
            this.recordDeferredConflict(connId, existing, cellId)
          }
          continue
        }
        this.usedCellsFlat[flatIdx] = connId
        indices.push(flatIdx)
      }
    }

    const displacedByVias: ConnId[] = []
    for (let i = 0; i < routeViaCellIds.length; i++) {
      const viaCellId = routeViaCellIds[i]!
      const footprintStart = this.viaFootprintOffset[viaCellId]!
      const footprintEnd = this.viaFootprintOffset[viaCellId + 1]!
      for (let z = 0; z < this.layers; z++) {
        const zBase = z * this.planeSize
        for (let j = footprintStart; j < footprintEnd; j++) {
          const occCellId = this.viaFootprintIds[j]!
          const flatIdx = zBase + occCellId
          const existing = this.usedCellsFlat[flatIdx]!
          const allowSameRootOverlap = this.allowSharedUse(connId, existing)
          if (existing !== -1 && existing !== connId && !allowSameRootOverlap) {
            if (deferRipup) {
              this.recordDeferredConflict(connId, existing, viaCellId)
            } else {
              pushUnique(displacedByVias, existing)
            }
          }
          this.usedCellsFlat[flatIdx] = connId
          indices.push(flatIdx)
        }
      }
    }

    while (this.usedIndicesByConn.length <= connId) {
      this.usedIndicesByConn.push(undefined)
    }
    this.usedIndicesByConn[connId] = Int32Array.from(indices)
    while (this.solvedRoutes.length <= connId) {
      this.solvedRoutes.push(undefined)
    }
    this.solvedRoutes[connId] = {
      connId,
      states: Int32Array.from(normalizedStates),
      viaCellIds: Int32Array.from(routeViaCellIds),
    }

    if (!deferRipup) {
      for (let i = 0; i < displacedByVias.length; i++) {
        this.ripTrace(displacedByVias[i]!)
      }
    }

    if (!deferRipup && (rippedIds.length > 0 || displacedByVias.length > 0)) {
      const pen = this.penalty2d
      const cap = this.penaltyCap
      if (this.totalRipEvents > 50) {
        for (let i = 0; i < pen.length; i++) {
          pen[i] = pen[i]! * 0.99
        }
      } else {
        for (let i = 0; i < pen.length; i++) {
          if (pen[i]! > cap) {
            pen[i] = pen[i]! * 0.5
          }
        }
      }
    }
  }

  private extractViaCellIds(states: number[]) {
    const viaCellIds: number[] = []
    for (let i = 1; i < states.length; i++) {
      const prevState = states[i - 1]!
      const nextState = states[i]!
      const prevZ = Math.floor(prevState / this.planeSize)
      const nextZ = Math.floor(nextState / this.planeSize)
      if (prevZ !== nextZ) {
        viaCellIds.push(nextState - nextZ * this.planeSize)
      }
    }
    return viaCellIds
  }

  private tryLastConnectionFallback(seg: ConnectionSeg) {
    const profileStart = this.enableProfiling ? performance.now() : 0
    const stateCount = this.layers * this.planeSize
    const gScore = new Float64Array(stateCount)
    gScore.fill(Number.POSITIVE_INFINITY)
    const parent = new Int32Array(stateCount).fill(-1)
    const closed = new Uint8Array(stateCount)
    const heap = new TypedMinHeap()
    const startIdx = seg.startZ * this.planeSize + seg.startCellId
    const endIdx = seg.endZ * this.planeSize + seg.endCellId
    let seq = 0

    gScore[startIdx] = 0
    heap.push(
      this.computeH(seg.startZ, seg.startCellId, seg.endZ, seg.endCellId),
      seq++,
      startIdx,
    )

    while (heap.size > 0) {
      const stateIdx = heap.pop()
      if (closed[stateIdx]) continue
      closed[stateIdx] = 1

      if (stateIdx === endIdx) break

      const z = Math.floor(stateIdx / this.planeSize)
      const cellId = stateIdx - z * this.planeSize
      const baseG = gScore[stateIdx]!
      const neighborStart = this.neighborOffset[cellId]!
      const neighborEnd = this.neighborOffset[cellId + 1]!

      for (let i = neighborStart; i < neighborEnd; i++) {
        const neighborCellId = this.neighborIds[i]!
        const nextIdx = z * this.planeSize + neighborCellId
        if (closed[nextIdx]) continue
        if (
          !this.canUseFallbackState(this.activeConnId, z, neighborCellId, seg)
        ) {
          continue
        }

        const nextG =
          baseG + this.neighborCosts[i]! + this.penalty2d[neighborCellId]!
        if (nextG >= gScore[nextIdx]!) continue
        gScore[nextIdx] = nextG
        parent[nextIdx] = stateIdx
        heap.push(
          nextG + this.computeH(z, neighborCellId, seg.endZ, seg.endCellId),
          seq++,
          nextIdx,
        )
      }

      if (!this.viaAllowed[cellId]) continue

      for (let nz = 0; nz < this.layers; nz++) {
        if (nz === z) continue
        const nextIdx = nz * this.planeSize + cellId
        if (closed[nextIdx]) continue
        if (!this.canUseFallbackState(this.activeConnId, nz, cellId, seg)) {
          continue
        }

        const nextG =
          baseG + this.hyperParameters.viaBaseCost + this.penalty2d[cellId]!
        if (nextG >= gScore[nextIdx]!) continue
        gScore[nextIdx] = nextG
        parent[nextIdx] = stateIdx
        heap.push(
          nextG + this.computeH(nz, cellId, seg.endZ, seg.endCellId),
          seq++,
          nextIdx,
        )
      }
    }

    if (!closed[endIdx]) return false

    const states: number[] = []
    let cur = endIdx
    while (cur >= 0) {
      states.push(cur)
      cur = parent[cur] ?? -1
    }
    states.reverse()
    const viaCellIds = this.extractViaCellIds(states)

    this.consecutiveSkips = Math.max(0, this.consecutiveSkips - 1)
    const deferRipup =
      this.enableDeferredConflictRepair && this.unsolvedSegs.length <= 1
    this.commitRoute(this.activeConnId, states, [], viaCellIds, deferRipup)
    if (this.enableProfiling) {
      this.profileData.fallbackMs += performance.now() - profileStart
    }
    return true
  }

  private tryDeferredConflictRepair() {
    if (
      !this.enableDeferredConflictRepair ||
      this.postSolveRepairPasses >= this.maxDeferredRepairPasses
    ) {
      return false
    }
    const profileStart = this.enableProfiling ? performance.now() : 0
    if (this.deferredConflictConnIds.length === 0) {
      for (let connId = 0; connId < this.solvedRoutes.length; connId++) {
        const route = this.solvedRoutes[connId]
        if (!route) continue

        for (let i = 0; i < route.states.length; i++) {
          const state = route.states[i]!
          const z = Math.floor(state / this.planeSize)
          const cellId = state - z * this.planeSize
          const existing = this.usedCellsFlat[state]!
          if (
            existing !== -1 &&
            existing !== connId &&
            !this.allowSharedUse(connId, existing)
          ) {
            this.recordDeferredConflict(connId, existing, cellId)
          }

          const keepoutStart = this.traceKeepoutOffset[cellId]!
          const keepoutEnd = this.traceKeepoutOffset[cellId + 1]!
          const zBase = z * this.planeSize
          for (let j = keepoutStart; j < keepoutEnd; j++) {
            const occCellId = this.traceKeepoutIds[j]!
            const occ = this.usedCellsFlat[zBase + occCellId]!
            if (
              occ !== -1 &&
              occ !== connId &&
              !this.allowSharedUse(connId, occ)
            ) {
              this.recordDeferredConflict(connId, occ, cellId)
            }
          }
        }

        for (let i = 0; i < route.viaCellIds.length; i++) {
          const viaCellId = route.viaCellIds[i]!
          const footprintStart = this.viaFootprintOffset[viaCellId]!
          const footprintEnd = this.viaFootprintOffset[viaCellId + 1]!
          for (let z = 0; z < this.layers; z++) {
            const zBase = z * this.planeSize
            for (let j = footprintStart; j < footprintEnd; j++) {
              const occCellId = this.viaFootprintIds[j]!
              const occ = this.usedCellsFlat[zBase + occCellId]!
              if (
                occ !== -1 &&
                occ !== connId &&
                !this.allowSharedUse(connId, occ)
              ) {
                this.recordDeferredConflict(connId, occ, viaCellId)
              }
            }
          }
        }
      }
    }

    if (this.deferredConflictConnIds.length === 0) {
      if (this.enableProfiling) {
        this.profileData.repairMs += performance.now() - profileStart
      }
      return false
    }

    const penaltyBoost = 10 + this.postSolveRepairPasses * 2
    for (let i = 0; i < this.deferredPenaltyCellIds.length; i++) {
      const cellId = this.deferredPenaltyCellIds[i]!
      this.penalty2d[cellId] = this.penalty2d[cellId]! + penaltyBoost
    }

    for (let i = 0; i < this.deferredConflictConnIds.length; i++) {
      const connId = this.deferredConflictConnIds[i]!
      this.ripTrace(connId)
    }

    this.postSolveRepairPasses++
    this.consecutiveSkips = 0
    this.clearDeferredConflictScratch()
    if (this.enableProfiling) {
      this.profileData.repairMs += performance.now() - profileStart
      this.profileData.repairs++
    }
    return true
  }

  private canUseFallbackState(
    activeConn: ConnId,
    z: number,
    cellId: number,
    seg: ConnectionSeg,
  ) {
    const flatIdx = z * this.planeSize + cellId
    const fixedOwner = this.portOwnerFlat[flatIdx]!
    const fixedSameRoot =
      this.connIdToRootNet[fixedOwner] === this.connIdToRootNet[activeConn]
    const allowFixedOverlap =
      fixedSameRoot &&
      this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
    const isSegEnd = z === seg.endZ && cellId === seg.endCellId
    return (
      fixedOwner < 0 ||
      fixedOwner === activeConn ||
      allowFixedOverlap ||
      isSegEnd
    )
  }

  private ripTrace(connId: ConnId): void {
    while (this.ripCount.length <= connId) this.ripCount.push(0)
    this.ripCount[connId]!++
    this.totalRipEvents++

    const route = this.solvedRoutes[connId]
    if (route) {
      for (let i = 0; i < route.states.length; i++) {
        const state = route.states[i]!
        const cellId = state % this.planeSize
        this.penalty2d[cellId] =
          this.penalty2d[cellId]! + this.hyperParameters.ripTracePenalty
      }
      for (let i = 0; i < route.viaCellIds.length; i++) {
        const cellId = route.viaCellIds[i]!
        this.penalty2d[cellId] =
          this.penalty2d[cellId]! + this.hyperParameters.ripViaPenalty
      }
    }

    const indices = this.usedIndicesByConn[connId]
    if (indices) {
      for (let i = 0; i < indices.length; i++) {
        const flatIdx = indices[i]!
        if (this.usedCellsFlat[flatIdx] === connId) {
          this.usedCellsFlat[flatIdx] = -1
        }
      }
      this.usedIndicesByConn[connId] = undefined
    }

    if (route) {
      this.solvedRoutes[connId] = undefined
      const first = route.states[0]!
      const last = route.states[route.states.length - 1]!
      const startZ = Math.floor(first / this.planeSize)
      const endZ = Math.floor(last / this.planeSize)
      this.unsolvedSegs.push({
        connId,
        startZ,
        startCellId: first - startZ * this.planeSize,
        endZ,
        endCellId: last - endZ * this.planeSize,
      })
    }
  }

  private recordDeferredConflict(
    connId: ConnId,
    existingConn: ConnId,
    penaltyCellId: number,
  ) {
    if (!this.enableDeferredConflictRepair) return
    if (existingConn < 0 || existingConn === connId) return

    const conflictStamp = this.deferredConflictStamp
    if (this.deferredConflictStampByConn[connId] !== conflictStamp) {
      this.deferredConflictStampByConn[connId] = conflictStamp
      this.deferredConflictConnIds.push(connId)
    }
    if (this.deferredConflictStampByConn[existingConn] !== conflictStamp) {
      this.deferredConflictStampByConn[existingConn] = conflictStamp
      this.deferredConflictConnIds.push(existingConn)
    }

    const penaltyStamp = this.deferredPenaltyStamp
    if (this.deferredPenaltyStampByCell[penaltyCellId] !== penaltyStamp) {
      this.deferredPenaltyStampByCell[penaltyCellId] = penaltyStamp
      this.deferredPenaltyCellIds.push(penaltyCellId)
    }
  }

  private clearDeferredConflictScratch() {
    this.deferredConflictConnIds.length = 0
    this.deferredPenaltyCellIds.length = 0
    this.deferredConflictStamp = (this.deferredConflictStamp + 1) >>> 0
    if (this.deferredConflictStamp === 0) {
      this.deferredConflictStampByConn.fill(0)
      this.deferredConflictStamp = 1
    }
    this.deferredPenaltyStamp = (this.deferredPenaltyStamp + 1) >>> 0
    if (this.deferredPenaltyStamp === 0) {
      this.deferredPenaltyStampByCell.fill(0)
      this.deferredPenaltyStamp = 1
    }
  }

  private flattenNeighborLists(neighbors: NeighborEdge[][]) {
    const offset = new Int32Array(neighbors.length + 1)
    let total = 0
    for (let i = 0; i < neighbors.length; i++) {
      offset[i] = total
      total += neighbors[i]!.length
    }
    offset[neighbors.length] = total

    const ids = new Int32Array(total)
    const costs = new Float32Array(total)
    let cursor = 0
    for (let i = 0; i < neighbors.length; i++) {
      const edges = neighbors[i]!
      for (let j = 0; j < edges.length; j++) {
        const edge = edges[j]!
        ids[cursor] = edge.cellId
        costs[cursor] = edge.cost
        cursor++
      }
    }

    return { offset, ids, costs }
  }

  private flattenIndexLists(lists: number[][]) {
    const offset = new Int32Array(lists.length + 1)
    let total = 0
    for (let i = 0; i < lists.length; i++) {
      offset[i] = total
      total += lists[i]!.length
    }
    offset[lists.length] = total

    const ids = new Int32Array(total)
    let cursor = 0
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i]!
      for (let j = 0; j < list.length; j++) {
        ids[cursor++] = list[j]!
      }
    }
    return { offset, ids }
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

    rects.push({
      center: {
        x: this.nodeWithPortPoints.center.x,
        y: this.nodeWithPortPoints.center.y,
      },
      width: this.nodeWithPortPoints.width,
      height: this.nodeWithPortPoints.height,
      stroke: "gray",
    })

    if (this.showPenaltyMap && this.penalty2d) {
      let maxPenalty = 0
      for (let i = 0; i < this.penalty2d.length; i++) {
        if (this.penalty2d[i]! > maxPenalty) maxPenalty = this.penalty2d[i]!
      }
      if (maxPenalty > 0) {
        for (const cell of this.cells) {
          const penalty = this.penalty2d[cell.id]!
          if (penalty <= 0) continue
          const alpha = Math.min(0.6, (penalty / maxPenalty) * 0.6)
          rects.push({
            center: { x: cell.centerX, y: cell.centerY },
            width: cell.width,
            height: cell.height,
            fill: `rgba(255,165,0,${alpha.toFixed(3)})`,
          })
        }
      }
    }

    if (this.showUsedCellMap && this.usedCellsFlat) {
      for (let z = 0; z < this.layers; z++) {
        const zBase = z * this.planeSize
        for (const cell of this.cells) {
          const occ = this.usedCellsFlat[zBase + cell.id]!
          if (occ === -1) continue
          rects.push({
            center: { x: cell.centerX, y: cell.centerY },
            width: cell.width,
            height: cell.height,
            fill: "rgba(0,0,255,0.5)",
          })
        }
      }
    }

    for (const pp of this.nodeWithPortPoints.portPoints) {
      points.push({
        x: pp.x,
        y: pp.y,
        color: LAYER_COLORS[pp.z] ?? "gray",
        label: pp.connectionName,
      })
    }

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
          points: route.route.slice(segStart).map((p) => ({ x: p.x, y: p.y })),
          strokeColor: TRACE_COLORS[lastZ] ?? "rgba(128,128,128,0.75)",
          strokeWidth: this.traceThickness,
        })
      }
    }

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

    if (this.activeConnSeg && this.visitedStamp) {
      const currentStamp = this.stamp
      for (let z = 0; z < this.layers; z++) {
        const zBase = z * this.planeSize
        for (const cell of this.cells) {
          if (this.visitedStamp[zBase + cell.id] !== currentStamp) continue
          points.push({
            x: cell.centerX,
            y: cell.centerY,
            color: "rgba(0,0,255,0.2)",
          })
        }
      }
    }

    return {
      points,
      lines,
      circles,
      rects,
      coordinateSystem: "cartesian" as const,
      title: `HighDensityA02 [${this.getSolvedRouteCount()} solved, ${this.unsolvedSegs?.length ?? 0} remaining]`,
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const result: HighDensityIntraNodeRoute[] = []

    for (let connId = 0; connId < this.solvedRoutes.length; connId++) {
      const route = this.solvedRoutes[connId]
      if (!route) continue
      const connName = this.connIdToName[connId]!
      result.push({
        connectionName: connName,
        traceThickness: this.traceThickness,
        viaDiameter: this.viaDiameter,
        route: Array.from(route.states, (state) => {
          const z = Math.floor(state / this.planeSize)
          const cellId = state - z * this.planeSize
          const cell = this.cells[cellId]!
          return {
            x: cell.centerX,
            y: cell.centerY,
            z: this.layerToZ.get(z) ?? z,
          }
        }),
        vias: Array.from(route.viaCellIds, (cellId) => {
          const cell = this.cells[cellId]!
          return { x: cell.centerX, y: cell.centerY }
        }),
      })
    }

    return result
  }

  private getSolvedRouteCount() {
    let count = 0
    for (let i = 0; i < this.solvedRoutes.length; i++) {
      if (this.solvedRoutes[i]) count++
    }
    return count
  }
}

function pushUniqueNeighbor(arr: NeighborEdge[], edge: NeighborEdge) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]!.cellId === edge.cellId) return
  }
  arr.push(edge)
}
