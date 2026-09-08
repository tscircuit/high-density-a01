import { BaseSolver } from "@tscircuit/solver-utils"
import { getConnectionPortPointPairs } from "../getConnectionPortPointPairs"
import {
  type AffineTransform,
  applyAffineTransformToPoint,
  computeGridToAffineTransform,
} from "../gridToAffineTransform"
import { computeMaxIterationsByNodeSizeAndConnectionCount } from "../maxIterationsByNodeSizeAndConnectionCount"
import {
  canRunNativeA01Search,
  NativeA01SearchKernel,
  type NativeA01SearchInput,
} from "../native-search/NativeA01SearchKernel"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../types"

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

// Numeric search state is reused across connections without allocating a node object.
class SearchNodePool {
  // Flat cell IDs can exceed signed 32-bit range even when each coordinate
  // fits, so retain the Number domain used by grid indexing.
  cellIdx = new Float64Array(1024)
  g = new Float64Array(1024)
  parentIdx = new Int32Array(1024)
  ripped: Array<RippedNode | null> = []
  length = 0

  clear(): void {
    this.length = 0
    this.ripped.length = 0
  }

  push(
    cellIdx: number,
    g: number,
    parentIdx: number,
    ripped: RippedNode | null,
  ): number {
    this.ensureCapacity(this.length + 1)
    const index = this.length++
    this.cellIdx[index] = cellIdx
    this.g[index] = g
    this.parentIdx[index] = parentIdx
    this.ripped[index] = ripped
    return index
  }

  private ensureCapacity(size: number): void {
    if (size <= this.cellIdx.length) return
    let next = this.cellIdx.length
    while (next < size) next *= 2
    const cellIdx = new Float64Array(next)
    cellIdx.set(this.cellIdx)
    this.cellIdx = cellIdx
    const g = new Float64Array(next)
    g.set(this.g)
    this.g = g
    const parentIdx = new Int32Array(next)
    parentIdx.set(this.parentIdx)
    this.parentIdx = parentIdx
  }
}

// --- Connection segment ---
interface ConnectionSeg {
  connId: ConnId
  startZ: number
  startRow: number
  startCol: number
  startPoint: { x: number; y: number; z: number }
  endZ: number
  endRow: number
  endCol: number
  endPoint: { x: number; y: number; z: number }
}

// --- Internal solved route (cell-based) ---
interface SolvedRouteInternal {
  connId: ConnId
  startZ: number
  startRow: number
  startCol: number
  startPoint: { x: number; y: number; z: number }
  endZ: number
  endRow: number
  endCol: number
  endPoint: { x: number; y: number; z: number }
  cells: Array<{ z: number; row: number; col: number }>
  viaCells: Array<{ row: number; col: number }>
}

interface CircularGridOffsets {
  rowOffsets: Int32Array
  columnOffsets: Int32Array
  length: number
}

function createCircularGridOffsets(params: {
  radiusMm: number
  cellSizeMm: number
}): CircularGridOffsets {
  const radiusCellRatio = params.radiusMm / params.cellSizeMm
  const nearestRadiusCellCount = Math.round(radiusCellRatio)
  const radiusCells =
    Math.abs(radiusCellRatio - nearestRadiusCellCount) <= 1e-9
      ? nearestRadiusCellCount
      : Math.ceil(radiusCellRatio)
  const radiusCellsSquared = radiusCells * radiusCells
  const rowOffsets: number[] = []
  const columnOffsets: number[] = []

  for (let rowOffset = -radiusCells; rowOffset <= radiusCells; rowOffset++) {
    for (
      let columnOffset = -radiusCells;
      columnOffset <= radiusCells;
      columnOffset++
    ) {
      if (
        rowOffset * rowOffset + columnOffset * columnOffset <=
        radiusCellsSquared
      ) {
        rowOffsets.push(rowOffset)
        columnOffsets.push(columnOffset)
      }
    }
  }

  return {
    rowOffsets: new Int32Array(rowOffsets),
    columnOffsets: new Int32Array(columnOffsets),
    length: rowOffsets.length,
  }
}

// --- Min-heap for A* open set ---
class MinHeap {
  private f = new Float64Array(1024)
  private id = new Int32Array(1024)
  private n = 0

  // Nodes are enqueued once, immediately after allocation. Their pool index is
  // the insertion order, so equal priorities need no separate sequence array.
  push(f: number, id: number): void {
    this.ensureCapacity(this.n + 1)
    // Move parents into the hole, then write the new tuple once.
    let i = this.n++
    while (i > 0) {
      const p = (i - 1) >> 1
      const parentF = this.f[p]!
      const parentId = this.id[p]!
      if (parentF !== f ? parentF < f : parentId < id) break
      this.f[i] = parentF
      this.id[i] = parentId
      i = p
    }
    this.f[i] = f
    this.id[i] = id
  }

  pop(): number {
    const out = this.id[0]!
    this.n--
    if (this.n > 0) {
      const f = this.f[this.n]!
      const id = this.id[this.n]!
      let i = 0
      while (true) {
        const left = i * 2 + 1
        if (left >= this.n) break
        const right = left + 1
        let child = left
        if (right < this.n) {
          const leftF = this.f[left]!
          const rightF = this.f[right]!
          if (
            !(leftF !== rightF
              ? leftF < rightF
              : this.id[left]! < this.id[right]!)
          ) {
            child = right
          }
        }
        const childF = this.f[child]!
        const childId = this.id[child]!
        if (f !== childF ? f < childF : id < childId) break
        this.f[i] = childF
        this.id[i] = childId
        i = child
      }
      this.f[i] = f
      this.id[i] = id
    }
    return out
  }

  get size(): number {
    return this.n
  }

  clear(): void {
    this.n = 0
  }

  private ensureCapacity(size: number): void {
    if (size <= this.f.length) return
    let next = this.f.length
    while (next < size) next *= 2
    const f = new Float64Array(next)
    f.set(this.f)
    this.f = f
    const id = new Int32Array(next)
    id.set(this.id)
    this.id = id
  }
}

// --- Types ---
interface HyperParameters {
  shuffleSeed: number
  ripCost: number
  ripTracePenalty: number
  ripViaPenalty: number
  viaBaseCost: number
  greedyMultiplier: number
}

function toRootNetName(
  connectionName: string,
  rootConnectionName?: string,
): string {
  return rootConnectionName ?? connectionName.replace(/_mst\d+$/, "")
}

export interface HighDensitySolverA01Props {
  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm: number
  viaDiameter: number
  maxCellCount?: number
  stepMultiplier?: number
  /** Opt in to the exact WASM search kernel. Grid/occupancy stay fixed during
   * each connection search; numeric move costs remain live between steps.
   * Unsupported domains or unavailable WASM use JS before search begins. */
  useNativeSearch?: boolean
  traceThickness?: number
  traceMargin?: number
  viaMinDistFromBorder?: number
  showPenaltyMap?: boolean
  showUsedCellMap?: boolean
  effort?: number
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
  override getSolverName(): string {
    return "HighDensitySolverA01"
  }

  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm: number
  viaDiameter: number
  MAX_RIPS: number
  maxCellCount?: number
  traceThickness: number
  traceMargin: number
  viaMinDistFromBorder: number
  showPenaltyMap: boolean
  showUsedCellMap: boolean
  effort: number
  stepMultiplier: number
  useNativeSearch: boolean
  hyperParameters: HyperParameters
  initialPenaltyFn?: HighDensitySolverA01Props["initialPenaltyFn"]
  protected useExactViaTraceClearance = false
  protected ripHistoryCostMultiplier = 0

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
  private connIdToRootNet!: string[]
  private overlapFriendlyRootNets!: Set<string>

  // --- Flat arrays ---
  private planeSize!: number // rows * cols
  private usedCellsFlat!: Int32Array // layers * planeSize; -1 = empty
  private portOwnerFlat!: Int32Array // layers * planeSize; -1 = none, -2 = shared
  private usedDiagFlat!: Int32Array // layers * (rows-1) * (cols-1) * 2; -1 = empty
  private penalty2d!: Float64Array // planeSize
  private visitedStamp!: Uint32Array
  private heuristicStamp!: Uint32Array
  private weightedHeuristicValue!: Float64Array // layers * planeSize
  private sharedCrossRootPortCells!: Set<number>
  private stamp = 0

  // --- Precomputed via footprint offsets ---
  private viaOccupantScanOffsetsDr!: Int32Array
  private viaOccupantScanOffsetsDc!: Int32Array
  private viaOccupantScanOffsetsLen!: number
  private viaOwnersByCell!: Map<number, Set<ConnId>>
  private viaCenterIndicesByConn!: number[][]
  private viaTraceClearanceMm!: number
  private outputCellStepX!: number
  private outputCellStepY!: number

  // --- Via zone boundaries (cell coordinates) ---
  private minViaRow!: number
  private maxViaRow!: number
  private minViaCol!: number
  private maxViaCol!: number

  // --- Per-connection used-cell tracking ---
  private usedIndicesByConn!: number[][] // connId -> [flatCellIdx, ...]
  private usedDiagIndicesByConn!: number[][] // connId -> [flatDiagIdx, ...]

  // --- Connection queues ---
  private unsolvedSegs!: ConnectionSeg[]
  private solvedRoutes!: Map<ConnId, SolvedRouteInternal[]>

  // --- A* state ---
  private activeConnSeg: ConnectionSeg | null = null
  private activeConnId: ConnId = -1
  private crossLayerSearch = false
  private nodePool!: SearchNodePool
  private heap!: MinHeap
  private nativeSearchKernel: NativeA01SearchKernel | null = null
  private nativeSearchForActiveConnection = false
  private nativeOpenSetLength: number | null = null
  private nativeStepCount = 0
  private nativeBatchedStepCount = 0

  // --- Reusable scratch for via occupant scan ---
  private _viaOccs: ConnId[] = []
  private viaOccupantsByCell = new Map<number, ConnId[]>()
  private viaScanFlatOffsets: Int32Array | null = null
  private viaScanRadius = 0
  private rootOverlapAllowed = new Uint8Array(0)

  // --- Convergence state ---
  private ripCount!: number[]
  private totalRipEvents = 0
  private searchIterations = 0
  private consecutiveSkips = 0
  private penaltyCap!: number
  private baseSearchBudgetIters!: number
  private searchBudgetIters = 0

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
    return { length: this.nativeOpenSetLength ?? this.heap?.size ?? 0 }
  }
  get nativeSearchActive(): boolean {
    return this.nativeSearchForActiveConnection
  }
  get nativeSearchSteps(): number {
    return this.nativeStepCount
  }
  get nativeSearchBatchedSteps(): number {
    return this.nativeBatchedStepCount
  }
  get gridStats() {
    return {
      cells: this.planeSize || 0,
      layers: this.layers || 0,
      states: (this.planeSize || 0) * (this.layers || 0),
    }
  }

  constructor(props: HighDensitySolverA01Props) {
    super()
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.cellSizeMm = props.cellSizeMm
    this.viaDiameter = props.viaDiameter
    this.maxCellCount = props.maxCellCount
    this.traceThickness = props.traceThickness ?? 0.1
    this.traceMargin = props.traceMargin ?? 0.15
    this.viaMinDistFromBorder = props.viaMinDistFromBorder ?? 0.15
    this.showPenaltyMap = props.showPenaltyMap ?? false
    this.showUsedCellMap = props.showUsedCellMap ?? false
    this.effort = props.effort ?? 1
    this.stepMultiplier = Math.max(1, Math.floor(props.stepMultiplier ?? 1))
    this.useNativeSearch = props.useNativeSearch ?? false
    this.hyperParameters = {
      shuffleSeed: 0,
      ripCost: 10,
      ripTracePenalty: 0.5,
      ripViaPenalty: 0.75,
      viaBaseCost: 0.1,
      greedyMultiplier: 1.5,
      ...props.hyperParameters,
    }
    this.MAX_ITERATIONS = 100e6
    this.MAX_RIPS = 200
    this.initialPenaltyFn = props.initialPenaltyFn
  }

  override getConstructorParams(): [HighDensitySolverA01Props] {
    return [
      {
        nodeWithPortPoints: this.nodeWithPortPoints,
        cellSizeMm: this.cellSizeMm,
        viaDiameter: this.viaDiameter,
        maxCellCount: this.maxCellCount,
        stepMultiplier: this.stepMultiplier,
        useNativeSearch: this.useNativeSearch,
        traceThickness: this.traceThickness,
        traceMargin: this.traceMargin,
        viaMinDistFromBorder: this.viaMinDistFromBorder,
        showPenaltyMap: this.showPenaltyMap,
        showUsedCellMap: this.showUsedCellMap,
        effort: this.effort,
        hyperParameters: this.hyperParameters,
        initialPenaltyFn: this.initialPenaltyFn,
      },
    ]
  }

  override _setup(): void {
    this.nativeSearchKernel?.release()
    this.nativeSearchKernel = null
    this.nativeSearchForActiveConnection = false
    this.nativeOpenSetLength = null
    this.nativeStepCount = 0
    this.nativeBatchedStepCount = 0
    this.viaScanFlatOffsets = null
    const { nodeWithPortPoints, cellSizeMm } = this
    const { width, height, center } = nodeWithPortPoints

    // Z layers
    this.availableZ =
      nodeWithPortPoints.availableZ ??
      [...new Set(nodeWithPortPoints.portPoints.map((pp) => pp.z))].sort(
        (a, b) => a - b,
      )

    this.rows = Math.floor(height / cellSizeMm)
    this.cols = Math.floor(width / cellSizeMm)
    this.layers = this.availableZ.length
    this.planeSize = this.rows * this.cols
    const totalCells = this.layers * this.planeSize
    if (this.maxCellCount !== undefined && totalCells > this.maxCellCount) {
      this.error = `Cell count ${totalCells} exceeds maxCellCount ${this.maxCellCount}`
      this.failed = true
      return
    }
    const totalDiags =
      this.layers * Math.max(0, this.rows - 1) * Math.max(0, this.cols - 1) * 2

    this.zToLayer = new Map()
    this.layerToZ = new Map()
    for (let i = 0; i < this.availableZ.length; i++) {
      const z = this.availableZ[i]!
      this.zToLayer.set(z, i)
      this.layerToZ.set(i, z)
    }

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
    this.outputCellStepX = this.cols > 1 ? width / (this.cols - 1) : width
    this.outputCellStepY = this.rows > 1 ? height / (this.rows - 1) : height

    // Intern connections
    this.connNameToId = new Map()
    this.connIdToName = []
    this.connIdToRootNet = []
    this.overlapFriendlyRootNets = new Set()

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
    this.portOwnerFlat = new Int32Array(totalCells).fill(-1)
    this.usedDiagFlat = new Int32Array(totalDiags).fill(-1)

    // Visited stamp array (Uint32Array is zero-initialized)
    this.visitedStamp = new Uint32Array(totalCells)
    this.heuristicStamp = new Uint32Array(totalCells)
    this.weightedHeuristicValue = new Float64Array(totalCells)
    this.stamp = 0

    // Existing traces already occupy their traceMargin halo, so a prospective
    // via only needs to scan its own copper radius around that occupancy.
    const viaOccupantScanOffsets = createCircularGridOffsets({
      radiusMm: this.viaDiameter / 2,
      cellSizeMm,
    })
    this.viaOccupantScanOffsetsLen = viaOccupantScanOffsets.length
    this.viaOccupantScanOffsetsDr = viaOccupantScanOffsets.rowOffsets
    this.viaOccupantScanOffsetsDc = viaOccupantScanOffsets.columnOffsets
    this.viaOwnersByCell = new Map()
    this.viaCenterIndicesByConn = []
    this.viaTraceClearanceMm = this.viaDiameter / 2 + this.traceThickness / 2

    // Precompute via zone boundaries
    if (this.viaMinDistFromBorder > 0) {
      const borderCells = Math.ceil(this.viaMinDistFromBorder / cellSizeMm)
      this.minViaRow = borderCells
      this.maxViaRow = this.rows - 1 - borderCells
      this.minViaCol = borderCells
      this.maxViaCol = this.cols - 1 - borderCells
    } else {
      this.minViaRow = 0
      this.maxViaRow = this.rows - 1
      this.minViaCol = 0
      this.maxViaCol = this.cols - 1
    }

    // Build and shuffle connections
    this.unsolvedSegs = this.buildConnectionSegs()

    this.sharedCrossRootPortCells = new Set()
    const rootByPortFlat = new Map<number, string>()
    for (const pp of this.nodeWithPortPoints.portPoints) {
      const connId = this.connNameToId.get(pp.connectionName)
      if (connId === undefined) continue
      const cell = this.pointToCell(pp)
      const flatIdx = (cell.z * this.rows + cell.row) * this.cols + cell.col
      const rootNet = this.connIdToRootNet[connId]!
      const existingRoot = rootByPortFlat.get(flatIdx)
      if (existingRoot === undefined) {
        rootByPortFlat.set(flatIdx, rootNet)
      } else if (existingRoot !== rootNet) {
        this.sharedCrossRootPortCells.add(flatIdx)
      }
      const existing = this.portOwnerFlat[flatIdx]!
      if (existing === -1 || existing === connId) {
        this.portOwnerFlat[flatIdx] = connId
      } else {
        this.portOwnerFlat[flatIdx] = -2
      }
    }
    this.solvedRoutes = new Map()
    this.usedIndicesByConn = []
    this.usedDiagIndicesByConn = []
    this.ripCount = []
    this.consecutiveSkips = 0
    this.penaltyCap = this.hyperParameters.ripCost * 0.5
    this.shuffleConnections()
    const budget = computeMaxIterationsByNodeSizeAndConnectionCount({
      planeSize: this.planeSize,
      layers: this.layers,
      connectionCount: this.unsolvedSegs.length,
      effort: this.effort,
      maxIterations: this.MAX_ITERATIONS,
    })
    this.baseSearchBudgetIters = budget.baseSearchBudgetIters
    this.MAX_ITERATIONS = budget.maxIterationsIters

    // A* state
    this.activeConnSeg = null
    this.activeConnId = -1
    this.nodePool = new SearchNodePool()
    this.heap = new MinHeap()
  }

  /** Consume only ordinary nonterminal native steps. The caller must use step()
   * when this returns zero, and re-read its scheduling limits after that call. */
  stepNativeBatch(maxSteps: number): number {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) return 0
    // Inspect descriptors first: checking a getter's value would already change
    // the conditional read counts of the ordinary step path.
    const ownData = (name: string, writable = false): boolean => {
      const descriptor = Object.getOwnPropertyDescriptor(this, name)
      return (
        !!descriptor &&
        "value" in descriptor &&
        (!writable || descriptor.writable === true)
      )
    }
    for (const name of [
      "iterations",
      "searchIterations",
      "nativeStepCount",
      "nativeBatchedStepCount",
      "nativeOpenSetLength",
      "failed",
      "error",
    ]) {
      if (!ownData(name, true)) return 0
    }
    for (const name of [
      "_setupDone",
      "solved",
      "MAX_ITERATIONS",
      "stepMultiplier",
      "searchBudgetIters",
      "nativeSearchForActiveConnection",
      "nativeSearchKernel",
      "hyperParameters",
      "cellSizeMm",
      "penaltyCap",
    ]) {
      if (!ownData(name)) return 0
    }
    const dataProperty = (object: object, name: string): boolean => {
      for (
        let current: object | null = object;
        current;
        current = Object.getPrototypeOf(current)
      ) {
        const descriptor = Object.getOwnPropertyDescriptor(current, name)
        if (descriptor) return "value" in descriptor
      }
      return false
    }
    for (const name of [
      "step",
      "_step",
      "stepOnce",
      "advanceNativeSearch",
      "tryFinalAcceptance",
    ]) {
      if (!dataProperty(this, name)) return 0
    }
    const original = HighDensitySolverA01.prototype
    if (
      this.step !== BaseSolver.prototype.step ||
      this._step !== original._step ||
      this.stepOnce !== original.stepOnce ||
      this.advanceNativeSearch !== original.advanceNativeSearch ||
      this.tryFinalAcceptance !== BaseSolver.prototype.tryFinalAcceptance ||
      "computeProgress" in this ||
      !this._setupDone ||
      this.solved ||
      this.failed ||
      this.stepMultiplier !== 1 ||
      !this.nativeSearchForActiveConnection ||
      !this.nativeSearchKernel
    )
      return 0
    const hp = this.hyperParameters
    for (const name of [
      "viaBaseCost",
      "ripCost",
      "ripTracePenalty",
      "ripViaPenalty",
      "greedyMultiplier",
    ]) {
      if (!dataProperty(hp, name)) return 0
    }
    for (const value of [
      this.iterations,
      this.MAX_ITERATIONS,
      this.searchIterations,
      this.searchBudgetIters,
      this.nativeStepCount,
      this.nativeBatchedStepCount,
    ]) {
      if (!Number.isSafeInteger(value) || value < 0) return 0
    }
    const limit = Math.min(
      maxSteps,
      0xffff_ffff,
      this.MAX_ITERATIONS - this.iterations - 1,
      this.searchBudgetIters - this.searchIterations,
      Number.MAX_SAFE_INTEGER - this.nativeStepCount,
      Number.MAX_SAFE_INTEGER - this.nativeBatchedStepCount,
    )
    if (limit < 1) return 0
    const kernel = this.nativeSearchKernel
    let completed: number
    try {
      completed = kernel.advanceMany(
        limit,
        this.cellSizeMm,
        hp,
        this.penaltyCap,
      )
    } catch (error) {
      // BaseSolver increments before _step; a throwing native advance does not
      // increment nativeStepCount or publish its partially changed heap length.
      this.iterations += kernel.lastBatchAttempts
      this.searchIterations += kernel.lastBatchAttempts
      this.nativeStepCount += kernel.lastBatchCompleted
      this.nativeBatchedStepCount += kernel.lastBatchCompleted
      this.nativeOpenSetLength = kernel.heapSize
      this.error = `${this.getSolverName()} error: ${error}`
      this.failed = true
      throw error
    }
    this.iterations += completed
    this.searchIterations += completed
    this.nativeStepCount += completed
    this.nativeBatchedStepCount += completed
    this.nativeOpenSetLength = kernel.heapSize
    return completed
  }

  override _step(): void {
    for (let i = 0; i < this.stepMultiplier; i++) {
      if (this.solved || this.failed) break
      this.stepOnce()
    }
    if (this.solved || this.failed || this.iterations >= this.MAX_ITERATIONS) {
      this.viaOccupantsByCell.clear()
      if (this.nativeSearchForActiveConnection) {
        this.nativeSearchKernel!.copyVisitedTo(this.visitedStamp)
      }
      // Debug/heap state stays in TS. Relinquish this terminal owner before its
      // instance is reused; oversized instances are released for GC instead.
      this.nativeSearchForActiveConnection = false
      this.nativeSearchKernel?.release()
      this.nativeSearchKernel = null
    }
  }

  private stepOnce(): void {
    // 1. If no active connection, dequeue next
    if (!this.activeConnSeg) {
      if (this.unsolvedSegs.length === 0) {
        this.solved = true
        return
      }
      const next = this.unsolvedSegs.shift()!
      this.activeConnSeg = next
      this.activeConnId = next.connId
      this.crossLayerSearch = next.startZ !== next.endZ

      // Reset A* state for this connection
      this.nodePool.clear()
      this.heap.clear()
      this.searchIterations = 0
      this.nextStamp()
      this.nativeSearchForActiveConnection = false
      this.nativeOpenSetLength = null
      if (this.tryBeginNativeSearch(next)) return

      // Push start node
      const startFlatIdx =
        (next.startZ * this.rows + next.startRow) * this.cols + next.startCol
      const f = this.getCachedWeightedH(
        startFlatIdx,
        next.startZ,
        next.startRow,
        next.startCol,
        next.endZ,
        next.endRow,
        next.endCol,
      )
      this.nodePool.push(startFlatIdx, 0, -1, null)
      this.heap.push(f, 0)
      return
    }

    // 2. Per-search budget check
    this.searchIterations++
    if (this.searchIterations > this.searchBudgetIters) {
      // Global penalty decay on budget-skip: gradually makes penalized zones
      // accessible to stuck connections without affecting non-skipping searches
      const pen = this.penalty2d
      for (let i = 0; i < pen.length; i++) {
        pen[i] = pen[i]! * 0.9
      }
      this.unsolvedSegs.push(this.activeConnSeg!)
      this.activeConnSeg = null
      this.activeConnId = -1
      this.heap.clear()
      this.nodePool.clear()
      if (this.nativeSearchForActiveConnection) {
        this.nativeSearchKernel!.clear()
        this.nativeSearchForActiveConnection = false
        this.nativeOpenSetLength = 0
      }
      this.consecutiveSkips++
      if (this.consecutiveSkips >= this.unsolvedSegs.length * 3) {
        this.error = `Convergence failure: ${this.unsolvedSegs.length} connections stuck`
        this.failed = true
      }
      return
    }

    if (this.nativeSearchForActiveConnection) {
      this.advanceNativeSearch()
      return
    }

    // 3. Open set empty → fail
    if (this.heap.size === 0) {
      this.error = `No path found for ${this.connIdToName[this.activeConnId]}`
      this.failed = true
      return
    }

    // 3. Pop best node (O(log n))
    const nodeIdx = this.heap.pop()
    const cellIdx = this.nodePool.cellIdx[nodeIdx]!

    // 4. Skip duplicates before decoding coordinates or loading move state.
    if (this.visitedStamp[cellIdx] === this.stamp) return
    this.visitedStamp[cellIdx] = this.stamp
    let z: number
    let row: number
    let col: number
    if (this.planeSize !== 0) {
      z = Math.floor(cellIdx / this.planeSize)
      const cellInPlane = cellIdx - z * this.planeSize
      row = Math.floor(cellInPlane / this.cols)
      col = cellInPlane - row * this.cols
    } else {
      // Sub-cell regions have no valid neighbors. Their sole start node
      // retains its coordinates even though the physical flat key loses them.
      z = this.activeConnSeg.startZ
      row = this.activeConnSeg.startRow
      col = this.activeConnSeg.startCol
    }
    const g = this.nodePool.g[nodeIdx]!
    const ripped = this.nodePool.ripped[nodeIdx]!

    // 5. Check end condition
    const seg = this.activeConnSeg
    if (z === seg.endZ && row === seg.endRow && col === seg.endCol) {
      this.finalizeRoute(nodeIdx)
      this.activeConnSeg = null
      this.activeConnId = -1
      return
    }

    // 6. Expand neighbors inline (no array allocation)
    const endZ = seg.endZ
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
      if (this._moveCost < 0) continue
      const g2 = g + this._moveCost
      const f2 =
        g2 + this.getCachedWeightedH(nIdx, z, nr, nc, endZ, endRow, endCol)

      const newNodeIdx = this.nodePool.push(nIdx, g2, nodeIdx, this._moveRipped)
      this.heap.push(f2, newNodeIdx)
    }

    // 6b. Via moves (to other layers at same position)
    const canVia =
      row >= this.minViaRow &&
      row <= this.maxViaRow &&
      col >= this.minViaCol &&
      col <= this.maxViaCol

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
        if (this._moveCost < 0) continue
        const g2 = g + this._moveCost
        const f2 =
          g2 + this.getCachedWeightedH(nIdx, nz, row, col, endZ, endRow, endCol)

        const newNodeIdx = this.nodePool.push(
          nIdx,
          g2,
          nodeIdx,
          this._moveRipped,
        )
        this.heap.push(f2, newNodeIdx)
      }
    }
  }

  // --- Merged cost + rip computation (writes to _moveCost/_moveRipped) ---
  protected getRipCost(connId: ConnId): number {
    return (
      this.hyperParameters.ripCost *
      (1 + this.ripHistoryCostMultiplier * (this.ripCount[connId] ?? 0))
    )
  }

  private tryBeginNativeSearch(seg: ConnectionSeg): boolean {
    if (!this.useNativeSearch) return false
    const original = HighDensitySolverA01.prototype
    if (
      this.getCachedWeightedH !== original.getCachedWeightedH ||
      this.computeH !== original.computeH ||
      this.computeMoveCostAndRips !== original.computeMoveCostAndRips ||
      this.getViaOccupants !== original.getViaOccupants ||
      this.getRipCost !== original.getRipCost
    )
      return false
    // Accessors can change a cost per neighbor, rather than per public step.
    // Check descriptors without invoking them before deciding the backend.
    const isDataProperty = (object: object, name: string): boolean => {
      for (
        let current: object | null = object;
        current;
        current = Object.getPrototypeOf(current)
      ) {
        const descriptor = Object.getOwnPropertyDescriptor(current, name)
        if (descriptor) return "value" in descriptor
      }
      return false
    }
    // A11 adds history-based rip costs and exact segment/via clearance.
    // Those solver configurations remain in JS until the kernel supports them.
    if (
      !isDataProperty(this, "ripHistoryCostMultiplier") ||
      !isDataProperty(this, "useExactViaTraceClearance") ||
      this.ripHistoryCostMultiplier !== 0 ||
      this.useExactViaTraceClearance
    )
      return false
    if (
      !["hyperParameters", "cellSizeMm", "penaltyCap"].every((name) =>
        isDataProperty(this, name),
      )
    )
      return false
    const hp = this.hyperParameters
    if (
      ![
        "viaBaseCost",
        "ripCost",
        "ripTracePenalty",
        "ripViaPenalty",
        "greedyMultiplier",
      ].every((name) => isDataProperty(hp, name))
    )
      return false
    const input: NativeA01SearchInput = {
      rows: this.rows,
      cols: this.cols,
      layers: this.layers,
      startZ: seg.startZ,
      startRow: seg.startRow,
      startCol: seg.startCol,
      endZ: seg.endZ,
      endRow: seg.endRow,
      endCol: seg.endCol,
      activeConnId: this.activeConnId,
      stamp: this.stamp,
      minViaRow: this.minViaRow,
      maxViaRow: this.maxViaRow,
      minViaCol: this.minViaCol,
      maxViaCol: this.maxViaCol,
      cellSizeMm: this.cellSizeMm,
      viaBaseCost: hp.viaBaseCost,
      ripCost: hp.ripCost,
      ripTracePenalty: hp.ripTracePenalty,
      ripViaPenalty: hp.ripViaPenalty,
      greedyMultiplier: hp.greedyMultiplier,
      penaltyCap: this.penaltyCap,
      usedCells: this.usedCellsFlat,
      portOwners: this.portOwnerFlat,
      usedDiagonals: this.usedDiagFlat,
      penalties: this.penalty2d,
      rootOverlap: this.rootOverlapAllowed,
      viaOffsetsDr: this.viaOccupantScanOffsetsDr,
      viaOffsetsDc: this.viaOccupantScanOffsetsDc,
    }
    if (!canRunNativeA01Search(input)) return false
    this.nativeSearchKernel ??= NativeA01SearchKernel.create(input)
    if (!this.nativeSearchKernel) return false
    this.nativeSearchKernel.begin(input)
    this.nativeSearchForActiveConnection = true
    this.nativeOpenSetLength = this.nativeSearchKernel.heapSize
    return true
  }

  private advanceNativeSearch(): void {
    const kernel = this.nativeSearchKernel!
    // Ordinary public scalar writes between steps remain live. Existing
    // weighted-H cache hits intentionally keep their earlier values, as in JS.
    const status = kernel.advance(
      this.cellSizeMm,
      this.hyperParameters,
      this.penaltyCap,
    )
    this.nativeStepCount++
    this.nativeOpenSetLength = kernel.heapSize
    if (status === 0) return
    if (status === 2) {
      this.error = `No path found for ${this.connIdToName[this.activeConnId]}`
      this.failed = true
      return
    }
    if (status !== 1)
      throw new Error(`Unexpected native search status ${status}`)
    const { cellIds, rippedIds } = kernel.readGoal()
    if (cellIds.length === 0)
      throw new Error("Native search returned an empty goal chain")
    // Finalization reads only the chosen chain and its persistent rip list.
    // Keep all cell marking, rip ordering, penalties and output logic in TS.
    this.nodePool.clear()
    let parent = -1
    for (const cell of cellIds)
      parent = this.nodePool.push(cell, 0, parent, null)
    let ripped: RippedNode | null = null
    for (let i = rippedIds.length - 1; i >= 0; i--)
      ripped = { id: rippedIds[i]!, prev: ripped }
    this.nodePool.ripped[parent] = ripped
    this.finalizeRoute(parent)
    this.activeConnSeg = null
    this.activeConnId = -1
    kernel.clear()
    this.nativeSearchForActiveConnection = false
    // The original heap retains its remaining entries after reaching a goal.
    // nativeOpenSetLength retains that public value until the next clear/start.
  }

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
    const toFlatIdx = (toZ * this.rows + toRow) * cols + toCol
    const fixedOwner = this.portOwnerFlat[toFlatIdx]!
    // Empty and self-owned cells need neither an overlap lookup nor an end
    // exemption. In particular, avoid indexing the typed table with -1/-2.
    if (
      fixedOwner >= 0 &&
      fixedOwner !== activeConn &&
      this.rootOverlapAllowed[fixedOwner] !== 1
    ) {
      const seg = this.activeConnSeg
      const isSegEnd =
        !!seg &&
        toZ === seg.endZ &&
        toRow === seg.endRow &&
        toCol === seg.endCol
      if (!isSegEnd) {
        this._moveCost = -1
        this._moveRipped = r
        return
      }
    }

    if (fromZ !== toZ) {
      // Via transition
      cost += this.hyperParameters.viaBaseCost
      cost += Math.min(this.penalty2d[toRow * cols + toCol]!, this.penaltyCap)

      const occs = this.getViaOccupants(toRow, toCol, activeConn)
      for (let i = 0; i < occs.length; i++) {
        const occ = occs[i]!
        if (!rippedContains(r, occ)) {
          cost += this.getRipCost(occ)
          r = { id: occ, prev: r }
        }
        cost += this.hyperParameters.ripViaPenalty
      }
    } else {
      // Lateral movement
      const dr = fromRow > toRow ? fromRow - toRow : toRow - fromRow
      const dc = fromCol > toCol ? fromCol - toCol : toCol - fromCol
      cost += (dr + dc > 1 ? Math.SQRT2 : 1) * this.cellSizeMm
      cost += Math.min(this.penalty2d[toRow * cols + toCol]!, this.penaltyCap)

      const occ = this.usedCellsFlat[toFlatIdx]!
      if (
        occ !== -1 &&
        occ !== activeConn &&
        this.rootOverlapAllowed[occ] !== 1
      ) {
        if (!rippedContains(r, occ)) {
          cost += this.getRipCost(occ)
          r = { id: occ, prev: r }
        }
        cost += this.hyperParameters.ripTracePenalty
      }

      // usedCellsFlat only records occupied grid points. A diagonal segment
      // can pass between those points and clip a via, so check the actual
      // output-space segment against nearby via centers as well.
      if (this.viaOwnersByCell.size > 0) {
        this.fillTraceSegmentViaOccupants(
          fromRow,
          fromCol,
          toRow,
          toCol,
          activeConn,
        )
        const viaOccs = this._viaOccs
        for (let i = 0; i < viaOccs.length; i++) {
          const viaOwner = viaOccs[i]!
          if (!rippedContains(r, viaOwner)) {
            cost += this.getRipCost(viaOwner)
            r = { id: viaOwner, prev: r }
          }
          cost += this.hyperParameters.ripViaPenalty
        }
      }

      // Prevent unmodeled same-layer diagonal X-crossings.
      // If this move uses one diagonal of a grid square, check the opposite
      // diagonal occupancy in that same square and treat it like a rip conflict.
      if (dr === 1 && dc === 1) {
        const sqRow = fromRow < toRow ? fromRow : toRow
        const sqCol = fromCol < toCol ? fromCol : toCol
        const isBackslash =
          (fromRow < toRow && fromCol < toCol) ||
          (fromRow > toRow && fromCol > toCol)
        const diagSlot = isBackslash ? 0 : 1
        const crossingSlot = diagSlot ^ 1
        const sqCols = this.cols - 1
        const diagBase = ((toZ * (this.rows - 1) + sqRow) * sqCols + sqCol) * 2
        const crossingOcc = this.usedDiagFlat[diagBase + crossingSlot]!
        if (
          crossingOcc !== -1 &&
          crossingOcc !== activeConn &&
          this.rootOverlapAllowed[crossingOcc] !== 1
        ) {
          this._moveCost = -1
          this._moveRipped = r
          return
        }
      }
    }

    this._moveCost = cost
    this._moveRipped = r
  }

  // Occupant lists are immutable until the active search ends.
  private getViaOccupants(
    row: number,
    col: number,
    activeConn: ConnId,
  ): ConnId[] {
    const cellIdx = row * this.cols + col
    // With two layers, the reverse via targets an already visited state, so
    // this cell is scanned at most once per search. More layers can reuse it.
    const shouldCache = this.layers > 2
    if (shouldCache) {
      const cached = this.viaOccupantsByCell.get(cellIdx)
      if (cached) return cached
    }
    // Uncached callers consume the list synchronously. Cached lists must stay
    // independent of the scratch array used by later moves.
    const occs: ConnId[] = shouldCache ? [] : this._viaOccs
    occs.length = 0
    const rows = this.rows
    const cols = this.cols
    const offDr = this.viaOccupantScanOffsetsDr
    const offDc = this.viaOccupantScanOffsetsDc
    const offLen = this.viaOccupantScanOffsetsLen
    const used = this.usedCellsFlat
    let flatOffsets = this.viaScanFlatOffsets
    if (!flatOffsets) {
      flatOffsets = new Int32Array(offLen)
      let radius = 0
      for (let i = 0; i < offLen; i++) {
        flatOffsets[i] = offDr[i]! * cols + offDc[i]!
        radius = Math.max(radius, Math.abs(offDr[i]!), Math.abs(offDc[i]!))
      }
      this.viaScanFlatOffsets = flatOffsets
      this.viaScanRadius = radius
    }
    const radius = this.viaScanRadius
    const isInterior =
      row >= radius &&
      col >= radius &&
      row + radius < rows &&
      col + radius < cols

    for (let z = 0; z < this.layers; z++) {
      const base = z * this.planeSize + cellIdx
      for (let i = 0; i < offLen; i++) {
        if (!isInterior) {
          const r = row + offDr[i]!
          const c = col + offDc[i]!
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue
        }
        const occ = used[base + flatOffsets[i]!]!
        if (occ === -1 || occ === activeConn) continue
        if (this.rootOverlapAllowed[occ] === 1) {
          continue
        }
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
    if (shouldCache) this.viaOccupantsByCell.set(cellIdx, occs)
    return occs
  }

  private fillTraceSegmentViaOccupants(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number,
    activeConn: ConnId,
  ): void {
    const occs = this._viaOccs
    occs.length = 0
    const minRow = Math.min(fromRow, toRow)
    const maxRow = Math.max(fromRow, toRow)
    const minCol = Math.min(fromCol, toCol)
    const maxCol = Math.max(fromCol, toCol)
    const rowClearance = this.viaTraceClearanceMm / this.outputCellStepY
    const colClearance = this.viaTraceClearanceMm / this.outputCellStepX
    const segmentX = (toCol - fromCol) * this.outputCellStepX
    const segmentY = (toRow - fromRow) * this.outputCellStepY
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY
    const clearanceSquared = this.viaTraceClearanceMm * this.viaTraceClearanceMm

    for (const [viaIndex, owners] of this.viaOwnersByCell) {
      const row = Math.floor(viaIndex / this.cols)
      const col = viaIndex - row * this.cols
      if (
        row < minRow - rowClearance ||
        row > maxRow + rowClearance ||
        col < minCol - colClearance ||
        col > maxCol + colClearance
      ) {
        continue
      }

      const viaFromX = (col - fromCol) * this.outputCellStepX
      const viaFromY = (row - fromRow) * this.outputCellStepY
      const projection =
        segmentLengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                (viaFromX * segmentX + viaFromY * segmentY) /
                  segmentLengthSquared,
              ),
            )
      const closestX = segmentX * projection
      const closestY = segmentY * projection
      const distanceX = viaFromX - closestX
      const distanceY = viaFromY - closestY
      if (distanceX * distanceX + distanceY * distanceY >= clearanceSquared) {
        continue
      }

      for (const owner of owners) {
        if (owner === activeConn) continue
        const sameRoot =
          this.connIdToRootNet[owner] === this.connIdToRootNet[activeConn]
        if (
          sameRoot &&
          this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
        ) {
          continue
        }
        if (!occs.includes(owner)) occs.push(owner)
      }
    }
  }

  private shouldSkipFixedPortHalo(flatIdx: number, connId: ConnId) {
    const fixedOwner = this.portOwnerFlat[flatIdx]!
    if (fixedOwner === connId) return false
    if (fixedOwner === -2) return true
    if (fixedOwner < 0) return false
    const sameRoot =
      this.connIdToRootNet[fixedOwner] === this.connIdToRootNet[connId]
    return !(
      sameRoot &&
      this.overlapFriendlyRootNets.has(this.connIdToRootNet[connId]!)
    )
  }

  // --- Visited stamp management ---
  private nextStamp(): void {
    // Occupancy and the active connection remain fixed during each search.
    // Finalizing or ripping routes can change both before the next search.
    this.viaOccupantsByCell.clear()
    const connRips = this.ripCount[this.activeConnId] ?? 0
    this.searchBudgetIters = Math.round(
      this.baseSearchBudgetIters * (1 + Math.min(connRips, 10) * 0.25),
    )
    const roots = this.connIdToRootNet
    if (this.rootOverlapAllowed.length !== roots.length) {
      this.rootOverlapAllowed = new Uint8Array(roots.length)
    }
    const activeRoot = roots[this.activeConnId]!
    if (this.overlapFriendlyRootNets.has(activeRoot)) {
      for (let conn = 0; conn < roots.length; conn++) {
        this.rootOverlapAllowed[conn] = roots[conn] === activeRoot ? 1 : 0
      }
    } else {
      this.rootOverlapAllowed.fill(0)
    }
    this.stamp = (this.stamp + 1) >>> 0
    if (this.stamp === 0) {
      this.visitedStamp.fill(0)
      this.heuristicStamp.fill(0)
      this.stamp = 1
    }
  }

  private getCachedWeightedH(
    flatIdx: number,
    z: number,
    row: number,
    col: number,
    toZ: number,
    toRow: number,
    toCol: number,
  ): number {
    if (this.heuristicStamp[flatIdx] === this.stamp) {
      return this.weightedHeuristicValue[flatIdx]!
    }
    // The destination and heuristic parameters, including greedyMultiplier,
    // stay fixed for the search. Preserve h * multiplier before adding g.
    const weightedH =
      this.computeH(z, row, col, toZ, toRow, toCol) *
      this.hyperParameters.greedyMultiplier
    this.heuristicStamp[flatIdx] = this.stamp
    this.weightedHeuristicValue[flatIdx] = weightedH
    return weightedH
  }

  // --- Heuristic: Manhattan + via-zone awareness for cross-layer ---
  private computeH(
    z: number,
    row: number,
    col: number,
    toZ: number,
    toRow: number,
    toCol: number,
  ): number {
    const dr = Math.abs(row - toRow)
    const dc = Math.abs(col - toCol)
    const manhattan = dr + dc

    if (z === toZ) return manhattan * this.cellSizeMm

    // On wrong layer — add viaBaseCost as minimum layer-switch cost
    if (!this.crossLayerSearch) {
      return manhattan * this.cellSizeMm + this.hyperParameters.viaBaseCost
    }

    // Cross-layer search on wrong layer: via-zone-aware estimate.
    // Clamp each endpoint to the via zone to estimate via detour.
    const vr1 = Math.max(this.minViaRow, Math.min(this.maxViaRow, row))
    const vc1 = Math.max(this.minViaCol, Math.min(this.maxViaCol, col))
    const vr2 = Math.max(this.minViaRow, Math.min(this.maxViaRow, toRow))
    const vc2 = Math.max(this.minViaCol, Math.min(this.maxViaCol, toCol))

    const via1 =
      Math.abs(row - vr1) +
      Math.abs(col - vc1) +
      Math.abs(vr1 - toRow) +
      Math.abs(vc1 - toCol)
    const via2 =
      Math.abs(row - vr2) +
      Math.abs(col - vc2) +
      Math.abs(vr2 - toRow) +
      Math.abs(vc2 - toCol)

    return (
      Math.max(Math.min(via1, via2), manhattan) * this.cellSizeMm +
      this.hyperParameters.viaBaseCost
    )
  }

  // --- Connection interning ---
  private internConn(name: string, rootNetName?: string): ConnId {
    const existing = this.connNameToId.get(name)
    if (existing !== undefined) return existing
    const id = this.connIdToName.length
    this.connIdToName.push(name)
    this.connIdToRootNet.push(toRootNetName(name, rootNetName))
    this.connNameToId.set(name, id)
    return id
  }

  // --- Build connection segments from port points ---
  private buildConnectionSegs(): ConnectionSeg[] {
    const byName = new Map<
      string,
      {
        points: PortPoint[]
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
      const pointPairs = getConnectionPortPointPairs(pts)
      if (pointPairs.length === 0) continue

      const connId = this.internConn(name, conn.rootConnectionName)
      for (const [startPoint, endPoint] of pointPairs) {
        const s = this.pointToCell(startPoint)
        const e = this.pointToCell(endPoint)

        const endpointA = `${s.z}:${s.row}:${s.col}`
        const endpointB = `${e.z}:${e.row}:${e.col}`
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
          startRow: s.row,
          startCol: s.col,
          startPoint,
          endZ: e.z,
          endRow: e.row,
          endCol: e.col,
          endPoint,
        })
      }
    }
    return segs
  }

  private pointToCell(pt: { x: number; y: number; z: number }): {
    z: number
    row: number
    col: number
  } {
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
    this.consecutiveSkips = Math.max(0, this.consecutiveSkips - 1)

    // Reconstruct path from parent chain (cell-based)
    const cells: Array<{ z: number; row: number; col: number }> = []
    let idx = goalNodeIdx
    while (idx >= 0) {
      const cellIdx = this.nodePool.cellIdx[idx]!
      if (this.planeSize !== 0) {
        const z = Math.floor(cellIdx / this.planeSize)
        const cellInPlane = cellIdx - z * this.planeSize
        const row = Math.floor(cellInPlane / this.cols)
        const col = cellInPlane - row * this.cols
        cells.push({ z, row, col })
      } else {
        cells.push({
          z: this.activeConnSeg!.startZ,
          row: this.activeConnSeg!.startRow,
          col: this.activeConnSeg!.startCol,
        })
      }
      idx = this.nodePool.parentIdx[idx]!
    }
    cells.reverse()

    while (cells.length > 1) {
      const first = cells[0]!
      const firstFlat =
        (first.z * this.rows + first.row) * this.cols + first.col
      if (!this.sharedCrossRootPortCells.has(firstFlat)) break
      cells.shift()
    }
    while (cells.length > 1) {
      const last = cells[cells.length - 1]!
      const lastFlat = (last.z * this.rows + last.row) * this.cols + last.col
      if (!this.sharedCrossRootPortCells.has(lastFlat)) break
      cells.pop()
    }

    // Detect vias (z-level changes)
    const viaCells: Array<{ row: number; col: number }> = []
    for (let i = 1; i < cells.length; i++) {
      if (cells[i]!.z !== cells[i - 1]!.z) {
        viaCells.push({ row: cells[i]!.row, col: cells[i]!.col })
      }
    }

    const firstCell = cells[0]!
    const lastCell = cells[cells.length - 1]!

    const connId = this.activeConnId

    // Collect ripped traces from goal node's persistent list
    const rippedIds: ConnId[] = []
    for (let cur = this.nodePool.ripped[goalNodeIdx]; cur; cur = cur.prev) {
      rippedIds.push(cur.id)
    }

    // Rip displaced traces
    for (let i = 0; i < rippedIds.length; i++) {
      this.ripTrace(rippedIds[i]!)
      if (this.failed) return
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
          if (
            (r !== cell.row || c !== cell.col) &&
            this.shouldSkipFixedPortHalo(flatIdx, connId)
          ) {
            continue
          }
          const existing = used[flatIdx]!
          const sameRoot =
            this.connIdToRootNet[existing] === this.connIdToRootNet[connId]
          const allowSameRootOverlap =
            sameRoot &&
            this.overlapFriendlyRootNets.has(this.connIdToRootNet[connId]!)
          if (existing !== -1 && existing !== connId && !allowSameRootOverlap) {
            continue
          }
          used[flatIdx] = connId
          indices.push(flatIdx)
        }
      }
    }

    // Mark via footprint cells
    const displacedByVias: ConnId[] = []
    const offDr = this.viaOccupantScanOffsetsDr
    const offDc = this.viaOccupantScanOffsetsDc
    const offLen = this.viaOccupantScanOffsetsLen

    for (let vi = 0; vi < viaCells.length; vi++) {
      const via = viaCells[vi]!
      for (let z = 0; z < this.layers; z++) {
        const zBase = z * this.planeSize
        for (let oi = 0; oi < offLen; oi++) {
          const r = via.row + offDr[oi]!
          const c = via.col + offDc[oi]!
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue
          const flatIdx = zBase + r * cols + c
          if (
            (r !== via.row || c !== via.col) &&
            this.shouldSkipFixedPortHalo(flatIdx, connId)
          ) {
            continue
          }
          const existing = used[flatIdx]!
          const sameRoot =
            this.connIdToRootNet[existing] === this.connIdToRootNet[connId]
          const allowSameRootOverlap =
            sameRoot &&
            this.overlapFriendlyRootNets.has(this.connIdToRootNet[connId]!)
          if (existing !== -1 && existing !== connId && !allowSameRootOverlap) {
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

    // Mark occupied diagonal edges (for diagonal X-crossing prevention)
    const diagIndices: number[] = []
    const sqCols = this.cols - 1
    for (let i = 1; i < cells.length; i++) {
      const prev = cells[i - 1]!
      const curr = cells[i]!
      if (prev.z !== curr.z) continue

      const dr = prev.row > curr.row ? prev.row - curr.row : curr.row - prev.row
      const dc = prev.col > curr.col ? prev.col - curr.col : curr.col - prev.col
      if (dr !== 1 || dc !== 1) continue

      const sqRow = prev.row < curr.row ? prev.row : curr.row
      const sqCol = prev.col < curr.col ? prev.col : curr.col
      const isBackslash =
        (prev.row < curr.row && prev.col < curr.col) ||
        (prev.row > curr.row && prev.col > curr.col)
      const diagSlot = isBackslash ? 0 : 1
      const crossingSlot = diagSlot ^ 1
      const diagBase = ((prev.z * (this.rows - 1) + sqRow) * sqCols + sqCol) * 2
      const crossingIdx = diagBase + crossingSlot
      const crossingOcc = this.usedDiagFlat[crossingIdx]!
      const crossingSameRoot =
        this.connIdToRootNet[crossingOcc] === this.connIdToRootNet[connId]
      const allowCrossingOverlap =
        crossingSameRoot &&
        this.overlapFriendlyRootNets.has(this.connIdToRootNet[connId]!)
      if (
        crossingOcc !== -1 &&
        crossingOcc !== connId &&
        !allowCrossingOverlap
      ) {
        continue
      }

      const diagIdx = diagBase + diagSlot
      this.usedDiagFlat[diagIdx] = connId
      diagIndices.push(diagIdx)
    }

    // Store used indices for this connection
    while (this.usedIndicesByConn.length <= connId) {
      this.usedIndicesByConn.push([])
    }
    const usedIndices = this.usedIndicesByConn[connId] ?? []
    usedIndices.push(...indices)
    this.usedIndicesByConn[connId] = usedIndices
    while (this.usedDiagIndicesByConn.length <= connId) {
      this.usedDiagIndicesByConn.push([])
    }
    const usedDiagIndices = this.usedDiagIndicesByConn[connId] ?? []
    usedDiagIndices.push(...diagIndices)
    this.usedDiagIndicesByConn[connId] = usedDiagIndices

    // Store solved route (cell-based)
    const solvedRoutes = this.solvedRoutes.get(connId) ?? []
    solvedRoutes.push({
      connId,
      startZ: firstCell.z,
      startRow: firstCell.row,
      startCol: firstCell.col,
      startPoint: this.activeConnSeg!.startPoint,
      endZ: lastCell.z,
      endRow: lastCell.row,
      endCol: lastCell.col,
      endPoint: this.activeConnSeg!.endPoint,
      cells,
      viaCells,
    })
    this.solvedRoutes.set(connId, solvedRoutes)

    if (this.useExactViaTraceClearance) {
      while (this.viaCenterIndicesByConn.length <= connId) {
        this.viaCenterIndicesByConn.push([])
      }
      const viaCenterIndices = this.viaCenterIndicesByConn[connId] ?? []
      for (const via of viaCells) {
        const viaCenterIndex = via.row * this.cols + via.col
        const owners = this.viaOwnersByCell.get(viaCenterIndex) ?? new Set()
        if (!owners.has(connId)) {
          owners.add(connId)
          viaCenterIndices.push(viaCenterIndex)
        }
        this.viaOwnersByCell.set(viaCenterIndex, owners)
      }
      this.viaCenterIndicesByConn[connId] = viaCenterIndices
    }

    // Rip connections displaced by via footprints
    for (let i = 0; i < displacedByVias.length; i++) {
      this.ripTrace(displacedByVias[i]!)
      if (this.failed) return
    }
    // Penalty decay to prevent death spiral
    if (rippedIds.length > 0 || displacedByVias.length > 0) {
      const pen = this.penalty2d
      const cap = this.penaltyCap
      if (this.totalRipEvents > 50) {
        // High-contention mode: global decay to help stuck connections converge
        for (let i = 0; i < pen.length; i++) {
          pen[i] = pen[i]! * 0.99
        }
      } else {
        // Normal mode: targeted decay only for above-cap cells
        for (let i = 0; i < pen.length; i++) {
          if (pen[i]! > cap) {
            pen[i] = pen[i]! * 0.5
          }
        }
      }
    }
  }

  // --- Rip a trace ---
  private ripTrace(connId: ConnId): void {
    while (this.ripCount.length <= connId) this.ripCount.push(0)
    this.ripCount[connId]!++
    this.totalRipEvents++
    if (this.totalRipEvents >= this.MAX_RIPS) {
      this.error = `Convergence failure: exceeded MAX_RIPS ${this.MAX_RIPS}`
      this.failed = true
      return
    }

    const routes = this.solvedRoutes.get(connId) ?? []

    // Add rip penalties to penalty map along the ripped route
    if (routes.length > 0) {
      const cols = this.cols
      for (const route of routes) {
        for (let i = 0; i < route.cells.length; i++) {
          const cell = route.cells[i]!
          const cellIdx = cell.row * cols + cell.col
          this.penalty2d[cellIdx] =
            this.penalty2d[cellIdx]! + this.hyperParameters.ripTracePenalty
        }
        for (let i = 0; i < route.viaCells.length; i++) {
          const via = route.viaCells[i]!
          const viaIdx = via.row * cols + via.col
          this.penalty2d[viaIdx] =
            this.penalty2d[viaIdx]! + this.hyperParameters.ripViaPenalty
        }
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

    const diagIndices = this.usedDiagIndicesByConn[connId]
    if (diagIndices) {
      const usedDiag = this.usedDiagFlat
      for (let i = 0; i < diagIndices.length; i++) {
        const flatIdx = diagIndices[i]!
        if (usedDiag[flatIdx] === connId) {
          usedDiag[flatIdx] = -1
        }
      }
      this.usedDiagIndicesByConn[connId] = []
    }

    const viaCenterIndices = this.viaCenterIndicesByConn[connId]
    if (viaCenterIndices) {
      for (const viaCenterIndex of viaCenterIndices) {
        const owners = this.viaOwnersByCell.get(viaCenterIndex)
        if (!owners) continue
        owners.delete(connId)
        if (owners.size === 0) {
          this.viaOwnersByCell.delete(viaCenterIndex)
        }
      }
      this.viaCenterIndicesByConn[connId] = []
    }

    // Move from solved back to unsolved
    if (routes.length > 0) {
      this.solvedRoutes.delete(connId)
      for (const route of routes) {
        this.unsolvedSegs.push({
          connId,
          startZ: route.startZ,
          startRow: route.startRow,
          startCol: route.startCol,
          startPoint: route.startPoint,
          endZ: route.endZ,
          endRow: route.endRow,
          endCol: route.endCol,
          endPoint: route.endPoint,
        })
      }
    }
  }

  override visualize() {
    if (this.nativeSearchForActiveConnection) {
      this.nativeSearchKernel!.copyVisitedTo(this.visitedStamp)
    }
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
          points: route.route.slice(segStart).map((p) => ({ x: p.x, y: p.y })),
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

    for (const [connId, routes] of this.solvedRoutes ?? []) {
      const connName = this.connIdToName[connId]!
      for (const route of routes) {
        const points = route.cells.map((cell) => {
          const rawX = this.gridOrigin.x + (cell.col + 0.5) * this.cellSizeMm
          const rawY = this.gridOrigin.y + (cell.row + 0.5) * this.cellSizeMm
          const tp = applyAffineTransformToPoint(t, { x: rawX, y: rawY })
          return { x: tp.x, y: tp.y, z: this.layerToZ.get(cell.z) ?? cell.z }
        })
        if (points.length > 0) {
          points[0] = { ...route.startPoint }
          if (points.length > 1) {
            points[points.length - 1] = { ...route.endPoint }
          }
        }
        result.push({
          connectionName: connName,
          rootConnectionName: this.connIdToRootNet[connId],
          regionId: this.nodeWithPortPoints.capacityMeshNodeId,
          traceThickness: this.traceThickness,
          viaDiameter: this.viaDiameter,
          route: points,
          vias: route.viaCells.map((via) => {
            const rawX = this.gridOrigin.x + (via.col + 0.5) * this.cellSizeMm
            const rawY = this.gridOrigin.y + (via.row + 0.5) * this.cellSizeMm
            return applyAffineTransformToPoint(t, { x: rawX, y: rawY })
          }),
        })
      }
    }

    return result
  }
}
