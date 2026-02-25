import { BaseSolver } from "@tscircuit/solver-utils"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../types"

type ConnectionName = string
type CellKey = string

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

interface GridCell {
  row: number
  col: number
  z: number
  x: number
  y: number
}

interface CandidateCell {
  cell: GridCell
  g: number
  f: number
  parent: CandidateCell | null
  rippedTraces: Set<ConnectionName>
}

interface Connection {
  connectionName: ConnectionName
  start: GridCell
  end: GridCell
}

export class HighDensitySolverA01 extends BaseSolver {
  override MAX_ITERATIONS = 500e3
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

  // Z-layer mapping: actual z value <-> layer index
  availableZ!: number[]
  zToLayer!: Map<number, number>
  layerToZ!: Map<number, number>

  // Penalty map: [row][col] -> additional traversal cost
  penaltyMap!: number[][]

  // Used cells: [z][row][col] -> connectionName or null
  usedCells!: (ConnectionName | null)[][][]

  // Track which cells belong to each connection for fast rip
  connectionCellKeys!: Map<ConnectionName, Set<CellKey>>

  // Connection queues
  unsolvedConnections!: Connection[]
  solvedConnectionsMap!: Map<ConnectionName, HighDensityIntraNodeRoute>

  // Current A* state for the active connection
  activeConnection: Connection | null = null
  openSet!: CandidateCell[]
  closedSet!: Set<CellKey>

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
    this.initialPenaltyFn = props.initialPenaltyFn
  }

  override _setup(): void {
    const { nodeWithPortPoints, cellSizeMm } = this
    const { width, height, center } = nodeWithPortPoints
    // Derive available z layers from port points if not provided
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
    this.gridOrigin = {
      x: center.x - width / 2,
      y: center.y - height / 2,
    }

    // Initialize penalty map
    this.penaltyMap = Array.from({ length: this.rows }, (_, row) =>
      Array.from({ length: this.cols }, (_, col) => {
        if (!this.initialPenaltyFn) return 0
        const x = this.gridOrigin.x + (col + 0.5) * cellSizeMm
        const y = this.gridOrigin.y + (row + 0.5) * cellSizeMm
        const px = (col + 0.5) / this.cols
        const py = (row + 0.5) / this.rows
        return this.initialPenaltyFn({ x, y, px, py, row, col })
      }),
    )

    // Initialize used cells: [z][row][col]
    this.usedCells = Array.from({ length: this.layers }, () =>
      Array.from({ length: this.rows }, () =>
        Array<ConnectionName | null>(this.cols).fill(null),
      ),
    )

    // Build connections from port points
    this.unsolvedConnections = this.buildConnectionsFromPortPoints()
    this.solvedConnectionsMap = new Map()
    this.connectionCellKeys = new Map()

    // Shuffle based on seed
    this.shuffleConnections()

    // Reset A* state
    this.activeConnection = null
    this.openSet = []
    this.closedSet = new Set()
  }

  override _step(): void {
    // 1. If no active connection, dequeue the next unsolved one
    if (!this.activeConnection) {
      if (this.unsolvedConnections.length === 0) {
        this.solved = true
        return
      }

      const next = this.unsolvedConnections.shift()
      if (!next) {
        this.solved = true
        return
      }

      this.activeConnection = next
      this.openSet = [
        {
          cell: this.activeConnection.start,
          g: 0,
          f: this.computeH(
            this.activeConnection.start,
            this.activeConnection.end,
          ),
          parent: null,
          rippedTraces: new Set(),
        },
      ]
      this.closedSet = new Set()
      return
    }

    // 2. If open set is empty, this connection failed
    if (this.openSet.length === 0) {
      this.error = `No path found for ${this.activeConnection.connectionName}`
      this.failed = true
      return
    }

    // 3. Dequeue best candidate (lowest f) via O(n) min-extraction
    let bestIdx = 0
    for (let i = 1; i < this.openSet.length; i++) {
      if (this.openSet[i]!.f < this.openSet[bestIdx]!.f) bestIdx = i
    }
    const current = this.openSet[bestIdx]!
    // Swap with last and pop for O(1) removal
    this.openSet[bestIdx] = this.openSet[this.openSet.length - 1]!
    this.openSet.pop()

    const { cell } = current
    const cellKey = this.getCellKey(cell)

    // Skip if already visited
    if (this.closedSet.has(cellKey)) return
    this.closedSet.add(cellKey)

    // 4. Check end condition
    if (
      cell.row === this.activeConnection.end.row &&
      cell.col === this.activeConnection.end.col &&
      cell.z === this.activeConnection.end.z
    ) {
      this.finalizeRoute(current)
      this.activeConnection = null
      return
    }

    // 5. Expand neighbors (8 directions + via)
    for (const neighbor of this.getNeighbors(cell)) {
      if (this.closedSet.has(this.getCellKey(neighbor))) continue

      const g = current.g + this.computeG(cell, neighbor, current.rippedTraces)
      const f = g + this.computeH(neighbor, this.activeConnection.end)

      const rippedTraces = new Set(current.rippedTraces)
      if (neighbor.z !== cell.z) {
        // Via transition: track all connections in via footprint
        const footprintOccupants = this.getViaFootprintOccupants(neighbor)
        for (const occupant of footprintOccupants) {
          if (occupant !== this.activeConnection.connectionName) {
            rippedTraces.add(occupant)
          }
        }
      } else {
        const occupant =
          this.usedCells[neighbor.z]?.[neighbor.row]?.[neighbor.col]
        if (occupant && occupant !== this.activeConnection.connectionName) {
          rippedTraces.add(occupant)
        }
      }

      this.openSet.push({
        cell: neighbor,
        g,
        f,
        parent: current,
        rippedTraces,
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

    // Draw penalty map as transparent rects
    if (this.showPenaltyMap && this.penaltyMap) {
      let maxPenalty = 0
      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          const p = this.penaltyMap[row]?.[col] ?? 0
          if (p > maxPenalty) maxPenalty = p
        }
      }
      if (maxPenalty > 0) {
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            const p = this.penaltyMap[row]?.[col] ?? 0
            if (p <= 0) continue
            const alpha = Math.min(0.6, (p / maxPenalty) * 0.6)
            rects.push({
              center: {
                x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
                y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
              },
              width: this.cellSizeMm,
              height: this.cellSizeMm,
              fill: `rgba(255,165,0,${alpha.toFixed(3)})`,
            })
          }
        }
      }
    }

    // Draw used cells as transparent blue rects
    if (this.showUsedCellMap && this.usedCells) {
      for (let z = 0; z < this.layers; z++) {
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            const occupant = this.usedCells[z]?.[row]?.[col]
            if (!occupant) continue
            rects.push({
              center: {
                x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
                y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
              },
              width: this.cellSizeMm,
              height: this.cellSizeMm,
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

    // Draw solved routes, splitting segments by z-layer for correct coloring
    if (this.solvedConnectionsMap) {
      for (const [, route] of this.solvedConnectionsMap) {
        if (route.route.length < 2) continue

        // Split the route into segments of contiguous z values
        let segStart = 0
        for (let i = 1; i < route.route.length; i++) {
          const prev = route.route[i - 1]!
          const curr = route.route[i]!
          if (curr.z !== prev.z) {
            // Emit segment for the previous z
            if (i - segStart >= 2) {
              lines.push({
                points: route.route
                  .slice(segStart, i)
                  .map((p) => ({ x: p.x, y: p.y })),
                strokeColor: LAYER_COLORS[prev.z] ?? "gray",
                strokeWidth: this.traceThickness,
              })
            }
            segStart = i
          }
        }
        // Emit final segment
        if (route.route.length - segStart >= 2) {
          const lastZ = route.route[segStart]!.z
          lines.push({
            points: route.route
              .slice(segStart)
              .map((p) => ({ x: p.x, y: p.y })),
            strokeColor: LAYER_COLORS[lastZ] ?? "gray",
            strokeWidth: this.traceThickness,
          })
        }
      }
    }

    // Draw vias
    if (this.solvedConnectionsMap) {
      for (const [, route] of this.solvedConnectionsMap) {
        for (const via of route.vias) {
          circles.push({
            center: { x: via.x, y: via.y },
            radius: this.viaDiameter / 2,
            fill: "rgba(0,0,0,0.3)",
            stroke: "black",
          })
        }
      }
    }

    // Draw active A* exploration
    if (this.activeConnection && this.closedSet) {
      for (const key of this.closedSet) {
        const parts = key.split(",")
        const row = Number(parts[1])
        const col = Number(parts[2])
        points.push({
          x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
          y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
          color: "rgba(0,0,255,0.2)",
        })
      }
    }

    return {
      points,
      lines,
      circles,
      rects,
      coordinateSystem: "cartesian" as const,
      title: `HighDensityA01 [${this.solvedConnectionsMap?.size ?? 0} solved, ${this.unsolvedConnections?.length ?? 0} remaining]`,
    }
  }

  // --- Internal helpers ---

  buildConnectionsFromPortPoints(): Connection[] {
    const byName = new Map<ConnectionName, NodeWithPortPoints["portPoints"]>()
    for (const pp of this.nodeWithPortPoints.portPoints) {
      const name = pp.connectionName
      if (!byName.has(name)) byName.set(name, [])
      byName.get(name)!.push(pp)
    }

    const connections: Connection[] = []
    for (const [name, pts] of byName) {
      if (pts.length < 2) continue
      for (let i = 0; i < pts.length - 1; i++) {
        const start = pts[i]!
        const end = pts[i + 1]!
        connections.push({
          connectionName: name,
          start: this.pointToGridCell(start),
          end: this.pointToGridCell(end),
        })
      }
    }
    return connections
  }

  pointToGridCell(pt: { x: number; y: number; z: number }): GridCell {
    const col = Math.round((pt.x - this.gridOrigin.x) / this.cellSizeMm - 0.5)
    const row = Math.round((pt.y - this.gridOrigin.y) / this.cellSizeMm - 0.5)
    const layerIndex = this.zToLayer.get(pt.z) ?? 0
    return {
      row: Math.max(0, Math.min(this.rows - 1, row)),
      col: Math.max(0, Math.min(this.cols - 1, col)),
      z: layerIndex,
      x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
      y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
    }
  }

  shuffleConnections(): void {
    const seed = this.hyperParameters.shuffleSeed
    let s = seed
    const rng = () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff
      return (s >>> 0) / 0xffffffff
    }
    for (let i = this.unsolvedConnections.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const a = this.unsolvedConnections[i]!
      const b = this.unsolvedConnections[j]!
      this.unsolvedConnections[i] = b
      this.unsolvedConnections[j] = a
    }
  }

  getCellKey(cell: GridCell): CellKey {
    return `${cell.z},${cell.row},${cell.col}`
  }

  computeH(a: GridCell, b: GridCell): number {
    return (Math.abs(a.row - b.row) + Math.abs(a.col - b.col)) * this.cellSizeMm
  }

  computeG(
    from: GridCell,
    to: GridCell,
    rippedTraces: Set<ConnectionName>,
  ): number {
    let cost = 0

    if (from.z !== to.z) {
      // Via transition
      cost += this.hyperParameters.viaBaseCost
    } else {
      // Lateral movement (diagonal = sqrt(2), orthogonal = 1)
      const dr = Math.abs(from.row - to.row)
      const dc = Math.abs(from.col - to.col)
      cost += (dr + dc > 1 ? Math.SQRT2 : 1) * this.cellSizeMm
    }

    // Penalty map
    cost += this.penaltyMap[to.row]?.[to.col] ?? 0

    // Rip cost for occupied cells
    if (from.z !== to.z) {
      // Via transition: account for full via footprint on all layers
      const footprintOccupants = this.getViaFootprintOccupants(to)
      for (const occupant of footprintOccupants) {
        if (occupant === this.activeConnection?.connectionName) continue
        if (!rippedTraces.has(occupant)) {
          cost += this.hyperParameters.ripCost
        }
        cost += this.hyperParameters.ripViaPenalty
      }
    } else {
      const occupant = this.usedCells[to.z]?.[to.row]?.[to.col]
      if (occupant && occupant !== this.activeConnection?.connectionName) {
        if (!rippedTraces.has(occupant)) {
          cost += this.hyperParameters.ripCost
        }
        cost += this.hyperParameters.ripTracePenalty
      }
    }

    return cost
  }

  getNeighbors(cell: GridCell): GridCell[] {
    const neighbors: GridCell[] = []
    const dirs = [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ]

    for (const dir of dirs) {
      const dr = dir[0]!
      const dc = dir[1]!
      const row = cell.row + dr
      const col = cell.col + dc
      if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) continue
      neighbors.push({
        row,
        col,
        z: cell.z,
        x: this.gridOrigin.x + (col + 0.5) * this.cellSizeMm,
        y: this.gridOrigin.y + (row + 0.5) * this.cellSizeMm,
      })
    }

    // Via: move to other layers at same position (if far enough from border)
    if (this.viaMinDistFromBorder > 0) {
      const distToEdge = Math.min(
        cell.col * this.cellSizeMm,
        (this.cols - 1 - cell.col) * this.cellSizeMm,
        cell.row * this.cellSizeMm,
        (this.rows - 1 - cell.row) * this.cellSizeMm,
      )
      if (distToEdge >= this.viaMinDistFromBorder) {
        for (let z = 0; z < this.layers; z++) {
          if (z === cell.z) continue
          neighbors.push({ ...cell, z })
        }
      }
    } else {
      for (let z = 0; z < this.layers; z++) {
        if (z === cell.z) continue
        neighbors.push({ ...cell, z })
      }
    }

    return neighbors
  }

  /** Get unique connection names occupying cells in the via footprint at a position */
  getViaFootprintOccupants(cell: GridCell): Set<ConnectionName> {
    const occupants = new Set<ConnectionName>()
    const viaRadiusCells = Math.ceil(this.viaDiameter / 2 / this.cellSizeMm)
    for (let z = 0; z < this.layers; z++) {
      for (let dr = -viaRadiusCells; dr <= viaRadiusCells; dr++) {
        for (let dc = -viaRadiusCells; dc <= viaRadiusCells; dc++) {
          if (dr * dr + dc * dc > viaRadiusCells * viaRadiusCells) continue
          const r = cell.row + dr
          const c = cell.col + dc
          if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) continue
          const occupant = this.usedCells[z]?.[r]?.[c]
          if (occupant) occupants.add(occupant)
        }
      }
    }
    return occupants
  }

  finalizeRoute(candidate: CandidateCell): void {
    // Reconstruct path from candidate chain
    const routePoints: Array<{ x: number; y: number; z: number }> = []
    const vias: Array<{ x: number; y: number }> = []
    let node: CandidateCell | null = candidate

    while (node) {
      routePoints.unshift({
        x: node.cell.x,
        y: node.cell.y,
        z: node.cell.z,
      })
      node = node.parent
    }

    // Detect vias (z-level changes)
    for (let i = 1; i < routePoints.length; i++) {
      const curr = routePoints[i]!
      const prev = routePoints[i - 1]!
      if (curr.z !== prev.z) {
        vias.push({ x: curr.x, y: curr.y })
      }
    }

    const connName = this.activeConnection!.connectionName

    // Rip any traces we displaced
    for (const rippedName of candidate.rippedTraces) {
      this.ripTrace(rippedName)
    }

    // Track cells owned by this connection
    const cellKeys = new Set<CellKey>()

    // Mark cells as used (including margin cells around the trace).
    // Only claim free cells or our own cells for margins — never overwrite
    // another trace's cells, as that would silently invalidate their route.
    const marginCells = Math.ceil(this.traceMargin / this.cellSizeMm)
    for (const pt of routePoints) {
      const centerRow = Math.round(
        (pt.y - this.gridOrigin.y) / this.cellSizeMm - 0.5,
      )
      const centerCol = Math.round(
        (pt.x - this.gridOrigin.x) / this.cellSizeMm - 0.5,
      )
      for (let dr = -marginCells; dr <= marginCells; dr++) {
        for (let dc = -marginCells; dc <= marginCells; dc++) {
          const r = centerRow + dr
          const c = centerCol + dc
          if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) continue
          const layer = this.usedCells[pt.z]
          if (layer) {
            const rowArr = layer[r]
            if (rowArr) {
              const existing = rowArr[c]
              if (existing !== null && existing !== connName) continue
              rowArr[c] = connName
              cellKeys.add(`${pt.z},${r},${c}`)
            }
          }
        }
      }
    }

    // Mark via footprint cells (vias occupy more cells based on viaDiameter)
    // Also detect any connections displaced by the via footprint that A* may
    // not have tracked (safety net for footprint-vs-trace overlaps)
    const viaRadiusCells = Math.ceil(this.viaDiameter / 2 / this.cellSizeMm)
    const displacedByVias = new Set<ConnectionName>()
    for (const via of vias) {
      const viaRow = Math.round(
        (via.y - this.gridOrigin.y) / this.cellSizeMm - 0.5,
      )
      const viaCol = Math.round(
        (via.x - this.gridOrigin.x) / this.cellSizeMm - 0.5,
      )
      for (let z = 0; z < this.layers; z++) {
        for (let dr = -viaRadiusCells; dr <= viaRadiusCells; dr++) {
          for (let dc = -viaRadiusCells; dc <= viaRadiusCells; dc++) {
            const r = viaRow + dr
            const c = viaCol + dc
            if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) continue
            if (dr * dr + dc * dc <= viaRadiusCells * viaRadiusCells) {
              const layer = this.usedCells[z]
              if (layer) {
                const rowArr = layer[r]
                if (rowArr) {
                  const existing = rowArr[c]
                  if (existing && existing !== connName) {
                    displacedByVias.add(existing)
                  }
                  rowArr[c] = connName
                  cellKeys.add(`${z},${r},${c}`)
                }
              }
            }
          }
        }
      }
    }

    // Store tracked cells for this connection
    this.connectionCellKeys.set(connName, cellKeys)

    // Rip any connections displaced by via footprints
    for (const displaced of displacedByVias) {
      this.ripTrace(displaced)
    }

    // Store solved route (map layer indices back to real z values)
    this.solvedConnectionsMap.set(connName, {
      connectionName: connName,
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      route: routePoints.map((pt) => ({
        x: pt.x,
        y: pt.y,
        z: this.layerToZ.get(pt.z) ?? pt.z,
      })),
      vias,
    })
  }

  ripTrace(connectionName: ConnectionName): void {
    const route = this.solvedConnectionsMap.get(connectionName)

    // Add rip penalties to the penalty map along the ripped route
    if (route) {
      for (const pt of route.route) {
        const row = Math.round(
          (pt.y - this.gridOrigin.y) / this.cellSizeMm - 0.5,
        )
        const col = Math.round(
          (pt.x - this.gridOrigin.x) / this.cellSizeMm - 0.5,
        )
        if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
          const rowArr = this.penaltyMap[row]
          if (rowArr) {
            rowArr[col] =
              (rowArr[col] ?? 0) + this.hyperParameters.ripTracePenalty
          }
        }
      }
      for (const via of route.vias) {
        const row = Math.round(
          (via.y - this.gridOrigin.y) / this.cellSizeMm - 0.5,
        )
        const col = Math.round(
          (via.x - this.gridOrigin.x) / this.cellSizeMm - 0.5,
        )
        if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
          const rowArr = this.penaltyMap[row]
          if (rowArr) {
            rowArr[col] =
              (rowArr[col] ?? 0) + this.hyperParameters.ripViaPenalty
          }
        }
      }
    }

    // Remove from usedCells using tracked cell keys (O(cells) instead of full grid scan)
    const trackedCells = this.connectionCellKeys.get(connectionName)
    if (trackedCells) {
      for (const key of trackedCells) {
        const parts = key.split(",")
        const z = Number(parts[0])
        const r = Number(parts[1])
        const c = Number(parts[2])
        const layer = this.usedCells[z]
        if (layer) {
          const rowArr = layer[r]
          if (rowArr && rowArr[c] === connectionName) {
            rowArr[c] = null
          }
        }
      }
      this.connectionCellKeys.delete(connectionName)
    }

    // Move from solved back to unsolved
    if (route) {
      this.solvedConnectionsMap.delete(connectionName)
      const start = route.route[0]
      const end = route.route[route.route.length - 1]
      if (start && end) {
        this.unsolvedConnections.push({
          connectionName,
          start: this.pointToGridCell(start),
          end: this.pointToGridCell(end),
        })
      }
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    return Array.from(this.solvedConnectionsMap.values())
  }
}
