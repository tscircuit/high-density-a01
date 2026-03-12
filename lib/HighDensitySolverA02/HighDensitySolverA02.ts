import { BaseSolver } from "@tscircuit/solver-utils"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../types"

type ConnId = number

interface RippedNode {
  id: ConnId
  prev: RippedNode | null
}

function rippedContains(r: RippedNode | null, id: ConnId): boolean {
  for (let cur = r; cur; cur = cur.prev) {
    if (cur.id === id) return true
  }
  return false
}

interface SearchNode {
  z: number
  cellId: number
  g: number
  f: number
  parentIdx: number
  ripped: RippedNode | null
}

interface ConnectionSeg {
  connId: ConnId
  startZ: number
  startCellId: number
  endZ: number
  endCellId: number
}

interface SolvedRouteInternal {
  connId: ConnId
  cells: Array<{ z: number; cellId: number }>
  viaCellIds: number[]
}

interface HyperParameters {
  shuffleSeed: number
  ripCost: number
  ripTracePenalty: number
  ripViaPenalty: number
  viaBaseCost: number
  greedyMultiplier: number
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
  maxCellCount?: number
  stepMultiplier?: number
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
  maxCellCount?: number
  traceThickness: number
  traceMargin: number
  viaMinDistFromBorder: number
  showPenaltyMap: boolean
  showUsedCellMap: boolean
  stepMultiplier: number
  hyperParameters: HyperParameters
  initialPenaltyFn?: HighDensitySolverA02Props["initialPenaltyFn"]

  boundsMinX!: number
  boundsMaxX!: number
  boundsMinY!: number
  boundsMaxY!: number

  cells!: CompositeCell[]
  cellNeighbors!: NeighborEdge[][]
  traceKeepoutCells!: number[][]
  viaFootprintCells!: number[][]
  viaAllowed!: Uint8Array

  availableZ!: number[]
  zToLayer!: Map<number, number>
  layerToZ!: Map<number, number>
  layers!: number

  private planeSize!: number
  private usedCellsFlat!: Int32Array
  private portOwnerFlat!: Int32Array
  private penalty2d!: Float64Array
  private visitedStamp!: Uint32Array
  private sharedCrossRootPortCells!: Set<number>
  private stamp = 0

  private connNameToId!: Map<string, ConnId>
  private connIdToName!: string[]
  private connIdToRootNet!: string[]
  private overlapFriendlyRootNets!: Set<string>

  private usedIndicesByConn!: number[][]
  private unsolvedSegs!: ConnectionSeg[]
  private solvedRoutes!: Map<ConnId, SolvedRouteInternal>

  private activeConnSeg: ConnectionSeg | null = null
  private activeConnId: ConnId = -1
  private crossLayerSearch = false
  private nodePool!: SearchNode[]
  private heap!: MinHeap
  private seqCounter = 0

  private _viaOccs: ConnId[] = []
  private ripCount!: number[]
  private totalRipEvents = 0
  private searchIterations = 0
  private consecutiveSkips = 0
  private penaltyCap!: number

  private _moveCost = 0
  private _moveRipped: RippedNode | null = null

  get unsolvedConnections() {
    return this.unsolvedSegs
  }

  get solvedConnectionsMap() {
    return this.solvedRoutes
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

  constructor(props: HighDensitySolverA02Props) {
    super()
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.outerGridCellSize = props.outerGridCellSize
    this.outerGridCellThickness = props.outerGridCellThickness
    this.innerGridCellSize = props.innerGridCellSize
    this.viaDiameter = props.viaDiameter
    this.maxCellCount = props.maxCellCount
    this.traceThickness = props.traceThickness ?? 0.1
    this.traceMargin = props.traceMargin ?? 0.15
    this.viaMinDistFromBorder = props.viaMinDistFromBorder ?? 0.15
    this.showPenaltyMap = props.showPenaltyMap ?? false
    this.showUsedCellMap = props.showUsedCellMap ?? false
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
    this.MAX_ITERATIONS = 100e6
    this.initialPenaltyFn = props.initialPenaltyFn
  }

  override _setup(): void {
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

    const {
      cells,
      cellNeighbors,
      traceKeepoutCells,
      viaFootprintCells,
      viaAllowed,
    } = this.buildCompositeGrid()

    this.cells = cells
    this.cellNeighbors = cellNeighbors
    this.traceKeepoutCells = traceKeepoutCells
    this.viaFootprintCells = viaFootprintCells
    this.viaAllowed = viaAllowed

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
    if (this.initialPenaltyFn) {
      const widthInv = width > 0 ? 1 / width : 0
      const heightInv = height > 0 ? 1 / height : 0
      for (const cell of this.cells) {
        this.penalty2d[cell.id] = this.initialPenaltyFn({
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
    }

    this.usedCellsFlat = new Int32Array(totalCells).fill(-1)
    this.portOwnerFlat = new Int32Array(totalCells).fill(-1)
    this.visitedStamp = new Uint32Array(totalCells)
    this.stamp = 0

    this.unsolvedSegs = this.buildConnectionSegs()

    this.sharedCrossRootPortCells = new Set()
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
    this.ripCount = []
    this.consecutiveSkips = 0
    this.penaltyCap = this.hyperParameters.ripCost * 0.5
    this.shuffleConnections()

    this.activeConnSeg = null
    this.activeConnId = -1
    this.nodePool = []
    this.heap = new MinHeap()
    this.seqCounter = 0
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
    const holeMaxX =
      outerX[Math.max(0, outerX.length - thicknessCols - 1)]?.max
    const holeMinY = outerY[Math.min(thicknessRows, outerY.length - 1)]?.min
    const holeMaxY =
      outerY[Math.max(0, outerY.length - thicknessRows - 1)]?.max

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
    const traceKeepoutCells: number[][] = Array.from(
      { length: cells.length },
      () => [],
    )
    const viaFootprintCells: number[][] = Array.from(
      { length: cells.length },
      () => [],
    )
    const viaAllowed = new Uint8Array(cells.length)

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!
      const minBorderDist = Math.min(
        cell.centerX - this.boundsMinX,
        this.boundsMaxX - cell.centerX,
        cell.centerY - this.boundsMinY,
        this.boundsMaxY - cell.centerY,
      )
      viaAllowed[i] = minBorderDist >= this.viaMinDistFromBorder ? 1 : 0

      for (let j = 0; j < cells.length; j++) {
        const other = cells[j]!
        if (rectDistanceSq(cell, other) <= this.traceMargin * this.traceMargin) {
          traceKeepoutCells[i]!.push(j)
        }
        if (
          circleIntersectsRect(cell.centerX, cell.centerY, viaRadius, other)
        ) {
          viaFootprintCells[i]!.push(j)
        }
      }
    }

    return {
      cells,
      cellNeighbors,
      traceKeepoutCells,
      viaFootprintCells,
      viaAllowed,
    }
  }

  private stepOnce(): void {
    if (!this.activeConnSeg) {
      if (this.unsolvedSegs.length === 0) {
        this.solved = true
        return
      }

      const next = this.unsolvedSegs.shift()!
      this.activeConnSeg = next
      this.activeConnId = next.connId
      this.crossLayerSearch = next.startZ !== next.endZ

      this.nodePool = []
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
      this.nodePool.push({
        z: next.startZ,
        cellId: next.startCellId,
        g: 0,
        f,
        parentIdx: -1,
        ripped: null,
      })
      this.heap.push(f, this.seqCounter++, 0)
      return
    }

    this.searchIterations++
    const connRips = this.ripCount[this.activeConnId] ?? 0
    if (
      this.unsolvedSegs.length <= 1 &&
      this.MAX_ITERATIONS - this.iterations <= 50_000 &&
      this.tryLastConnectionFallback(this.activeConnSeg)
    ) {
      this.activeConnSeg = null
      this.activeConnId = -1
      this.heap.clear()
      this.nodePool = []
      return
    }

    const baseBudget = this.planeSize * this.layers * 60
    const budget = Math.min(
      baseBudget * (1 + connRips * 0.5),
      this.planeSize * this.layers * 600,
    )
    if (this.searchIterations > budget) {
      if (
        this.unsolvedSegs.length <= 1 &&
        this.tryLastConnectionFallback(this.activeConnSeg)
      ) {
        this.activeConnSeg = null
        this.activeConnId = -1
        this.heap.clear()
        this.nodePool = []
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
      this.nodePool = []
      this.consecutiveSkips++
      if (this.consecutiveSkips >= Math.max(3, this.unsolvedSegs.length * 3)) {
        this.error = `Convergence failure: ${this.unsolvedSegs.length} connections stuck`
        this.failed = true
      }
      return
    }

    if (this.heap.size === 0) {
      this.error = `No path found for ${this.connIdToName[this.activeConnId]}`
      this.failed = true
      return
    }

    const nodeIdx = this.heap.pop()
    const node = this.nodePool[nodeIdx]!
    const { z, cellId, g, ripped } = node

    const flatIdx = z * this.planeSize + cellId
    if (this.visitedStamp[flatIdx] === this.stamp) return
    this.visitedStamp[flatIdx] = this.stamp

    const seg = this.activeConnSeg
    if (z === seg.endZ && cellId === seg.endCellId) {
      this.finalizeRoute(nodeIdx)
      this.activeConnSeg = null
      this.activeConnId = -1
      return
    }

    const visited = this.visitedStamp
    const stamp = this.stamp
    const activeConn = this.activeConnId
    const endZ = seg.endZ
    const endCellId = seg.endCellId

    const neighbors = this.cellNeighbors[cellId]!
    for (let i = 0; i < neighbors.length; i++) {
      const neighbor = neighbors[i]!
      const nextFlatIdx = z * this.planeSize + neighbor.cellId
      if (visited[nextFlatIdx] === stamp) continue

      this.computeMoveCostAndRips(
        activeConn,
        z,
        cellId,
        z,
        neighbor.cellId,
        ripped,
        neighbor.cost,
      )
      if (this._moveCost < 0) continue

      const g2 = g + this._moveCost
      const f2 =
        g2 +
        this.computeH(z, neighbor.cellId, endZ, endCellId) *
          this.hyperParameters.greedyMultiplier

      const newNodeIdx = this.nodePool.length
      this.nodePool.push({
        z,
        cellId: neighbor.cellId,
        g: g2,
        f: f2,
        parentIdx: nodeIdx,
        ripped: this._moveRipped,
      })
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
          ripped,
          0,
        )
        if (this._moveCost < 0) continue

        const g2 = g + this._moveCost
        const f2 =
          g2 +
          this.computeH(nz, cellId, endZ, endCellId) *
            this.hyperParameters.greedyMultiplier

        const newNodeIdx = this.nodePool.length
        this.nodePool.push({
          z: nz,
          cellId,
          g: g2,
          f: f2,
          parentIdx: nodeIdx,
          ripped: this._moveRipped,
        })
        this.heap.push(f2, this.seqCounter++, newNodeIdx)
      }
    }
  }

  private computeMoveCostAndRips(
    activeConn: ConnId,
    fromZ: number,
    fromCellId: number,
    toZ: number,
    toCellId: number,
    ripped: RippedNode | null,
    lateralCost: number,
  ): void {
    let cost = 0
    let r = ripped
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
        this._moveRipped = r
        return
      }

      this.fillViaOccupants(toCellId, activeConn)
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
        this._moveRipped = r
        return
      }

      const occ = this.usedCellsFlat[toFlatIdx]!
      const sameRoot =
        this.connIdToRootNet[occ] === this.connIdToRootNet[activeConn]
      const allowSameRootOverlap =
        sameRoot &&
        this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
      if (occ !== -1 && occ !== activeConn && !allowSameRootOverlap) {
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

  private fillViaOccupants(cellId: number, activeConn: ConnId): void {
    const occs = this._viaOccs
    occs.length = 0
    const footprint = this.viaFootprintCells[cellId]!

    for (let z = 0; z < this.layers; z++) {
      const zBase = z * this.planeSize
      for (let i = 0; i < footprint.length; i++) {
        const occCellId = footprint[i]!
        const occ = this.usedCellsFlat[zBase + occCellId]!
        if (occ === -1 || occ === activeConn) continue
        const sameRoot =
          this.connIdToRootNet[occ] === this.connIdToRootNet[activeConn]
        if (
          sameRoot &&
          this.overlapFriendlyRootNets.has(this.connIdToRootNet[activeConn]!)
        ) {
          continue
        }
        pushUnique(occs, occ)
      }
    }
  }

  private nextStamp(): void {
    this.stamp = (this.stamp + 1) >>> 0
    if (this.stamp === 0) {
      this.visitedStamp.fill(0)
      this.stamp = 1
    }
  }

  private computeH(
    z: number,
    cellId: number,
    toZ: number,
    toCellId: number,
  ): number {
    const cell = this.cells[cellId]!
    const target = this.cells[toCellId]!
    const dist = Math.hypot(
      cell.centerX - target.centerX,
      cell.centerY - target.centerY,
    )

    if (z === toZ) return dist
    return dist + this.hyperParameters.viaBaseCost
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
    let bestCell = this.cells[0]!
    let bestDistanceSq = Number.POSITIVE_INFINITY
    let bestArea = Number.POSITIVE_INFINITY

    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]!
      const dx =
        pt.x < cell.minX ? cell.minX - pt.x : pt.x > cell.maxX ? pt.x - cell.maxX : 0
      const dy =
        pt.y < cell.minY ? cell.minY - pt.y : pt.y > cell.maxY ? pt.y - cell.maxY : 0
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

    const cells: Array<{ z: number; cellId: number }> = []
    let idx = goalNodeIdx
    while (idx >= 0) {
      const n = this.nodePool[idx]!
      cells.push({ z: n.z, cellId: n.cellId })
      idx = n.parentIdx
    }
    cells.reverse()

    while (cells.length > 1) {
      const first = cells[0]!
      const firstFlat = first.z * this.planeSize + first.cellId
      if (!this.sharedCrossRootPortCells.has(firstFlat)) break
      cells.shift()
    }
    while (cells.length > 1) {
      const last = cells[cells.length - 1]!
      const lastFlat = last.z * this.planeSize + last.cellId
      if (!this.sharedCrossRootPortCells.has(lastFlat)) break
      cells.pop()
    }

    const viaCellIds: number[] = []
    for (let i = 1; i < cells.length; i++) {
      if (cells[i]!.z !== cells[i - 1]!.z) {
        viaCellIds.push(cells[i]!.cellId)
      }
    }

    const connId = this.activeConnId
    const goalNode = this.nodePool[goalNodeIdx]!
    const rippedIds: ConnId[] = []
    for (let cur = goalNode.ripped; cur; cur = cur.prev) {
      rippedIds.push(cur.id)
    }
    this.commitRoute(connId, cells, rippedIds, viaCellIds)
  }

  private commitRoute(
    connId: ConnId,
    cells: Array<{ z: number; cellId: number }>,
    rippedIds: ConnId[],
    viaCellIds?: number[],
  ) {
    const normalizedCells = cells.slice()

    while (normalizedCells.length > 1) {
      const first = normalizedCells[0]!
      const firstFlat = first.z * this.planeSize + first.cellId
      if (!this.sharedCrossRootPortCells.has(firstFlat)) break
      normalizedCells.shift()
    }
    while (normalizedCells.length > 1) {
      const last = normalizedCells[normalizedCells.length - 1]!
      const lastFlat = last.z * this.planeSize + last.cellId
      if (!this.sharedCrossRootPortCells.has(lastFlat)) break
      normalizedCells.pop()
    }

    const routeViaCellIds = viaCellIds
      ? viaCellIds.slice()
      : this.extractViaCellIds(normalizedCells)

    for (let i = 0; i < rippedIds.length; i++) {
      this.ripTrace(rippedIds[i]!)
    }

    const indices: number[] = []
    for (let i = 0; i < normalizedCells.length; i++) {
      const routeCell = normalizedCells[i]!
      const keepouts = this.traceKeepoutCells[routeCell.cellId]!
      for (let j = 0; j < keepouts.length; j++) {
        const occCellId = keepouts[j]!
        const flatIdx = routeCell.z * this.planeSize + occCellId
        const existing = this.usedCellsFlat[flatIdx]!
        const sameRoot =
          this.connIdToRootNet[existing] === this.connIdToRootNet[connId]
        const allowSameRootOverlap =
          sameRoot &&
          this.overlapFriendlyRootNets.has(this.connIdToRootNet[connId]!)
        if (existing !== -1 && existing !== connId && !allowSameRootOverlap) {
          continue
        }
        this.usedCellsFlat[flatIdx] = connId
        indices.push(flatIdx)
      }
    }

    const displacedByVias: ConnId[] = []
    for (let i = 0; i < routeViaCellIds.length; i++) {
      const viaCellId = routeViaCellIds[i]!
      const footprint = this.viaFootprintCells[viaCellId]!
      for (let z = 0; z < this.layers; z++) {
        const zBase = z * this.planeSize
        for (let j = 0; j < footprint.length; j++) {
          const occCellId = footprint[j]!
          const flatIdx = zBase + occCellId
          const existing = this.usedCellsFlat[flatIdx]!
          const sameRoot =
            this.connIdToRootNet[existing] === this.connIdToRootNet[connId]
          const allowSameRootOverlap =
            sameRoot &&
            this.overlapFriendlyRootNets.has(this.connIdToRootNet[connId]!)
          if (existing !== -1 && existing !== connId && !allowSameRootOverlap) {
            pushUnique(displacedByVias, existing)
          }
          this.usedCellsFlat[flatIdx] = connId
          indices.push(flatIdx)
        }
      }
    }

    while (this.usedIndicesByConn.length <= connId) {
      this.usedIndicesByConn.push([])
    }
    this.usedIndicesByConn[connId] = indices
    this.solvedRoutes.set(connId, {
      connId,
      cells: normalizedCells,
      viaCellIds: routeViaCellIds,
    })

    for (let i = 0; i < displacedByVias.length; i++) {
      this.ripTrace(displacedByVias[i]!)
    }

    if (rippedIds.length > 0 || displacedByVias.length > 0) {
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

  private extractViaCellIds(cells: Array<{ z: number; cellId: number }>) {
    const viaCellIds: number[] = []
    for (let i = 1; i < cells.length; i++) {
      if (cells[i]!.z !== cells[i - 1]!.z) {
        viaCellIds.push(cells[i]!.cellId)
      }
    }
    return viaCellIds
  }

  private tryLastConnectionFallback(seg: ConnectionSeg) {
    const stateCount = this.layers * this.planeSize
    const gScore = new Float64Array(stateCount)
    gScore.fill(Number.POSITIVE_INFINITY)
    const parent = new Int32Array(stateCount).fill(-1)
    const closed = new Uint8Array(stateCount)
    const heap = new MinHeap()
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
      const neighbors = this.cellNeighbors[cellId]!

      for (let i = 0; i < neighbors.length; i++) {
        const neighbor = neighbors[i]!
        const nextIdx = z * this.planeSize + neighbor.cellId
        if (closed[nextIdx]) continue
        if (
          !this.canUseFallbackState(this.activeConnId, z, neighbor.cellId, seg)
        ) {
          continue
        }

        const nextG = baseG + neighbor.cost + this.penalty2d[neighbor.cellId]!
        if (nextG >= gScore[nextIdx]!) continue
        gScore[nextIdx] = nextG
        parent[nextIdx] = stateIdx
        heap.push(
          nextG + this.computeH(z, neighbor.cellId, seg.endZ, seg.endCellId),
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

    const cells: Array<{ z: number; cellId: number }> = []
    let cur = endIdx
    while (cur >= 0) {
      const z = Math.floor(cur / this.planeSize)
      const cellId = cur - z * this.planeSize
      cells.push({ z, cellId })
      cur = parent[cur] ?? -1
    }
    cells.reverse()

    this.consecutiveSkips = Math.max(0, this.consecutiveSkips - 1)
    this.commitRoute(this.activeConnId, cells, [])
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

    const route = this.solvedRoutes.get(connId)
    if (route) {
      for (let i = 0; i < route.cells.length; i++) {
        const cell = route.cells[i]!
        this.penalty2d[cell.cellId] =
          this.penalty2d[cell.cellId]! + this.hyperParameters.ripTracePenalty
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
      this.usedIndicesByConn[connId] = []
    }

    if (route) {
      this.solvedRoutes.delete(connId)
      const first = route.cells[0]!
      const last = route.cells[route.cells.length - 1]!
      this.unsolvedSegs.push({
        connId,
        startZ: first.z,
        startCellId: first.cellId,
        endZ: last.z,
        endCellId: last.cellId,
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

    rects.push({
      center: { x: this.nodeWithPortPoints.center.x, y: this.nodeWithPortPoints.center.y },
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
      title: `HighDensityA02 [${this.solvedRoutes?.size ?? 0} solved, ${this.unsolvedSegs?.length ?? 0} remaining]`,
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const result: HighDensityIntraNodeRoute[] = []

    for (const [connId, route] of this.solvedRoutes) {
      const connName = this.connIdToName[connId]!
      result.push({
        connectionName: connName,
        traceThickness: this.traceThickness,
        viaDiameter: this.viaDiameter,
        route: route.cells.map((cellRef) => {
          const cell = this.cells[cellRef.cellId]!
          return {
            x: cell.centerX,
            y: cell.centerY,
            z: this.layerToZ.get(cellRef.z) ?? cellRef.z,
          }
        }),
        vias: route.viaCellIds.map((cellId) => {
          const cell = this.cells[cellId]!
          return { x: cell.centerX, y: cell.centerY }
        }),
      })
    }

    return result
  }
}

function pushUniqueNeighbor(arr: NeighborEdge[], edge: NeighborEdge) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]!.cellId === edge.cellId) return
  }
  arr.push(edge)
}
