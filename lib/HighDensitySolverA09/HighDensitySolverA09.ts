import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  HighDensitySolverA03,
  type HighDensitySolverA03Props,
} from "../HighDensitySolverA03/HighDensitySolverA03"
import {
  findRouteGeometryViolations,
  findSameLayerIntersections,
} from "../routeGeometryValidation"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../types"

type Side = "left" | "right" | "top" | "bottom"

type ConnectionInfo = {
  connectionName: string
  rootConnectionName?: string
  portPoints: PortPoint[]
  sides: Set<Side>
}

type CandidateSolution = {
  order: string[]
  routes: HighDensityIntraNodeRoute[]
  complete: boolean
  intersections: number
  violations: number
}

type PointToCellResult = {
  z: number
  cellId: number
}

type A03Internals = {
  availableZ: number[]
  layers: number
  planeSize: number
  pointToCell: (pt: { x: number; y: number; z: number }) => PointToCellResult
  portOwnerFlat: Int32Array
  usedCellsFlat: Int32Array
}

export interface HighDensitySolverA09Props
  extends Pick<
    HighDensitySolverA03Props,
    | "nodeWithPortPoints"
    | "highResolutionCellSize"
    | "highResolutionCellThickness"
    | "lowResolutionCellSize"
    | "viaDiameter"
    | "maxCellCount"
    | "traceThickness"
    | "traceMargin"
    | "viaMinDistFromBorder"
    | "showPenaltyMap"
    | "showUsedCellMap"
    | "effort"
    | "hyperParameters"
  > {
  boundaryBonus?: number
  boundaryBonusSigma?: number
  portShadowStrength?: number
  portShadowTangentSigma?: number
  portShadowDepthSigma?: number
  fullOrderSearchConnectionCountLimit?: number
  priorityHeadSize?: number
  maxCandidateOrders?: number
}

const TRACE_COLORS = [
  "rgba(255,0,0,0.8)",
  "rgba(0,0,255,0.8)",
  "rgba(255,165,0,0.8)",
  "rgba(0,128,0,0.8)",
] as const

const PORT_COLORS = ["red", "blue", "orange", "green"] as const
const FIXED_OBSTACLE_CONN_ID = 9_999

function* permutations<T>(
  items: T[],
  prefix: T[] = [],
): Generator<T[], void, void> {
  if (items.length === 0) {
    yield prefix
    return
  }

  for (let index = 0; index < items.length; index += 1) {
    const current = items[index]
    if (!current) continue
    const remaining = items.slice(0, index).concat(items.slice(index + 1))
    yield* permutations(remaining, [...prefix, current])
  }
}

function scoreConnection(
  connection: ConnectionInfo,
  centerY: number,
  rootSiblingCount: number,
) {
  const xs = connection.portPoints.map((portPoint) => portPoint.x)
  const ys = connection.portPoints.map((portPoint) => portPoint.y)
  const widthSpan = Math.max(...xs) - Math.min(...xs)
  const heightSpan = Math.max(...ys) - Math.min(...ys)
  const minY = Math.min(...ys)

  let score = widthSpan + heightSpan * 0.75
  if (connection.sides.has("left") && connection.sides.has("right")) score += 4
  if (connection.sides.has("top") && connection.sides.has("bottom")) score += 4
  if (minY < centerY) score += 1.5
  score += Math.max(0, rootSiblingCount - 1) * 0.25
  return score
}

export class HighDensitySolverA09 extends BaseSolver {
  nodeWithPortPoints: NodeWithPortPoints
  highResolutionCellSize: number
  highResolutionCellThickness: number
  lowResolutionCellSize: number
  viaDiameter: number
  maxCellCount?: number
  traceThickness: number
  traceMargin: number
  viaMinDistFromBorder: number
  showPenaltyMap: boolean
  showUsedCellMap: boolean
  effort: number
  hyperParameters?: HighDensitySolverA03Props["hyperParameters"]
  boundaryBonus: number
  boundaryBonusSigma: number
  portShadowStrength: number
  portShadowTangentSigma: number
  portShadowDepthSigma: number
  fullOrderSearchConnectionCountLimit: number
  priorityHeadSize: number
  maxCandidateOrders: number

  private boundsMinX = 0
  private boundsMaxX = 0
  private boundsMinY = 0
  private boundsMaxY = 0
  private sidePortPoints: Array<PortPoint & { side: Side }> = []
  private connections: ConnectionInfo[] = []
  private candidateOrders: ConnectionInfo[][] = []
  private outputRoutes: HighDensityIntraNodeRoute[] = []
  private bestCandidate: CandidateSolution | null = null
  private searchRan = false

  constructor(props: HighDensitySolverA09Props) {
    super()
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.highResolutionCellSize = props.highResolutionCellSize ?? 0.1
    this.highResolutionCellThickness = props.highResolutionCellThickness ?? 8
    this.lowResolutionCellSize = props.lowResolutionCellSize ?? 0.4
    this.viaDiameter = props.viaDiameter ?? 0.3
    this.maxCellCount = props.maxCellCount
    this.traceThickness = props.traceThickness ?? 0.1
    this.traceMargin = props.traceMargin ?? 0.15
    this.viaMinDistFromBorder = props.viaMinDistFromBorder ?? 0.15
    this.showPenaltyMap = props.showPenaltyMap ?? false
    this.showUsedCellMap = props.showUsedCellMap ?? false
    this.effort = props.effort ?? 20
    this.hyperParameters = props.hyperParameters
    this.boundaryBonus = props.boundaryBonus ?? 0.18
    this.boundaryBonusSigma = props.boundaryBonusSigma ?? 0.22
    this.portShadowStrength = props.portShadowStrength ?? 0.55
    this.portShadowTangentSigma = props.portShadowTangentSigma ?? 0.18
    this.portShadowDepthSigma = props.portShadowDepthSigma ?? 0.5
    this.fullOrderSearchConnectionCountLimit =
      props.fullOrderSearchConnectionCountLimit ?? 6
    this.priorityHeadSize = props.priorityHeadSize ?? 4
    this.maxCandidateOrders = props.maxCandidateOrders ?? 720
    this.MAX_ITERATIONS = 100_000_000
  }

  override getConstructorParams(): [HighDensitySolverA09Props] {
    return [
      {
        nodeWithPortPoints: this.nodeWithPortPoints,
        highResolutionCellSize: this.highResolutionCellSize,
        highResolutionCellThickness: this.highResolutionCellThickness,
        lowResolutionCellSize: this.lowResolutionCellSize,
        viaDiameter: this.viaDiameter,
        maxCellCount: this.maxCellCount,
        traceThickness: this.traceThickness,
        traceMargin: this.traceMargin,
        viaMinDistFromBorder: this.viaMinDistFromBorder,
        showPenaltyMap: this.showPenaltyMap,
        showUsedCellMap: this.showUsedCellMap,
        effort: this.effort,
        hyperParameters: this.hyperParameters,
        boundaryBonus: this.boundaryBonus,
        boundaryBonusSigma: this.boundaryBonusSigma,
        portShadowStrength: this.portShadowStrength,
        portShadowTangentSigma: this.portShadowTangentSigma,
        portShadowDepthSigma: this.portShadowDepthSigma,
        fullOrderSearchConnectionCountLimit:
          this.fullOrderSearchConnectionCountLimit,
        priorityHeadSize: this.priorityHeadSize,
        maxCandidateOrders: this.maxCandidateOrders,
      },
    ]
  }

  override _setup(): void {
    const { center, width, height, portPoints } = this.nodeWithPortPoints
    this.boundsMinX = center.x - width / 2
    this.boundsMaxX = center.x + width / 2
    this.boundsMinY = center.y - height / 2
    this.boundsMaxY = center.y + height / 2

    this.sidePortPoints = portPoints.map((portPoint) => ({
      ...portPoint,
      side: this.getSide(portPoint),
    }))
    this.connections = this.getConnections()
    this.candidateOrders = this.generateCandidateOrders()

    if (this.connections.length === 0) {
      this.solved = true
    }
  }

  override _step(): void {
    if (this.searchRan || this.solved || this.failed) return
    this.searchRan = true

    const bestCandidate = this.searchCandidateOrders()
    this.bestCandidate = bestCandidate
    this.outputRoutes = bestCandidate?.routes ?? []

    this.stats = {
      candidateOrdersTried: this.candidateOrders.length,
      bestOrder: bestCandidate?.order ?? [],
      bestRouteCount: bestCandidate?.routes.length ?? 0,
      bestViolations: bestCandidate?.violations ?? 0,
      bestIntersections: bestCandidate?.intersections ?? 0,
    }

    if (
      bestCandidate &&
      bestCandidate.complete &&
      bestCandidate.violations === 0 &&
      bestCandidate.intersections === 0
    ) {
      this.solved = true
      return
    }

    if (!bestCandidate) {
      this.error = "A09 could not route any sample order"
      this.failed = true
      return
    }

    const status = bestCandidate.complete ? "complete" : "partial"
    this.error =
      `A09 best ${status} candidate still invalid: ` +
      `${bestCandidate.routes.length} routed, ` +
      `${bestCandidate.intersections} intersections, ` +
      `${bestCandidate.violations} geometry violations`
    this.failed = true
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    return this.outputRoutes
  }

  override visualize(): GraphicsObject {
    const rects: NonNullable<GraphicsObject["rects"]> = [
      {
        center: this.nodeWithPortPoints.center,
        width: this.nodeWithPortPoints.width,
        height: this.nodeWithPortPoints.height,
        stroke: "gray",
      },
    ]
    const points: NonNullable<GraphicsObject["points"]> =
      this.nodeWithPortPoints.portPoints.map((portPoint) => ({
        x: portPoint.x,
        y: portPoint.y,
        color: PORT_COLORS[portPoint.z] ?? "black",
        label: portPoint.connectionName,
      }))
    const lines: NonNullable<GraphicsObject["lines"]> = []
    const circles: NonNullable<GraphicsObject["circles"]> = []

    for (const route of this.outputRoutes) {
      let segmentStart = 0
      for (let index = 1; index < route.route.length; index += 1) {
        const previous = route.route[index - 1]
        const current = route.route[index]
        if (!previous || !current) continue

        if (current.z !== previous.z) {
          if (index - segmentStart >= 2) {
            const segmentZ = route.route[segmentStart]?.z ?? previous.z
            lines.push({
              points: route.route
                .slice(segmentStart, index)
                .map((point) => ({ x: point.x, y: point.y })),
              strokeColor:
                TRACE_COLORS[segmentZ % TRACE_COLORS.length] ?? "rgba(0,0,0,0.8)",
              strokeWidth: route.traceThickness,
            })
          }
          segmentStart = index
        }
      }

      if (route.route.length - segmentStart >= 2) {
        const segmentZ = route.route[segmentStart]?.z ?? 0
        lines.push({
          points: route.route
            .slice(segmentStart)
            .map((point) => ({ x: point.x, y: point.y })),
          strokeColor:
            TRACE_COLORS[segmentZ % TRACE_COLORS.length] ?? "rgba(0,0,0,0.8)",
          strokeWidth: route.traceThickness,
        })
      }

      for (const via of route.vias) {
        circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          fill: "rgba(0,0,0,0.3)",
          stroke: "black",
        })
      }
    }

    return {
      points,
      lines,
      circles,
      rects,
      coordinateSystem: "cartesian" as const,
      title:
        this.bestCandidate === null
          ? "HighDensityA09"
          : `HighDensityA09 [${this.bestCandidate.routes.length}/${this.connections.length} routed]`,
    }
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }

  private searchCandidateOrders() {
    let bestCandidate: CandidateSolution | null = null

    for (const order of this.candidateOrders) {
      const candidate = this.solveCandidateOrder(order)
      if (this.isBetterCandidate(candidate, bestCandidate)) {
        bestCandidate = candidate
      }

      if (
        candidate.complete &&
        candidate.intersections === 0 &&
        candidate.violations === 0
      ) {
        return candidate
      }
    }

    return bestCandidate
  }

  private solveCandidateOrder(order: ConnectionInfo[]): CandidateSolution {
    const routes: HighDensityIntraNodeRoute[] = []

    for (const connection of order) {
      const nextRoute = this.solveConnection(connection, routes)
      if (!nextRoute) {
        break
      }
      routes.push(nextRoute)
    }

    return {
      order: order.map((connection) => connection.connectionName),
      routes,
      complete: routes.length === order.length,
      intersections: findSameLayerIntersections(routes).length,
      violations: findRouteGeometryViolations(routes).length,
    }
  }

  private solveConnection(
    connection: ConnectionInfo,
    occupiedRoutes: HighDensityIntraNodeRoute[],
  ) {
    const solver = new HighDensitySolverA03({
      nodeWithPortPoints: this.makeSubproblem(connection),
      highResolutionCellSize: this.highResolutionCellSize,
      highResolutionCellThickness: this.highResolutionCellThickness,
      lowResolutionCellSize: this.lowResolutionCellSize,
      viaDiameter: this.viaDiameter,
      maxCellCount: this.maxCellCount,
      traceThickness: this.traceThickness,
      traceMargin: this.traceMargin,
      viaMinDistFromBorder: this.viaMinDistFromBorder,
      showPenaltyMap: this.showPenaltyMap,
      showUsedCellMap: this.showUsedCellMap,
      effort: this.effort,
      hyperParameters: this.hyperParameters,
      initialPenaltyFn: ({ x, y }) => this.computeInitialPenalty(x, y),
    })
    solver.MAX_RIPS = 0
    solver.MAX_ITERATIONS = Math.max(1, this.MAX_ITERATIONS)
    solver.setup()
    this.applyExactRouteObstacles(solver, occupiedRoutes)
    solver.solve()

    if (!solver.solved || solver.failed) {
      return null
    }

    const [route] = solver.getOutput()
    if (!route) return null
    return {
      ...route,
      rootConnectionName: connection.rootConnectionName,
    }
  }

  private applyExactRouteObstacles(
    solver: HighDensitySolverA03,
    occupiedRoutes: HighDensityIntraNodeRoute[],
  ) {
    const internals = solver as unknown as A03Internals
    const blockedFlatIndices = new Set<number>()
    const fallbackZ = internals.availableZ[0] ?? 0

    for (const route of occupiedRoutes) {
      for (const point of route.route) {
        const cell = internals.pointToCell(point)
        blockedFlatIndices.add(point.z * internals.planeSize + cell.cellId)
      }

      for (const via of route.vias) {
        const cell = internals.pointToCell({
          x: via.x,
          y: via.y,
          z: fallbackZ,
        })
        for (let layerIndex = 0; layerIndex < internals.layers; layerIndex += 1) {
          blockedFlatIndices.add(layerIndex * internals.planeSize + cell.cellId)
        }
      }
    }

    for (const flatIndex of blockedFlatIndices) {
      internals.portOwnerFlat[flatIndex] = FIXED_OBSTACLE_CONN_ID
      internals.usedCellsFlat[flatIndex] = FIXED_OBSTACLE_CONN_ID
    }
  }

  private computeInitialPenalty(x: number, y: number) {
    let penalty = 0
    const tangentSigmaSq =
      2 * this.portShadowTangentSigma * this.portShadowTangentSigma
    const depthSigmaSq = 2 * this.portShadowDepthSigma * this.portShadowDepthSigma
    const boundarySigmaSq = 2 * this.boundaryBonusSigma * this.boundaryBonusSigma

    for (const portPoint of this.sidePortPoints) {
      const tangential =
        portPoint.side === "top" || portPoint.side === "bottom"
          ? Math.abs(x - portPoint.x)
          : Math.abs(y - portPoint.y)
      const inward =
        portPoint.side === "top"
          ? portPoint.y - y
          : portPoint.side === "bottom"
            ? y - portPoint.y
            : portPoint.side === "left"
              ? x - portPoint.x
              : portPoint.x - x

      if (inward <= 0) continue
      penalty +=
        this.portShadowStrength *
        Math.exp(-(tangential * tangential) / tangentSigmaSq) *
        Math.exp(-(inward * inward) / depthSigmaSq)
    }

    for (const depth of [
      this.boundsMaxY - y,
      y - this.boundsMinY,
      x - this.boundsMinX,
      this.boundsMaxX - x,
    ]) {
      if (depth < 0) continue
      penalty -=
        this.boundaryBonus *
        Math.exp(-(depth * depth) / boundarySigmaSq)
    }

    return penalty
  }

  private generateCandidateOrders() {
    if (this.connections.length <= 1) return [this.connections]

    if (
      this.connections.length <= this.fullOrderSearchConnectionCountLimit &&
      this.factorial(this.connections.length) <= this.maxCandidateOrders
    ) {
      return Array.from(permutations(this.connections))
    }

    const rootSiblingCounts = new Map<string, number>()
    for (const connection of this.connections) {
      const rootName =
        connection.rootConnectionName ??
        connection.connectionName.replace(/_mst\d+$/, "")
      rootSiblingCounts.set(rootName, (rootSiblingCounts.get(rootName) ?? 0) + 1)
    }

    const sorted = [...this.connections].sort((left, right) => {
      const leftRoot =
        left.rootConnectionName ?? left.connectionName.replace(/_mst\d+$/, "")
      const rightRoot =
        right.rootConnectionName ?? right.connectionName.replace(/_mst\d+$/, "")
      const leftScore = scoreConnection(
        left,
        this.nodeWithPortPoints.center.y,
        rootSiblingCounts.get(leftRoot) ?? 1,
      )
      const rightScore = scoreConnection(
        right,
        this.nodeWithPortPoints.center.y,
        rootSiblingCounts.get(rightRoot) ?? 1,
      )
      return rightScore - leftScore
    })

    const headSize = Math.min(
      Math.max(1, this.priorityHeadSize),
      sorted.length,
    )
    const head = sorted.slice(0, headSize)
    const tail = sorted.slice(headSize)
    const orders: ConnectionInfo[][] = []

    for (const headOrder of permutations(head)) {
      orders.push([...headOrder, ...tail])
      if (orders.length >= this.maxCandidateOrders) {
        break
      }
    }

    if (orders.length === 0) {
      orders.push(sorted)
    }

    return orders
  }

  private getConnections() {
    const byConnection = new Map<string, ConnectionInfo>()

    for (const portPoint of this.nodeWithPortPoints.portPoints) {
      const existing = byConnection.get(portPoint.connectionName)
      if (existing) {
        existing.portPoints.push(portPoint)
        existing.sides.add(this.getSide(portPoint))
        continue
      }

      byConnection.set(portPoint.connectionName, {
        connectionName: portPoint.connectionName,
        rootConnectionName: portPoint.rootConnectionName,
        portPoints: [portPoint],
        sides: new Set([this.getSide(portPoint)]),
      })
    }

    return Array.from(byConnection.values()).filter(
      (connection) => connection.portPoints.length >= 2,
    )
  }

  private makeSubproblem(connection: ConnectionInfo): NodeWithPortPoints {
    return {
      capacityMeshNodeId: this.nodeWithPortPoints.capacityMeshNodeId,
      center: this.nodeWithPortPoints.center,
      width: this.nodeWithPortPoints.width,
      height: this.nodeWithPortPoints.height,
      availableZ: this.nodeWithPortPoints.availableZ,
      portPoints: connection.portPoints.map((portPoint) => ({ ...portPoint })),
    }
  }

  private getSide(portPoint: PortPoint): Side {
    const dx = portPoint.x - this.nodeWithPortPoints.center.x
    const dy = portPoint.y - this.nodeWithPortPoints.center.y
    return Math.abs(dx) > Math.abs(dy)
      ? dx < 0
        ? "left"
        : "right"
      : dy < 0
        ? "bottom"
        : "top"
  }

  private isBetterCandidate(
    candidate: CandidateSolution,
    currentBest: CandidateSolution | null,
  ) {
    if (!currentBest) return true
    if (Number(candidate.complete) !== Number(currentBest.complete)) {
      return Number(candidate.complete) > Number(currentBest.complete)
    }
    if (!candidate.complete && candidate.routes.length !== currentBest.routes.length) {
      return candidate.routes.length > currentBest.routes.length
    }
    if (candidate.violations !== currentBest.violations) {
      return candidate.violations < currentBest.violations
    }
    if (candidate.intersections !== currentBest.intersections) {
      return candidate.intersections < currentBest.intersections
    }
    return candidate.routes.length > currentBest.routes.length
  }

  private factorial(value: number) {
    let total = 1
    for (let index = 2; index <= value; index += 1) {
      total *= index
      if (total > this.maxCandidateOrders) {
        return total
      }
    }
    return total
  }
}
