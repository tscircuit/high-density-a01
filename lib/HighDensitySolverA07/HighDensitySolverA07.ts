import { BaseSolver } from "@tscircuit/solver-utils"
import { deriveViasFromRoutePoints } from "../routeReflow"
import { findRouteGeometryViolations } from "../routeGeometry"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../types"

type Side = "left" | "top" | "right" | "bottom"
type RoutePoint = { x: number; y: number; z: number }
type MoveDirection = "left" | "right" | "up" | "down" | "via" | "start"

type RoutedConnection = {
  connectionName: string
  rootConnectionName?: string
  points: [PortPoint, PortPoint]
  sides: [Side, Side]
}

type SearchNode = {
  key: string
  xIndex: number
  yIndex: number
  x: number
  y: number
  z: number
}

type SearchState = {
  node: SearchNode
  dir: MoveDirection
}

type ObstacleSegment = {
  z: number
  a: { x: number; y: number }
  b: { x: number; y: number }
}

type ObstacleIndex = {
  segments: ObstacleSegment[]
  points: Array<{ x: number; y: number; z: number }>
  vias: Array<{ x: number; y: number }>
}

type RoutingProfile = {
  id: string
  preferredLayer: "native" | "other" | "none"
  xBias: -1 | 0 | 1
  yBias: -1 | 0 | 1
  viaCost: number
  turnCost: number
  overshootPenalty: number
}

type HeapEntry<T> = {
  item: T
  priority: number
}

class MinHeap<T> {
  private readonly entries: Array<HeapEntry<T>> = []

  get size(): number {
    return this.entries.length
  }

  push(item: T, priority: number) {
    this.entries.push({ item, priority })
    this.bubbleUp(this.entries.length - 1)
  }

  pop(): HeapEntry<T> | undefined {
    if (this.entries.length === 0) return undefined
    const first = this.entries[0]!
    const last = this.entries.pop()!
    if (this.entries.length > 0) {
      this.entries[0] = last
      this.bubbleDown(0)
    }
    return first
  }

  private bubbleUp(index: number) {
    let current = index
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2)
      if (
        this.entries[parent]!.priority <= this.entries[current]!.priority
      ) {
        break
      }
      ;[this.entries[parent], this.entries[current]] = [
        this.entries[current]!,
        this.entries[parent]!,
      ]
      current = parent
    }
  }

  private bubbleDown(index: number) {
    let current = index
    while (true) {
      const left = current * 2 + 1
      const right = current * 2 + 2
      let next = current

      if (
        left < this.entries.length &&
        this.entries[left]!.priority < this.entries[next]!.priority
      ) {
        next = left
      }
      if (
        right < this.entries.length &&
        this.entries[right]!.priority < this.entries[next]!.priority
      ) {
        next = right
      }
      if (next === current) break
      ;[this.entries[current], this.entries[next]] = [
        this.entries[next]!,
        this.entries[current]!,
      ]
      current = next
    }
  }
}

const EPSILON = 1e-9

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function approxEqual(a: number, b: number, tolerance = 1e-6) {
  return Math.abs(a - b) <= tolerance
}

function uniqueSorted(values: number[], digits = 6) {
  return [...new Set(values.map((value) => Number(value.toFixed(digits))))].sort(
    (a, b) => a - b,
  )
}

function toRootNetName(
  connectionName: string,
  rootConnectionName?: string,
): string {
  return rootConnectionName ?? connectionName.replace(/_mst\d+$/, "")
}

function pairKey(a: Side, b: Side) {
  return [a, b].sort().join("->")
}

function appendPoint(out: RoutePoint[], point: RoutePoint) {
  const prev = out[out.length - 1]
  if (
    prev &&
    approxEqual(prev.x, point.x) &&
    approxEqual(prev.y, point.y) &&
    prev.z === point.z
  ) {
    return
  }
  out.push({ ...point })
}

function sideOfPoint(point: PortPoint, node: NodeWithPortPoints): Side {
  const minX = node.center.x - node.width / 2
  const maxX = node.center.x + node.width / 2
  const minY = node.center.y - node.height / 2
  const maxY = node.center.y + node.height / 2

  const dLeft = Math.abs(point.x - minX)
  const dRight = Math.abs(point.x - maxX)
  const dTop = Math.abs(point.y - maxY)
  const dBottom = Math.abs(point.y - minY)
  const minDistance = Math.min(dLeft, dRight, dTop, dBottom)

  if (minDistance === dLeft) return "left"
  if (minDistance === dRight) return "right"
  if (minDistance === dTop) return "top"
  return "bottom"
}

function pickPortOnSide(connection: RoutedConnection, side: Side) {
  if (connection.sides[0] === side) return connection.points[0]
  if (connection.sides[1] === side) return connection.points[1]
  return null
}

function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function pointToSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abLenSq = abx * abx + aby * aby
  if (abLenSq <= EPSILON) return pointDistance(p, a)

  const apx = p.x - a.x
  const apy = p.y - a.y
  const t = clamp(dot(apx, apy, abx, aby) / abLenSq, 0, 1)
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
}

function cross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
) {
  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)

  return (
    ((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON)) &&
    ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))
  )
}

function segmentDistance(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0
  return Math.min(
    pointToSegmentDistance(a1, b1, b2),
    pointToSegmentDistance(a2, b1, b2),
    pointToSegmentDistance(b1, a1, a2),
    pointToSegmentDistance(b2, a1, a2),
  )
}

export interface HighDensitySolverA07Props {
  nodeWithPortPoints: NodeWithPortPoints
  traceThickness?: number
  traceMargin?: number
  viaDiameter: number
  viaMinDistFromBorder?: number
  gridStep?: number
  maxSearchAttempts?: number
}

export class HighDensitySolverA07 extends BaseSolver {
  private readonly nodeWithPortPoints: NodeWithPortPoints
  private readonly traceThickness: number
  private readonly traceMargin: number
  private readonly viaDiameter: number
  private readonly viaMinDistFromBorder: number
  private readonly gridStep: number
  private readonly maxSearchAttempts: number
  private routes: HighDensityIntraNodeRoute[] = []
  private searchAttempts = 0

  constructor(props: HighDensitySolverA07Props) {
    super()
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.traceThickness = props.traceThickness ?? 0.1
    this.traceMargin = props.traceMargin ?? 0.15
    this.viaDiameter = props.viaDiameter
    this.viaMinDistFromBorder = props.viaMinDistFromBorder ?? 0.15
    this.gridStep = props.gridStep ?? 0.25
    this.maxSearchAttempts = props.maxSearchAttempts ?? 5_000
  }

  override getConstructorParams(): [HighDensitySolverA07Props] {
    return [
      {
        nodeWithPortPoints: this.nodeWithPortPoints,
        traceThickness: this.traceThickness,
        traceMargin: this.traceMargin,
        viaDiameter: this.viaDiameter,
        viaMinDistFromBorder: this.viaMinDistFromBorder,
        gridStep: this.gridStep,
        maxSearchAttempts: this.maxSearchAttempts,
      },
    ]
  }

  override _setup(): void {
    const result = this.buildRoutes()
    if (!result.ok) {
      this.failed = true
      this.error = result.error
      return
    }

    this.routes = result.routes
    const violations = findRouteGeometryViolations(this.routes)
    if (violations.length > 0) {
      const summary = violations
        .slice(0, 5)
        .map((violation) => {
          const zPart = violation.z === null ? "z=all" : `z=${violation.z}`
          return `${violation.trace1} x ${violation.trace2} [${violation.type}] ${zPart}`
        })
        .join("; ")
      this.failed = true
      this.error =
        `A07 produced invalid geometry (${violations.length} violation${violations.length === 1 ? "" : "s"}): ${summary}`
      this.routes = []
      return
    }

    this.solved = true
  }

  override _step(): void {
    if (!this.failed && !this.solved) {
      this.failed = true
      this.error = this.error ?? "A07 did not finish during setup"
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    return this.routes.map((route) => ({
      ...route,
      route: route.route.map((point) => ({ ...point })),
      vias: route.vias.map((via) => ({ ...via })),
    }))
  }

  private buildRoutes():
    | { ok: true; routes: HighDensityIntraNodeRoute[] }
    | { ok: false; error: string } {
    const collected = this.collectConnections()
    if (!collected.ok) return collected

    const connections = collected.connections
    const bottomTopConnections = connections.filter(
      (connection) => pairKey(...connection.sides) === "bottom->top",
    )

    if (bottomTopConnections.length === 0) {
      return {
        ok: false,
        error: "A07 requires at least one bottom-top connection",
      }
    }

    const width = this.nodeWithPortPoints.width
    const height = this.nodeWithPortPoints.height
    if (width / Math.max(height, 1e-6) < 2.25) {
      return {
        ok: false,
        error: "A07 expects a wide shallow node geometry",
      }
    }

    const availableZ =
      this.nodeWithPortPoints.availableZ ??
      [...new Set(this.nodeWithPortPoints.portPoints.map((point) => point.z))].sort(
        (a, b) => a - b,
      )
    if (availableZ.length !== 2) {
      return {
        ok: false,
        error: "A07 currently supports exactly two copper layers",
      }
    }

    const routes = this.routeWithBacktracking(
      this.orderConnections(connections),
      [],
      availableZ,
    )
    if (!routes) {
      return {
        ok: false,
        error:
          this.error ??
          "A07 failed to find a valid routing assignment for this channel-like node",
      }
    }

    return { ok: true, routes }
  }

  private orderConnections(connections: RoutedConnection[]) {
    const rootCounts = new Map<string, number>()
    for (const connection of connections) {
      const root = connection.rootConnectionName ?? connection.connectionName
      rootCounts.set(root, (rootCounts.get(root) ?? 0) + 1)
    }

    return [...connections].sort((a, b) => {
      const aScore = this.connectionDifficulty(a, rootCounts)
      const bScore = this.connectionDifficulty(b, rootCounts)
      return (
        bScore - aScore ||
        a.connectionName.localeCompare(b.connectionName)
      )
    })
  }

  private connectionDifficulty(
    connection: RoutedConnection,
    rootCounts: Map<string, number>,
  ) {
    const root = connection.rootConnectionName ?? connection.connectionName
    const sharedRootBoost = (rootCounts.get(root) ?? 1) > 1 ? 4 : 0
    const bottomPort = pickPortOnSide(connection, "bottom")
    const topPort = pickPortOnSide(connection, "top")
    const leftPort = pickPortOnSide(connection, "left")

    if (leftPort && bottomPort) {
      return 2 + Math.abs(bottomPort.x - leftPort.x) * 0.25 + sharedRootBoost
    }

    if (bottomPort && topPort) {
      const dx = topPort.x - bottomPort.x
      return Math.abs(dx) + (dx < 0 ? 8 : 0) + sharedRootBoost
    }

    return sharedRootBoost
  }

  private routeWithBacktracking(
    remainingConnections: RoutedConnection[],
    routed: HighDensityIntraNodeRoute[],
    availableZ: number[],
  ): HighDensityIntraNodeRoute[] | null {
    if (remainingConnections.length === 0) {
      return routed.map((route) => ({
        ...route,
        route: route.route.map((point) => ({ ...point })),
        vias: route.vias.map((via) => ({ ...via })),
      }))
    }
    if (this.searchAttempts > this.maxSearchAttempts) {
      this.error =
        `A07 exhausted its search budget after ${this.searchAttempts} path attempts`
      return null
    }

    let selectedConnection: RoutedConnection | null = null
    let selectedCandidates: HighDensityIntraNodeRoute[] | null = null
    for (const connection of remainingConnections) {
      const candidates = this.findRouteCandidates(connection, routed, availableZ)
      if (candidates.length === 0) return null
      if (
        !selectedCandidates ||
        candidates.length < selectedCandidates.length
      ) {
        selectedConnection = connection
        selectedCandidates = candidates
      }
      if (candidates.length === 1) break
    }

    if (!selectedConnection || !selectedCandidates) {
      return null
    }

    for (const candidate of selectedCandidates) {
      routed.push(candidate)
      const nextRemaining = remainingConnections.filter(
        (connection) => connection.connectionName !== selectedConnection.connectionName,
      )
      const solved = this.routeWithBacktracking(
        nextRemaining,
        routed,
        availableZ,
      )
      if (solved) return solved
      routed.pop()
    }
    return null
  }

  private findRouteCandidates(
    connection: RoutedConnection,
    routed: HighDensityIntraNodeRoute[],
    availableZ: number[],
  ): HighDensityIntraNodeRoute[] {
    const profiles = this.getProfilesForConnection(connection)
    const candidates: HighDensityIntraNodeRoute[] = []
    const seen = new Set<string>()

    for (const profile of profiles) {
      const route = this.findPathForProfile(
        connection,
        routed,
        availableZ,
        profile,
        new Set<string>(),
      )
      if (!route) continue
      const maybeAdd = (candidate: HighDensityIntraNodeRoute | null) => {
        if (!candidate) return
        const signature = this.routeSignature(candidate)
        if (seen.has(signature)) return
        seen.add(signature)
        candidates.push(candidate)
      }
      maybeAdd(route)

      for (const bannedCoordinates of this.getDetourBanSets(route)) {
        const alternate = this.findPathForProfile(
          connection,
          routed,
          availableZ,
          profile,
          bannedCoordinates,
        )
        maybeAdd(alternate)
      }
    }

    return candidates.sort((a, b) => {
      const aLen = this.routeLength(a)
      const bLen = this.routeLength(b)
      return aLen - bLen || a.vias.length - b.vias.length
    })
  }

  private getProfilesForConnection(connection: RoutedConnection) {
    const bottomPort = pickPortOnSide(connection, "bottom")
    const topPort = pickPortOnSide(connection, "top")
    const leftPort = pickPortOnSide(connection, "left")

    if (bottomPort && leftPort) {
      return [
        {
          id: "left-native-low",
          preferredLayer: "native",
          xBias: -1,
          yBias: -1,
          viaCost: 2.5,
          turnCost: 0.2,
          overshootPenalty: 0.4,
        },
        {
          id: "left-native-high",
          preferredLayer: "native",
          xBias: -1,
          yBias: 1,
          viaCost: 2.5,
          turnCost: 0.2,
          overshootPenalty: 0.4,
        },
        {
          id: "left-other-low",
          preferredLayer: "other",
          xBias: -1,
          yBias: -1,
          viaCost: 1.25,
          turnCost: 0.2,
          overshootPenalty: 0.2,
        },
        {
          id: "left-other-high",
          preferredLayer: "other",
          xBias: -1,
          yBias: 1,
          viaCost: 1.25,
          turnCost: 0.2,
          overshootPenalty: 0.2,
        },
      ] as const satisfies RoutingProfile[]
    }

    if (bottomPort && topPort) {
      const dx = topPort.x - bottomPort.x
      if (dx < -1) {
        return [
          {
            id: "other-left-high",
            preferredLayer: "other",
            xBias: -1,
            yBias: 1,
            viaCost: 1.1,
            turnCost: 0.2,
            overshootPenalty: 0.1,
          },
          {
            id: "other-left-low",
            preferredLayer: "other",
            xBias: -1,
            yBias: -1,
            viaCost: 1.1,
            turnCost: 0.2,
            overshootPenalty: 0.1,
          },
          {
            id: "native-high",
            preferredLayer: "native",
            xBias: -1,
            yBias: 1,
            viaCost: 2.75,
            turnCost: 0.2,
            overshootPenalty: 0.3,
          },
          {
            id: "other-right-high",
            preferredLayer: "other",
            xBias: 1,
            yBias: 1,
            viaCost: 1.1,
            turnCost: 0.2,
            overshootPenalty: 0.15,
          },
        ] as const satisfies RoutingProfile[]
      }

      return [
        {
          id: "native-high",
          preferredLayer: "native",
          xBias: 0,
          yBias: 1,
          viaCost: 2.75,
          turnCost: 0.15,
          overshootPenalty: 0.35,
        },
        {
          id: "native-low",
          preferredLayer: "native",
          xBias: 0,
          yBias: -1,
          viaCost: 2.75,
          turnCost: 0.15,
          overshootPenalty: 0.35,
        },
        {
          id: "other-left",
          preferredLayer: "other",
          xBias: -1,
          yBias: 0,
          viaCost: 1.4,
          turnCost: 0.15,
          overshootPenalty: 0.2,
        },
        {
          id: "other-right",
          preferredLayer: "other",
          xBias: 1,
          yBias: 0,
          viaCost: 1.4,
          turnCost: 0.15,
          overshootPenalty: 0.2,
        },
      ] as const satisfies RoutingProfile[]
    }

    return [
      {
        id: "default",
        preferredLayer: "native",
        xBias: 0,
        yBias: 0,
        viaCost: 2,
        turnCost: 0.2,
        overshootPenalty: 0.25,
      },
    ] as const satisfies RoutingProfile[]
  }

  private findPathForProfile(
    connection: RoutedConnection,
    routed: HighDensityIntraNodeRoute[],
    availableZ: number[],
    profile: RoutingProfile,
    bannedCoordinates: Set<string>,
  ): HighDensityIntraNodeRoute | null {
    this.searchAttempts += 1

    const bounds = this.getBounds()
    const { start, goal } = this.pickEndpoints(connection)
    const xCoords = this.buildXCoordinates(connection, start, goal, bounds)
    const yCoords = this.buildYCoordinates(connection, start, goal, bounds)
    const nodes = new Map<string, SearchNode>()

    for (let xIndex = 0; xIndex < xCoords.length; xIndex++) {
      for (let yIndex = 0; yIndex < yCoords.length; yIndex++) {
        for (const z of availableZ) {
          const key = `${xIndex}:${yIndex}:${z}`
          nodes.set(key, {
            key,
            xIndex,
            yIndex,
            x: xCoords[xIndex]!,
            y: yCoords[yIndex]!,
            z,
          })
        }
      }
    }

    const startKey = this.findNodeKeyForPoint(nodes, start)
    const goalKey = this.findNodeKeyForPoint(nodes, goal)
    if (!startKey || !goalKey) return null

    const startNode = nodes.get(startKey)
    const goalNode = nodes.get(goalKey)
    if (!startNode || !goalNode) return null

    const obstacleIndex = this.buildObstacleIndex(
      routed,
      connection.rootConnectionName ?? connection.connectionName,
    )
    const preferredWorkingLayer = this.resolvePreferredLayer(
      profile,
      start.z,
      availableZ,
    )

    const open = new MinHeap<SearchState>()
    const bestCost = new Map<string, number>()
    const previous = new Map<
      string,
      { prevKey: string | null; prevDir: MoveDirection; nodeKey: string }
    >()

    open.push({ node: startNode, dir: "start" }, 0)
    bestCost.set(this.stateKey(startNode.key, "start"), 0)
    previous.set(this.stateKey(startNode.key, "start"), {
      prevKey: null,
      prevDir: "start",
      nodeKey: startNode.key,
    })

    while (open.size > 0) {
      const currentEntry = open.pop()
      if (!currentEntry) break
      const current = currentEntry.item
      const currentStateKey = this.stateKey(current.node.key, current.dir)
      const currentCost = bestCost.get(currentStateKey)
      if (currentCost === undefined) continue

      if (current.node.key === goalNode.key) {
        const route = this.reconstructRoute(
          currentStateKey,
          previous,
          nodes,
          connection,
        )
        if (!route) return null
        const violations = findRouteGeometryViolations([...routed, route])
        if (violations.length > 0) return null
        return route
      }

      const neighbors = this.getNeighbors(current.node, nodes, xCoords, yCoords)
      for (const next of neighbors) {
        if (
          bannedCoordinates.has(this.coordinateKey(next.x, next.y, next.z)) &&
          next.key !== goalNode.key
        ) {
          continue
        }
        const moveDir = this.directionBetween(current.node, next)
        if (
          !this.canTraverse(
            current.node,
            next,
            obstacleIndex,
            connection.rootConnectionName ?? connection.connectionName,
            bounds,
          )
        ) {
          continue
        }

        const nextStateKey = this.stateKey(next.key, moveDir)
        const nextCost =
          currentCost +
          this.moveCost(
            current.node,
            next,
            moveDir,
            current.dir,
            preferredWorkingLayer,
            start,
            goal,
            bounds,
            profile,
          )
        if (nextCost >= (bestCost.get(nextStateKey) ?? Number.POSITIVE_INFINITY)) {
          continue
        }

        bestCost.set(nextStateKey, nextCost)
        previous.set(nextStateKey, {
          prevKey: currentStateKey,
          prevDir: current.dir,
          nodeKey: next.key,
        })
        open.push(
          { node: next, dir: moveDir },
          nextCost + this.heuristic(next, goalNode, profile, preferredWorkingLayer),
        )
      }
    }

    return null
  }

  private getBounds() {
    const minX = this.nodeWithPortPoints.center.x - this.nodeWithPortPoints.width / 2
    const maxX = this.nodeWithPortPoints.center.x + this.nodeWithPortPoints.width / 2
    const minY =
      this.nodeWithPortPoints.center.y - this.nodeWithPortPoints.height / 2
    const maxY =
      this.nodeWithPortPoints.center.y + this.nodeWithPortPoints.height / 2
    const safeInset = Math.max(
      this.traceThickness,
      this.viaMinDistFromBorder + this.viaDiameter / 2 + this.traceThickness / 2,
    )

    return {
      minX,
      maxX,
      minY,
      maxY,
      safeMinX: minX + safeInset,
      safeMaxX: maxX - safeInset,
      safeMinY: minY + safeInset,
      safeMaxY: maxY - safeInset,
    }
  }

  private pickEndpoints(connection: RoutedConnection) {
    const bottom = pickPortOnSide(connection, "bottom")
    const top = pickPortOnSide(connection, "top")
    const left = pickPortOnSide(connection, "left")

    if (bottom && top) return { start: bottom, goal: top }
    if (bottom && left) return { start: bottom, goal: left }
    return { start: connection.points[0], goal: connection.points[1] }
  }

  private buildXCoordinates(
    connection: RoutedConnection,
    start: PortPoint,
    goal: PortPoint,
    bounds: ReturnType<HighDensitySolverA07["getBounds"]>,
  ) {
    const values = [
      bounds.minX,
      bounds.maxX,
      bounds.safeMinX,
      bounds.safeMaxX,
      start.x,
      goal.x,
      ...this.nodeWithPortPoints.portPoints.map((point) => point.x),
    ]
    for (let x = bounds.safeMinX; x <= bounds.safeMaxX + EPSILON; x += this.gridStep) {
      values.push(x)
    }

    const bottom = pickPortOnSide(connection, "bottom")
    const top = pickPortOnSide(connection, "top")
    if (bottom && top && top.x < bottom.x) {
      for (let x = bounds.safeMinX; x <= bounds.safeMinX + 0.9 + EPSILON; x += 0.18) {
        values.push(x)
      }
      for (let x = bounds.safeMaxX - 0.9; x <= bounds.safeMaxX + EPSILON; x += 0.18) {
        values.push(x)
      }
    }

    return uniqueSorted(values)
  }

  private buildYCoordinates(
    connection: RoutedConnection,
    start: PortPoint,
    goal: PortPoint,
    bounds: ReturnType<HighDensitySolverA07["getBounds"]>,
  ) {
    const values = [
      bounds.minY,
      bounds.maxY,
      bounds.safeMinY,
      bounds.safeMaxY,
      start.y,
      goal.y,
      ...this.nodeWithPortPoints.portPoints.map((point) => point.y),
    ]
    for (let y = bounds.safeMinY; y <= bounds.safeMaxY + EPSILON; y += this.gridStep) {
      values.push(y)
    }

    const pair = pairKey(...connection.sides)
    if (pair === "bottom->left") {
      for (let y = bounds.safeMinY; y <= bounds.safeMaxY + EPSILON; y += 0.18) {
        values.push(y)
      }
    }

    return uniqueSorted(values)
  }

  private findNodeKeyForPoint(nodes: Map<string, SearchNode>, point: PortPoint) {
    for (const node of nodes.values()) {
      if (
        approxEqual(node.x, point.x) &&
        approxEqual(node.y, point.y) &&
        node.z === point.z
      ) {
        return node.key
      }
    }
    return null
  }

  private buildObstacleIndex(
    routed: HighDensityIntraNodeRoute[],
    currentRoot: string,
  ): ObstacleIndex {
    const relevantRoutes = routed.filter((route) => {
      const root = route.rootConnectionName ?? route.connectionName.replace(/_mst\d+$/, "")
      return root !== currentRoot
    })

    const segments: ObstacleSegment[] = []
    const points: Array<{ x: number; y: number; z: number }> = []
    const vias: Array<{ x: number; y: number }> = []

    for (const route of relevantRoutes) {
      for (const point of route.route) {
        points.push({ x: point.x, y: point.y, z: point.z })
      }
      for (let index = 0; index < route.route.length - 1; index++) {
        const a = route.route[index]!
        const b = route.route[index + 1]!
        if (a.z !== b.z) continue
        segments.push({
          z: a.z,
          a: { x: a.x, y: a.y },
          b: { x: b.x, y: b.y },
        })
      }
      vias.push(...route.vias.map((via) => ({ x: via.x, y: via.y })))
    }

    for (const portPoint of this.nodeWithPortPoints.portPoints) {
      const root =
        portPoint.rootConnectionName ??
        portPoint.connectionName.replace(/_mst\d+$/, "")
      if (root === currentRoot) continue
      points.push({ x: portPoint.x, y: portPoint.y, z: portPoint.z })
    }

    return { segments, points, vias }
  }

  private resolvePreferredLayer(
    profile: RoutingProfile,
    nativeZ: number,
    availableZ: number[],
  ) {
    if (profile.preferredLayer === "none") return null
    if (profile.preferredLayer === "native") return nativeZ
    return availableZ.find((z) => z !== nativeZ) ?? nativeZ
  }

  private getNeighbors(
    node: SearchNode,
    nodes: Map<string, SearchNode>,
    xCoords: number[],
    yCoords: number[],
  ) {
    const next: SearchNode[] = []
    const pushNeighbor = (xIndex: number, yIndex: number, z: number) => {
      const candidate = nodes.get(`${xIndex}:${yIndex}:${z}`)
      if (candidate) next.push(candidate)
    }

    if (node.xIndex > 0) {
      pushNeighbor(node.xIndex - 1, node.yIndex, node.z)
    }
    if (node.xIndex + 1 < xCoords.length) {
      pushNeighbor(node.xIndex + 1, node.yIndex, node.z)
    }
    if (node.yIndex > 0) {
      pushNeighbor(node.xIndex, node.yIndex - 1, node.z)
    }
    if (node.yIndex + 1 < yCoords.length) {
      pushNeighbor(node.xIndex, node.yIndex + 1, node.z)
    }
    pushNeighbor(node.xIndex, node.yIndex, node.z === 0 ? 1 : 0)

    return next
  }

  private directionBetween(from: SearchNode, to: SearchNode): MoveDirection {
    if (from.z !== to.z) return "via"
    if (approxEqual(from.x, to.x)) {
      return to.y > from.y ? "up" : "down"
    }
    return to.x > from.x ? "right" : "left"
  }

  private canTraverse(
    from: SearchNode,
    to: SearchNode,
    obstacles: ObstacleIndex,
    _currentRoot: string,
    bounds: ReturnType<HighDensitySolverA07["getBounds"]>,
  ) {
    if (from.z !== to.z) {
      return this.isViaAllowed(to, obstacles, bounds)
    }

    const a = { x: from.x, y: from.y }
    const b = { x: to.x, y: to.y }
    const traceClearance = this.traceThickness
    const viaTraceClearance = this.viaDiameter / 2 + this.traceThickness / 2

    for (const segment of obstacles.segments) {
      if (segment.z !== from.z) continue
      if (
        segmentDistance(a, b, segment.a, segment.b) <
        traceClearance - 1e-6
      ) {
        return false
      }
    }
    for (const point of obstacles.points) {
      if (point.z !== from.z) continue
      if (
        pointToSegmentDistance(point, a, b) <
        traceClearance - 1e-6
      ) {
        return false
      }
    }
    for (const via of obstacles.vias) {
      if (
        pointToSegmentDistance(via, a, b) <
        viaTraceClearance - 1e-6
      ) {
        return false
      }
    }

    return true
  }

  private isViaAllowed(
    node: SearchNode,
    obstacles: ObstacleIndex,
    bounds: ReturnType<HighDensitySolverA07["getBounds"]>,
  ) {
    if (
      node.x < bounds.safeMinX - 1e-6 ||
      node.x > bounds.safeMaxX + 1e-6 ||
      node.y < bounds.safeMinY - 1e-6 ||
      node.y > bounds.safeMaxY + 1e-6
    ) {
      return false
    }

    const viaPoint = { x: node.x, y: node.y }
    const viaClearance = this.viaDiameter
    const viaTraceClearance = this.viaDiameter / 2 + this.traceThickness / 2

    for (const via of obstacles.vias) {
      if (pointDistance(viaPoint, via) < viaClearance - 1e-6) {
        return false
      }
    }
    for (const point of obstacles.points) {
      if (pointDistance(viaPoint, point) < viaTraceClearance - 1e-6) {
        return false
      }
    }
    for (const segment of obstacles.segments) {
      if (
        pointToSegmentDistance(viaPoint, segment.a, segment.b) <
        viaTraceClearance - 1e-6
      ) {
        return false
      }
    }

    return true
  }

  private moveCost(
    from: SearchNode,
    to: SearchNode,
    moveDir: MoveDirection,
    previousDir: MoveDirection,
    preferredLayer: number | null,
    start: PortPoint,
    goal: PortPoint,
    bounds: ReturnType<HighDensitySolverA07["getBounds"]>,
    profile: RoutingProfile,
  ) {
    const distance =
      moveDir === "via"
        ? profile.viaCost
        : Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
    let cost = distance

    if (
      previousDir !== "start" &&
      moveDir !== "via" &&
      previousDir !== "via" &&
      previousDir !== moveDir
    ) {
      cost += profile.turnCost
    }
    if (preferredLayer !== null && to.z !== preferredLayer) {
      cost += 0.12
    }

    const normalizedX =
      (to.x - bounds.safeMinX) / Math.max(bounds.safeMaxX - bounds.safeMinX, 1e-6)
    const normalizedY =
      (to.y - bounds.safeMinY) / Math.max(bounds.safeMaxY - bounds.safeMinY, 1e-6)

    if (profile.xBias < 0) {
      cost += normalizedX * 0.12
    } else if (profile.xBias > 0) {
      cost += (1 - normalizedX) * 0.12
    }

    if (profile.yBias < 0) {
      cost += normalizedY * 0.08
    } else if (profile.yBias > 0) {
      cost += (1 - normalizedY) * 0.08
    }

    const minEndpointX = Math.min(start.x, goal.x)
    const maxEndpointX = Math.max(start.x, goal.x)
    if (to.x < minEndpointX - 0.4 || to.x > maxEndpointX + 0.4) {
      cost += profile.overshootPenalty
    }

    return cost
  }

  private heuristic(
    current: SearchNode,
    goal: SearchNode,
    profile: RoutingProfile,
    preferredLayer: number | null,
  ) {
    let score = Math.abs(current.x - goal.x) + Math.abs(current.y - goal.y)
    if (current.z !== goal.z) score += profile.viaCost * 0.6
    if (preferredLayer !== null && current.z !== preferredLayer) score += 0.08
    return score
  }

  private reconstructRoute(
    finalStateKey: string,
    previous: Map<
      string,
      { prevKey: string | null; prevDir: MoveDirection; nodeKey: string }
    >,
    nodes: Map<string, SearchNode>,
    connection: RoutedConnection,
  ): HighDensityIntraNodeRoute | null {
    const nodeKeys: string[] = []
    let cursor: string | null = finalStateKey
    while (cursor) {
      const entry = previous.get(cursor)
      if (!entry) break
      nodeKeys.push(entry.nodeKey)
      cursor = entry.prevKey
    }
    nodeKeys.reverse()
    if (nodeKeys.length === 0) return null

    const points: RoutePoint[] = []
    for (const key of nodeKeys) {
      const node = nodes.get(key)
      if (!node) return null
      appendPoint(points, { x: node.x, y: node.y, z: node.z })
    }

    const compact: RoutePoint[] = []
    for (const point of points) {
      appendPoint(compact, point)
      while (compact.length >= 3) {
        const a = compact[compact.length - 3]!
        const b = compact[compact.length - 2]!
        const c = compact[compact.length - 1]!
        if (
          a.z === b.z &&
          b.z === c.z &&
          ((approxEqual(a.x, b.x) && approxEqual(b.x, c.x)) ||
            (approxEqual(a.y, b.y) && approxEqual(b.y, c.y)))
        ) {
          compact.splice(compact.length - 2, 1)
        } else {
          break
        }
      }
    }

    return this.toRoute(connection, compact)
  }

  private stateKey(nodeKey: string, dir: MoveDirection) {
    return `${nodeKey}|${dir}`
  }

  private routeSignature(route: HighDensityIntraNodeRoute) {
    return route.route
      .map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.z}`)
      .join(" -> ")
  }

  private coordinateKey(x: number, y: number, z: number) {
    return `${x.toFixed(6)}:${y.toFixed(6)}:${z}`
  }

  private getDetourBanSets(route: HighDensityIntraNodeRoute) {
    if (route.route.length < 5) return [] as Set<string>[]

    const candidateIndexes = new Set<number>([
      1,
      2,
      Math.floor(route.route.length / 2),
      route.route.length - 3,
      route.route.length - 2,
    ])

    const banSets: Set<string>[] = []
    for (const index of candidateIndexes) {
      const point = route.route[index]
      if (!point) continue
      if (index <= 0 || index >= route.route.length - 1) continue
      banSets.push(new Set([this.coordinateKey(point.x, point.y, point.z)]))
    }
    return banSets
  }

  private routeLength(route: HighDensityIntraNodeRoute) {
    let total = 0
    for (let index = 0; index < route.route.length - 1; index++) {
      const a = route.route[index]!
      const b = route.route[index + 1]!
      total += Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      if (a.z !== b.z) total += this.viaDiameter
    }
    return total
  }

  private collectConnections():
    | { ok: true; connections: RoutedConnection[] }
    | { ok: false; error: string } {
    const byName = new Map<string, PortPoint[]>()
    for (const portPoint of this.nodeWithPortPoints.portPoints) {
      const points = byName.get(portPoint.connectionName) ?? []
      points.push(portPoint)
      byName.set(portPoint.connectionName, points)
    }

    const connections: RoutedConnection[] = []
    for (const [connectionName, points] of byName) {
      if (points.length !== 2) {
        return {
          ok: false,
          error: `A07 requires two port points per connection, got ${points.length} for ${connectionName}`,
        }
      }

      const first = points[0]!
      const second = points[1]!
      const firstSide = sideOfPoint(first, this.nodeWithPortPoints)
      const secondSide = sideOfPoint(second, this.nodeWithPortPoints)
      if (firstSide === "right" || secondSide === "right") {
        return {
          ok: false,
          error: `A07 does not support right-edge terminals (${connectionName})`,
        }
      }

      const key = pairKey(firstSide, secondSide)
      if (key !== "bottom->left" && key !== "bottom->top") {
        return {
          ok: false,
          error:
            "A07 only supports bottom-top and bottom-left two-pin connections",
        }
      }

      connections.push({
        connectionName,
        rootConnectionName: toRootNetName(
          connectionName,
          first.rootConnectionName ?? second.rootConnectionName,
        ),
        points: [first, second],
        sides: [firstSide, secondSide],
      })
    }

    return { ok: true, connections }
  }

  private toRoute(
    connection: RoutedConnection,
    route: RoutePoint[],
  ): HighDensityIntraNodeRoute {
    return {
      connectionName: connection.connectionName,
      rootConnectionName: connection.rootConnectionName,
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      route,
      vias: deriveViasFromRoutePoints(route),
    }
  }
}
