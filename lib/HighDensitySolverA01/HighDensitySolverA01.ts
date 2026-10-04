import { BaseSolver } from "@tscircuit/solver-utils"
import { getConnectionPortPointPairs } from "../getConnectionPortPointPairs"
import {
  type AffineTransform,
  applyAffineTransformToPoint,
  computeGridToAffineTransform,
} from "../gridToAffineTransform"
import { computeMaxIterationsByNodeSizeAndConnectionCount } from "../maxIterationsByNodeSizeAndConnectionCount"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../types"

// Only native A01 search owns the private heap, node pool and rip chains.
// Public data and dispatch are checked again at each public search step.
interface NativeHeuristicCache {
  values: Float64Array
  epochs: Uint32Array
  epoch: number
  bytes: number
  signature: number[]
  goalZ: number
  goalRow: number
  goalCol: number
  searchStamp: number
}

const MAX_HEURISTIC_CACHE_STATES = 262_144
const MAX_HEURISTIC_CACHE_BYTES = 32 * 1024 * 1024
let allocatedHeuristicCacheBytes = 0
const ownedHeuristicHyperParameters = new WeakMap<object, object>()
const exposedUnsolvedConnections = new WeakSet<object>()
const exposedSolvedConnections = new WeakSet<object>()
const hasExposedUnsolvedConnections = WeakSet.prototype.has.bind(
  exposedUnsolvedConnections,
)
const markUnsolvedConnectionsExposed = WeakSet.prototype.add.bind(
  exposedUnsolvedConnections,
)
const hasExposedSolvedConnections = WeakSet.prototype.has.bind(
  exposedSolvedConnections,
)
const markSolvedConnectionsExposed = WeakSet.prototype.add.bind(
  exposedSolvedConnections,
)
type NativeRouteObjectKind =
  | "routes"
  | "route"
  | "cells"
  | "cell"
  | "vias"
  | "via"
const nativeRouteObjectKinds = new WeakMap<object, NativeRouteObjectKind>()
const getNativeRouteObjectKind = WeakMap.prototype.get.bind(
  nativeRouteObjectKinds,
)
const setNativeRouteObjectKind = WeakMap.prototype.set.bind(
  nativeRouteObjectKinds,
)
const getOwnedHeuristicHyperParameters = WeakMap.prototype.get.bind(
  ownedHeuristicHyperParameters,
)
const setOwnedHeuristicHyperParameters = WeakMap.prototype.set.bind(
  ownedHeuristicHyperParameters,
)
const getOwnDescriptors = Object.getOwnPropertyDescriptors
const getOwnDescriptor = Object.getOwnPropertyDescriptor
const getPrototype = Object.getPrototypeOf
const ownKeys = Reflect.ownKeys
const isFiniteNumber = Number.isFinite
const isSafeInteger = Number.isSafeInteger
const sameNumber = Object.is
const nativeFunctionSource = Function.prototype.toString
const NativeFloat64Array = Float64Array
const NativeUint32Array = Uint32Array
const nativeGlobal = globalThis
const nativeMath = Math
const nativeNumber = Number
const nativeArray = Array
const nativeArrayPrototype = Array.prototype
const nativeMapPrototype = Map.prototype
const nativeSetPrototype = Set.prototype
const nativeObjectPrototype = Object.prototype
const nativeObjectDescriptors = getOwnDescriptors(nativeObjectPrototype)
const nativeObjectKeys = ownKeys(nativeObjectDescriptors)
const hasOwn = Function.prototype.call.bind(
  Object.prototype.hasOwnProperty,
) as (value: object, key: PropertyKey) => boolean
const nativeSpeciesSymbol = Symbol.species
const nativeArraySpecies = getOwnDescriptor(
  nativeArray,
  nativeSpeciesSymbol,
)!.get
const nativeArrayIteratorPrototype = getPrototype([][Symbol.iterator]())
const nativeMapIteratorPrototype = getPrototype(new Map()[Symbol.iterator]())
const nativeSetIteratorPrototype = getPrototype(new Set()[Symbol.iterator]())
const nativeCacheIntrinsics = [
  ...["Array", "Map", "Set"].map((name) => ({
    owner: nativeGlobal,
    name,
    value: getOwnDescriptor(nativeGlobal, name)!.value,
  })),
  { owner: Array.prototype, name: "constructor", value: Array },
  ...[
    nativeArrayIteratorPrototype,
    nativeMapIteratorPrototype,
    nativeSetIteratorPrototype,
  ].map((owner) => ({
    owner,
    name: "next",
    value: getOwnDescriptor(owner, "next")!.value,
  })),
  ...["abs", "min", "max", "round", "floor", "ceil"].map((name) => ({
    owner: Math,
    name,
    value: getOwnDescriptor(Math, name)!.value,
  })),
  ...[
    "push",
    "pop",
    "shift",
    "slice",
    "reverse",
    "map",
    "filter",
    "sort",
    "includes",
    "every",
  ].map((name) => ({
    owner: Array.prototype,
    name,
    value: getOwnDescriptor(Array.prototype, name)!.value,
  })),
  ...["get", "set", "has", "clear", "delete", "entries", "values"].map(
    (name) => ({
      owner: Map.prototype,
      name,
      value: getOwnDescriptor(Map.prototype, name)!.value,
    }),
  ),
  ...["has", "add", "delete", "values"].map((name) => ({
    owner: Set.prototype,
    name,
    value: getOwnDescriptor(Set.prototype, name)!.value,
  })),
  {
    owner: Array.prototype,
    name: Symbol.iterator,
    value: getOwnDescriptor(Array.prototype, Symbol.iterator)!.value,
  },
  {
    owner: Map.prototype,
    name: Symbol.iterator,
    value: getOwnDescriptor(Map.prototype, Symbol.iterator)!.value,
  },
  {
    owner: Set.prototype,
    name: Symbol.iterator,
    value: getOwnDescriptor(Set.prototype, Symbol.iterator)!.value,
  },
]
const nativeSqrt2 = getOwnDescriptor(Math, "SQRT2")!.value
const nativeMapSize = getOwnDescriptor(Map.prototype, "size")!.get
const nativeSetSize = getOwnDescriptor(Set.prototype, "size")!.get
const nativeTypedArrayPrototype = getPrototype(Uint32Array.prototype)
const nativeTypedArrayFill = getOwnDescriptor(
  nativeTypedArrayPrototype,
  "fill",
)!.value
const nativeTypedArrayLength = getOwnDescriptor(
  nativeTypedArrayPrototype,
  "length",
)!.get
const getNativeMapEntries = Function.prototype.call.bind(
  Map.prototype.entries,
) as (map: Map<unknown, unknown>) => MapIterator<[unknown, unknown]>
const getNativeMapIteratorNext = Function.prototype.call.bind(
  getOwnDescriptor(nativeMapIteratorPrototype, "next")!.value,
) as (
  iterator: MapIterator<[unknown, unknown]>,
) => IteratorResult<[unknown, unknown]>
const nativeIteratorChains: Array<{ owner: object; parent: object | null }> = []
for (const initial of [
  nativeArrayIteratorPrototype,
  nativeMapIteratorPrototype,
  nativeSetIteratorPrototype,
]) {
  for (let owner: object | null = initial; owner; owner = getPrototype(owner)) {
    if (!nativeIteratorChains.some((entry) => entry.owner === owner)) {
      nativeIteratorChains.push({ owner, parent: getPrototype(owner) })
    }
  }
}
const cacheIntrinsicsWereNative = [
  ...nativeCacheIntrinsics.map(({ value }) => value),
  nativeArraySpecies,
  nativeMapSize,
  nativeSetSize,
  nativeTypedArrayFill,
  nativeTypedArrayLength,
].every((value) => nativeFunctionSource.call(value).includes("[native code]"))

function hasOnlyOwnDataDescriptors(
  descriptors: PropertyDescriptorMap,
): boolean {
  const keys = ownKeys(descriptors)
  for (let index = 0; index < keys.length; index++) {
    const descriptor = descriptors[keys[index] as keyof PropertyDescriptorMap]
    if (!descriptor || !hasOwn(descriptor, "value")) return false
  }
  return true
}

function hasNativeObjectPrototype(): boolean {
  const keys = ownKeys(nativeObjectPrototype)
  if (
    keys.length !== nativeObjectKeys.length ||
    getPrototype(nativeObjectPrototype) !== null
  )
    return false
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    if (key !== nativeObjectKeys[index]) return false
    const descriptor = getOwnDescriptor(nativeObjectPrototype, key)!
    const original = nativeObjectDescriptors[key as string]!
    const fields = [
      "value",
      "get",
      "set",
      "writable",
      "enumerable",
      "configurable",
    ] as const
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
      const field = fields[fieldIndex]!
      if (hasOwn(descriptor, field) !== hasOwn(original, field)) return false
      if (hasOwn(descriptor, field) && descriptor[field] !== original[field])
        return false
    }
  }
  return true
}

function hasNumericPrototypeProperties(prototype: object): boolean {
  const keys = ownKeys(prototype)
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]
    if (typeof key === "string" && isFiniteNumber(nativeNumber(key)))
      return true
  }
  return false
}

// Only native-created exposed route objects are inspected. Foreign values,
// including Proxy replacements, fall back without property introspection.
function validateExposedSolvedRoutes(map: Map<unknown, unknown>): boolean {
  if (getPrototype(map) !== nativeMapPrototype || ownKeys(map).length !== 0)
    return false
  let remainingObjects = MAX_HEURISTIC_CACHE_STATES
  const arrayDescriptors = (value: unknown, kind: NativeRouteObjectKind) => {
    if (
      !value ||
      typeof value !== "object" ||
      getNativeRouteObjectKind(value) !== kind
    )
      return undefined
    if (getPrototype(value) !== nativeArrayPrototype) return undefined
    const descriptors = getOwnDescriptors(value)
    if (!hasOnlyOwnDataDescriptors(descriptors)) return undefined
    const length = descriptors.length?.value
    if (!isSafeInteger(length) || length < 0 || length >= remainingObjects)
      return undefined
    const keys = ownKeys(descriptors)
    if (keys.length !== length + 1) return undefined
    for (let index = 0; index < length; index++) {
      if (!hasOwn(descriptors, index)) return undefined
    }
    remainingObjects -= length + 1
    return descriptors
  }
  const objectDescriptors = (value: unknown, kind: NativeRouteObjectKind) => {
    if (
      !value ||
      typeof value !== "object" ||
      getNativeRouteObjectKind(value) !== kind
    )
      return undefined
    if (getPrototype(value) !== nativeObjectPrototype || --remainingObjects < 0)
      return undefined
    const descriptors = getOwnDescriptors(value)
    return hasOnlyOwnDataDescriptors(descriptors) ? descriptors : undefined
  }
  const iterator = getNativeMapEntries(map)
  for (;;) {
    const entry = getNativeMapIteratorNext(iterator)
    if (entry.done) return true
    if (--remainingObjects < 0) return false
    if (!isSafeInteger(entry.value[0])) return false
    const routes = arrayDescriptors(entry.value[1], "routes")
    if (!routes) return false
    for (let routeIndex = 0; routeIndex < routes.length!.value; routeIndex++) {
      const route = objectDescriptors(routes[routeIndex]!.value, "route")
      if (!route) return false
      const fields = [
        "connId",
        "startZ",
        "startRow",
        "startCol",
        "endZ",
        "endRow",
        "endCol",
      ]
      for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
        if (!isSafeInteger(route[fields[fieldIndex]!]?.value)) return false
      }
      if (!hasOwn(route, "startPoint") || !hasOwn(route, "endPoint"))
        return false
      // The native step copies endpoint references; it never reads their fields.
      const groups = [
        {
          array: "cells",
          arrayKind: "cells",
          pointKind: "cell",
          fields: ["z", "row", "col"],
        },
        {
          array: "viaCells",
          arrayKind: "vias",
          pointKind: "via",
          fields: ["row", "col"],
        },
      ] as const
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex]!
        const points = arrayDescriptors(
          route[group.array]?.value,
          group.arrayKind,
        )
        if (!points) return false
        for (
          let pointIndex = 0;
          pointIndex < points.length!.value;
          pointIndex++
        ) {
          const point = objectDescriptors(
            points[pointIndex]!.value,
            group.pointKind,
          )
          if (!point) return false
          for (
            let fieldIndex = 0;
            fieldIndex < group.fields.length;
            fieldIndex++
          ) {
            if (!isSafeInteger(point[group.fields[fieldIndex]!]?.value))
              return false
          }
        }
      }
    }
  }
}

// --- Interned connection ID ---
type ConnId = number
type GridCellIndex = number

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
  private visitedStamp!: Uint32Array // layers * planeSize
  private sharedCrossRootPortCells!: Set<number>
  private stamp = 0
  private heuristicCache: NativeHeuristicCache | undefined

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
  private nodePool!: SearchNode[]
  private heap!: MinHeap
  private seqCounter = 0

  // --- Reusable scratch for via occupant scan ---
  private _viaOccs: ConnId[] = []
  private viaOccupantsByCell = new Map<GridCellIndex, readonly ConnId[]>()

  // --- Convergence state ---
  private ripCount!: number[]
  private totalRipEvents = 0
  private searchIterations = 0
  private consecutiveSkips = 0
  private penaltyCap!: number
  private baseSearchBudgetIters!: number

  // --- Reusable scratch for computeMoveCostAndRips ---
  private _moveCost = 0
  private _moveRipped: RippedNode | null = null

  // --- Test/debug compatibility getters ---
  get unsolvedConnections() {
    const segments = this.unsolvedSegs
    if (segments && typeof segments === "object")
      markUnsolvedConnectionsExposed(segments)
    return segments
  }
  get solvedConnectionsMap() {
    const routes = this.solvedRoutes
    if (routes && typeof routes === "object")
      markSolvedConnectionsExposed(routes)
    return routes
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
    this.hyperParameters = {
      shuffleSeed: 0,
      ripCost: 10,
      ripTracePenalty: 0.5,
      ripViaPenalty: 0.75,
      viaBaseCost: 0.1,
      greedyMultiplier: 1.5,
      ...props.hyperParameters,
    }
    setOwnedHeuristicHyperParameters(this, this.hyperParameters)
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
    this.nodePool = []
    this.heap = new MinHeap()
    this.seqCounter = 0
  }

  override _step(): void {
    const cache = nativePrepareHeuristicCache(this)
    for (let i = 0; i < this.stepMultiplier; i++) {
      if (this.solved || this.failed) {
        if (cache) nativeReleaseHeuristicCache(this)
        return
      }
      if (cache) this.stepOnce(cache)
      else this.stepOnce()
    }
    if (
      cache &&
      (this.solved || this.failed || this.iterations >= this.MAX_ITERATIONS)
    ) {
      nativeReleaseHeuristicCache(this)
    }
  }

  private stepOnce(cache?: NativeHeuristicCache): void {
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

      // Occupancy and the active net stay fixed until this search finishes.
      // Clear before another connection observes newly routed or ripped copper.
      this.viaOccupantsByCell.clear()

      // Reset A* state for this connection
      this.nodePool = []
      this.heap.clear()
      this.seqCounter = 0
      this.searchIterations = 0
      this.nextStamp()

      // Push start node
      if (cache) {
        this.resetHeuristicEpoch(cache)
        cache.goalZ = next.endZ
        cache.goalRow = next.endRow
        cache.goalCol = next.endCol
        cache.searchStamp = this.stamp
      }
      const h = cache
        ? this.getCachedHeuristic(
            cache,
            (next.startZ * this.rows + next.startRow) * this.cols +
              next.startCol,
            next.startZ,
            next.startRow,
            next.startCol,
            next.endZ,
            next.endRow,
            next.endCol,
          )
        : this.computeH(
            next.startZ,
            next.startRow,
            next.startCol,
            next.endZ,
            next.endRow,
            next.endCol,
          )
      const f = h * this.hyperParameters.greedyMultiplier
      this.nodePool.push({
        z: next.startZ,
        row: next.startRow,
        col: next.startCol,
        g: 0,
        f,
        parentIdx: -1,
        ripped: null,
      })
      this.heap.push(f, this.seqCounter++, 0)
      return
    }

    // 2. Per-search budget check
    this.searchIterations++
    const connRips = this.ripCount[this.activeConnId] ?? 0
    const budget = Math.round(
      this.baseSearchBudgetIters * (1 + Math.min(connRips, 10) * 0.25),
    )
    if (this.searchIterations > budget) {
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
      this.nodePool = []
      this.consecutiveSkips++
      if (this.consecutiveSkips >= this.unsolvedSegs.length * 3) {
        this.error = `Convergence failure: ${this.unsolvedSegs.length} connections stuck`
        this.failed = true
      }
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
    const node = this.nodePool[nodeIdx]!
    const { z, row, col, g, ripped } = node

    // 4. Skip if already visited (stamp check)
    const cellIdx = (z * this.rows + row) * this.cols + col
    if (this.visitedStamp[cellIdx] === this.stamp) return
    this.visitedStamp[cellIdx] = this.stamp

    // 5. Check end condition
    const seg = this.activeConnSeg
    if (z === seg.endZ && row === seg.endRow && col === seg.endCol) {
      if (cache) this.finalizeRoute(nodeIdx, cache)
      else this.finalizeRoute(nodeIdx)
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
      const h = cache
        ? this.getCachedHeuristic(cache, nIdx, z, nr, nc, endZ, endRow, endCol)
        : this.computeH(z, nr, nc, endZ, endRow, endCol)
      const f2 = g2 + h * this.hyperParameters.greedyMultiplier

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
        const h = cache
          ? this.getCachedHeuristic(
              cache,
              nIdx,
              nz,
              row,
              col,
              endZ,
              endRow,
              endCol,
            )
          : this.computeH(nz, row, col, endZ, endRow, endCol)
        const f2 = g2 + h * this.hyperParameters.greedyMultiplier

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
  protected getRipCost(connId: ConnId): number {
    return (
      this.hyperParameters.ripCost *
      (1 + this.ripHistoryCostMultiplier * (this.ripCount[connId] ?? 0))
    )
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

    if (fromZ !== toZ) {
      // Via transition
      cost += this.hyperParameters.viaBaseCost
      cost += Math.min(this.penalty2d[toRow * cols + toCol]!, this.penaltyCap)

      const toFlatIdx = (toZ * this.rows + toRow) * cols + toCol
      const fixedOwner = this.portOwnerFlat[toFlatIdx]!
      const fixedSameRoot =
        this.connIdToRootNet[fixedOwner] === this.connIdToRootNet[activeConn]
      const allowFixedOverlap =
        fixedSameRoot &&
        this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
      const seg = this.activeConnSeg
      const isSegEnd =
        !!seg &&
        toZ === seg.endZ &&
        toRow === seg.endRow &&
        toCol === seg.endCol
      if (
        fixedOwner >= 0 &&
        fixedOwner !== activeConn &&
        !allowFixedOverlap &&
        !isSegEnd
      ) {
        this._moveCost = -1
        this._moveRipped = r
        return
      }

      // Via footprint occupants (reusable scratch array)
      this.fillViaOccupants(toRow, toCol, activeConn)
      const occs = this._viaOccs
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

      const flatIdx = (toZ * this.rows + toRow) * cols + toCol
      const fixedOwner = this.portOwnerFlat[flatIdx]!
      const fixedSameRoot =
        this.connIdToRootNet[fixedOwner] === this.connIdToRootNet[activeConn]
      const allowFixedOverlap =
        fixedSameRoot &&
        this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
      const seg = this.activeConnSeg
      const isSegEnd =
        !!seg &&
        toZ === seg.endZ &&
        toRow === seg.endRow &&
        toCol === seg.endCol
      if (
        fixedOwner >= 0 &&
        fixedOwner !== activeConn &&
        !allowFixedOverlap &&
        !isSegEnd
      ) {
        this._moveCost = -1
        this._moveRipped = r
        return
      }

      const occ = this.usedCellsFlat[flatIdx]!
      const sameRoot =
        this.connIdToRootNet[occ] === this.connIdToRootNet[activeConn]
      const allowSameRootOverlap =
        sameRoot &&
        this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
      if (occ !== -1 && occ !== activeConn && !allowSameRootOverlap) {
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
        const crossingSameRoot =
          this.connIdToRootNet[crossingOcc] === this.connIdToRootNet[activeConn]
        const allowCrossingOverlap =
          crossingSameRoot &&
          this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
        if (
          crossingOcc !== -1 &&
          crossingOcc !== activeConn &&
          !allowCrossingOverlap
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

  // --- Via footprint unique occupants (fills _viaOccs scratch array) ---
  private fillViaOccupants(row: number, col: number, activeConn: ConnId): void {
    const occs = this._viaOccs
    occs.length = 0
    const cellId = row * this.cols + col
    const cachedOccupants = this.viaOccupantsByCell.get(cellId)
    if (cachedOccupants) {
      for (const connId of cachedOccupants) occs.push(connId)
      return
    }
    const rows = this.rows
    const cols = this.cols
    const offDr = this.viaOccupantScanOffsetsDr
    const offDc = this.viaOccupantScanOffsetsDc
    const offLen = this.viaOccupantScanOffsetsLen
    const used = this.usedCellsFlat

    for (let z = 0; z < this.layers; z++) {
      const zBase = z * this.planeSize
      for (let i = 0; i < offLen; i++) {
        const r = row + offDr[i]!
        const c = col + offDc[i]!
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue
        const occ = used[zBase + r * cols + c]!
        if (occ === -1 || occ === activeConn) continue
        const sameRoot =
          this.connIdToRootNet[occ] === this.connIdToRootNet[activeConn]
        if (
          sameRoot &&
          this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
        ) {
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
    // Keep the cached list separate from the mutable scratch array.
    this.viaOccupantsByCell.set(cellId, occs.slice())
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
    this.stamp = (this.stamp + 1) >>> 0
    if (this.stamp === 0) {
      this.visitedStamp.fill(0)
      this.stamp = 1
    }
  }

  private getHeuristicCacheForStep(): NativeHeuristicCache | undefined {
    // Constructor registration excludes Proxy receivers. Native setup owns all
    // private search containers; subclasses and custom kernels stay ordinary.
    const ownedHyperParameters = getOwnedHeuristicHyperParameters(this)
    if (!ownedHyperParameters) return undefined
    if (getPrototype(this) !== HighDensitySolverA01.prototype) {
      nativeReleaseHeuristicCache(this)
      return undefined
    }
    // The portfolio batches 1000 native expansions. For smaller public steps,
    // repeated eligibility and exposed-route scans exceed the arithmetic saved.
    const stepDescriptor = getOwnDescriptor(this, "stepMultiplier")
    if (
      !stepDescriptor ||
      !hasOwn(stepDescriptor, "value") ||
      !isSafeInteger(stepDescriptor.value) ||
      stepDescriptor.value < 1000
    ) {
      nativeReleaseHeuristicCache(this)
      return undefined
    }
    if (!hasNativeObjectPrototype()) {
      nativeReleaseHeuristicCache(this)
      return undefined
    }
    const descriptors = getOwnDescriptors(this) as PropertyDescriptorMap
    if (
      !hasOnlyOwnDataDescriptors(descriptors) ||
      !cacheIntrinsicsWereNative ||
      hasExposedUnsolvedConnections(descriptors.unsolvedSegs?.value)
    ) {
      nativeReleaseHeuristicCache(this)
      return undefined
    }
    for (let index = 0; index < nativeHeuristicMethods.length; index++) {
      const { name, value } = nativeHeuristicMethods[index]!
      const descriptor =
        descriptors[name] ??
        getOwnDescriptor(HighDensitySolverA01.prototype, name)
      if (
        !descriptor ||
        !hasOwn(descriptor, "value") ||
        descriptor.value !== value
      ) {
        nativeReleaseHeuristicCache(this)
        return undefined
      }
    }
    for (let index = 0; index < nativeCacheIntrinsics.length; index++) {
      const { owner, name, value } = nativeCacheIntrinsics[index]!
      const descriptor = getOwnDescriptor(owner, name)
      if (
        !descriptor ||
        !hasOwn(descriptor, "value") ||
        descriptor.value !== value
      ) {
        nativeReleaseHeuristicCache(this)
        return undefined
      }
    }
    for (let index = 0; index < nativeIteratorChains.length; index++) {
      const { owner, parent } = nativeIteratorChains[index]!
      if (
        getPrototype(owner) !== parent ||
        getOwnDescriptor(owner, "return") !== undefined
      ) {
        nativeReleaseHeuristicCache(this)
        return undefined
      }
    }
    if (
      getOwnDescriptor(nativeGlobal, "Math")?.value !== nativeMath ||
      getOwnDescriptor(nativeArray, nativeSpeciesSymbol)?.get !==
        nativeArraySpecies ||
      getOwnDescriptor(nativeMath, "SQRT2")?.value !== nativeSqrt2 ||
      getOwnDescriptor(nativeMapPrototype, "size")?.get !== nativeMapSize ||
      getOwnDescriptor(nativeSetPrototype, "size")?.get !== nativeSetSize ||
      getOwnDescriptor(nativeTypedArrayPrototype, "fill")?.value !==
        nativeTypedArrayFill ||
      getOwnDescriptor(nativeTypedArrayPrototype, "length")?.get !==
        nativeTypedArrayLength ||
      getOwnDescriptor(NativeUint32Array.prototype, "fill") !== undefined ||
      getOwnDescriptor(NativeUint32Array.prototype, "length") !== undefined ||
      getOwnDescriptor(NativeFloat64Array.prototype, "length") !== undefined ||
      getPrototype(NativeUint32Array.prototype) !== nativeTypedArrayPrototype ||
      getPrototype(NativeFloat64Array.prototype) !==
        nativeTypedArrayPrototype ||
      getPrototype(nativeTypedArrayPrototype) !== nativeObjectPrototype ||
      getPrototype(nativeArrayPrototype) !== nativeObjectPrototype ||
      getPrototype(nativeObjectPrototype) !== null ||
      hasNumericPrototypeProperties(nativeArrayPrototype) ||
      hasNumericPrototypeProperties(nativeObjectPrototype) ||
      descriptors.hyperParameters?.value !== ownedHyperParameters ||
      getPrototype(ownedHyperParameters) !== nativeObjectPrototype
    ) {
      nativeReleaseHeuristicCache(this)
      return undefined
    }
    const hyperDescriptors = getOwnDescriptors(ownedHyperParameters)
    if (!hasOnlyOwnDataDescriptors(hyperDescriptors)) {
      nativeReleaseHeuristicCache(this)
      return undefined
    }
    const hyperNames = [
      "shuffleSeed",
      "ripCost",
      "ripTracePenalty",
      "ripViaPenalty",
      "viaBaseCost",
      "greedyMultiplier",
    ]
    for (let index = 0; index < hyperNames.length; index++) {
      if (!isFiniteNumber(hyperDescriptors[hyperNames[index]!]?.value)) {
        nativeReleaseHeuristicCache(this)
        return undefined
      }
    }
    const publicNumericNames = [
      "traceMargin",
      "MAX_RIPS",
      "MAX_ITERATIONS",
      "iterations",
      "ripHistoryCostMultiplier",
    ]
    for (let index = 0; index < publicNumericNames.length; index++) {
      if (!isFiniteNumber(descriptors[publicNumericNames[index]!]?.value)) {
        nativeReleaseHeuristicCache(this)
        return undefined
      }
    }
    const rows = descriptors.rows?.value
    const cols = descriptors.cols?.value
    const layers = descriptors.layers?.value
    if (
      !isSafeInteger(rows) ||
      rows <= 0 ||
      !isSafeInteger(cols) ||
      cols <= 0 ||
      !isSafeInteger(layers) ||
      layers <= 0
    ) {
      nativeReleaseHeuristicCache(this)
      return undefined
    }
    const totalStates = rows * cols * layers
    const signature = [
      rows,
      cols,
      layers,
      descriptors.cellSizeMm?.value,
      descriptors.crossLayerSearch?.value ? 1 : 0,
      hyperDescriptors.viaBaseCost!.value,
      descriptors.minViaRow?.value,
      descriptors.maxViaRow?.value,
      descriptors.minViaCol?.value,
      descriptors.maxViaCol?.value,
    ]
    if (
      typeof descriptors.solved?.value !== "boolean" ||
      typeof descriptors.failed?.value !== "boolean" ||
      typeof descriptors.crossLayerSearch?.value !== "boolean" ||
      !isSafeInteger(rows) ||
      rows <= 0 ||
      !isSafeInteger(cols) ||
      cols <= 0 ||
      !isSafeInteger(layers) ||
      layers <= 0 ||
      !isSafeInteger(totalStates) ||
      totalStates > MAX_HEURISTIC_CACHE_STATES ||
      !isSafeInteger(descriptors.stepMultiplier?.value) ||
      descriptors.stepMultiplier!.value <= 0 ||
      descriptors.planeSize?.value !== rows * cols ||
      typeof descriptors.visitedStamp?.value !== "object" ||
      descriptors.visitedStamp!.value === null ||
      getPrototype(descriptors.visitedStamp!.value) !==
        NativeUint32Array.prototype ||
      descriptors.visitedStamp!.value.length !== totalStates ||
      !signature.every(isFiniteNumber)
    ) {
      nativeReleaseHeuristicCache(this)
      return undefined
    }
    if (
      hasExposedSolvedConnections(descriptors.solvedRoutes?.value) &&
      !validateExposedSolvedRoutes(descriptors.solvedRoutes?.value)
    ) {
      nativeReleaseHeuristicCache(this)
      return undefined
    }
    let cache = this.heuristicCache
    if (cache && cache.values.length !== totalStates) {
      nativeReleaseHeuristicCache(this)
      cache = undefined
    }
    if (!cache) {
      const bytes = totalStates * 12
      if (allocatedHeuristicCacheBytes + bytes > MAX_HEURISTIC_CACHE_BYTES)
        return undefined
      cache = {
        values: new NativeFloat64Array(totalStates),
        epochs: new NativeUint32Array(totalStates),
        epoch: 1,
        bytes,
        signature,
        goalZ: -1,
        goalRow: -1,
        goalCol: -1,
        searchStamp: -1,
      }
      this.heuristicCache = cache
      allocatedHeuristicCacheBytes += bytes
    } else if (
      !cache.signature.every((value, index) =>
        sameNumber(value, signature[index]),
      )
    ) {
      this.resetHeuristicEpoch(cache)
      cache.signature = signature
    }
    return cache
  }

  private resetHeuristicEpoch(cache: NativeHeuristicCache): void {
    cache.epoch = (cache.epoch + 1) >>> 0
    if (cache.epoch === 0) {
      cache.epochs.fill(0)
      cache.epoch = 1
    }
  }

  private releaseHeuristicCache(): void {
    const cache = this.heuristicCache
    if (!cache) return
    allocatedHeuristicCacheBytes -= cache.bytes
    this.heuristicCache = undefined
  }

  private getCachedHeuristic(
    cache: NativeHeuristicCache,
    index: number,
    z: number,
    row: number,
    col: number,
    toZ: number,
    toRow: number,
    toCol: number,
  ): number {
    if (
      cache.goalZ !== toZ ||
      cache.goalRow !== toRow ||
      cache.goalCol !== toCol ||
      cache.searchStamp !== this.stamp
    ) {
      this.resetHeuristicEpoch(cache)
      cache.goalZ = toZ
      cache.goalRow = toRow
      cache.goalCol = toCol
      cache.searchStamp = this.stamp
    }
    if (
      z < 0 ||
      z >= this.layers ||
      row < 0 ||
      row >= this.rows ||
      col < 0 ||
      col >= this.cols ||
      !isSafeInteger(index) ||
      index < 0 ||
      index >= cache.values.length
    ) {
      return this.computeH(z, row, col, toZ, toRow, toCol)
    }
    if (cache.epochs[index] === cache.epoch) return cache.values[index]!
    const value = this.computeH(z, row, col, toZ, toRow, toCol)
    if (isFiniteNumber(value)) {
      cache.values[index] = value
      cache.epochs[index] = cache.epoch
    }
    return value
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
  private finalizeRoute(
    goalNodeIdx: number,
    cache?: NativeHeuristicCache,
  ): void {
    this.consecutiveSkips = Math.max(0, this.consecutiveSkips - 1)

    // Reconstruct path from parent chain (cell-based)
    const cells: Array<{ z: number; row: number; col: number }> = []
    let idx = goalNodeIdx
    while (idx >= 0) {
      const n = this.nodePool[idx]!
      cells.push({ z: n.z, row: n.row, col: n.col })
      idx = n.parentIdx
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
    const goalNode = this.nodePool[goalNodeIdx]!
    const rippedIds: ConnId[] = []
    for (let cur = goalNode.ripped; cur; cur = cur.prev) {
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
    const existingSolvedRoutes = this.solvedRoutes.get(connId)
    const solvedRoutes = existingSolvedRoutes ?? []
    if (
      cache &&
      (existingSolvedRoutes === undefined || existingSolvedRoutes === null)
    ) {
      setNativeRouteObjectKind(solvedRoutes, "routes")
    }
    const solvedRoute = {
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
    }
    if (cache) {
      setNativeRouteObjectKind(solvedRoute, "route")
      setNativeRouteObjectKind(cells, "cells")
      setNativeRouteObjectKind(viaCells, "vias")
      for (let index = 0; index < cells.length; index++) {
        setNativeRouteObjectKind(cells[index]!, "cell")
      }
      for (let index = 0; index < viaCells.length; index++) {
        setNativeRouteObjectKind(viaCells[index]!, "via")
      }
    }
    solvedRoutes.push(solvedRoute)
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

const nativePrepareHeuristicCache = Function.prototype.call.bind(
  HighDensitySolverA01.prototype["getHeuristicCacheForStep"],
) as (solver: HighDensitySolverA01) => NativeHeuristicCache | undefined
const nativeReleaseHeuristicCache = Function.prototype.call.bind(
  HighDensitySolverA01.prototype["releaseHeuristicCache"],
) as (solver: HighDensitySolverA01) => void
const nativeHeuristicMethods = [
  "_setup",
  "_step",
  "stepOnce",
  "computeH",
  "getRipCost",
  "computeMoveCostAndRips",
  "fillViaOccupants",
  "fillTraceSegmentViaOccupants",
  "nextStamp",
  "finalizeRoute",
  "ripTrace",
  "shouldSkipFixedPortHalo",
  "getHeuristicCacheForStep",
  "getCachedHeuristic",
  "resetHeuristicEpoch",
  "releaseHeuristicCache",
].map((name) => ({
  name,
  value: getOwnDescriptor(HighDensitySolverA01.prototype, name)!.value,
}))
