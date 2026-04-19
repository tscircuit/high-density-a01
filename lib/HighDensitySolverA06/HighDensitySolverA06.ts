import { BaseSolver } from "@tscircuit/solver-utils"
import { deriveViasFromRoutePoints } from "../routeReflow"
import { findRouteGeometryViolations } from "../routeGeometry"
import {
  HighDensitySolverA05,
  type HighDensitySolverA05Props,
} from "../HighDensitySolverA05/HighDensitySolverA05"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../types"

type RoutePoint = { x: number; y: number; z: number }
type BreakoutGoalPoint = RoutePoint & { goalCost?: number }
type BreakoutSide = "start" | "end"

type BreakoutCandidate = {
  point: RoutePoint
  needsBreakout: boolean
  targetKey?: number
}

type BreakoutSeedPlan = {
  connectionName: string
  rootConnectionName?: string
  startPoint: RoutePoint
  endPoint: RoutePoint
  startCandidates: BreakoutCandidate[]
  endCandidates: BreakoutCandidate[]
}

type BreakoutPlan = {
  connectionName: string
  rootConnectionName?: string
  startPoint: RoutePoint
  endPoint: RoutePoint
  breakoutStartPoint: RoutePoint
  breakoutEndPoint: RoutePoint
  breakoutStartConnectionName?: string
  breakoutEndConnectionName?: string
}

type BreakoutLeg = {
  planIndex: number
  side: BreakoutSide
  connectionName: string
  rootConnectionName?: string
  startPoint: RoutePoint
  candidates: BreakoutCandidate[]
}

type MainSegment = {
  connectionName: string
  rootConnectionName?: string
  startPoint: RoutePoint
  endPoint: RoutePoint
}

type A05SegView = {
  connId: number
  startPoint: RoutePoint
  endPoint: RoutePoint
  startCellId: number
  endCellId: number
}

type A05ProbeView = {
  planeSize: number
  cellRegion: Uint8Array
  cellCenterX: Float64Array
  cellCenterY: Float64Array
  cellRow: Int32Array
  cellCol: Int32Array
  connIdToName: string[]
  connIdToRootNet: string[]
  regions: Array<{
    id: number
    name: "left" | "top" | "right" | "bottom" | "middle"
    rows: number
    cols: number
  }>
}

type A05BreakoutProbeView = A05ProbeView & {
  layers: number
  viaAllowed: Uint8Array
  neighborOffset: Int32Array
  neighborIds: Int32Array
  neighborCosts: Float32Array
  pointToCell: (pt: RoutePoint) => { z: number; cellId: number }
  computeMoveCostAndRips: (
    activeConn: number,
    toZ: number,
    toCellId: number,
    isVia: boolean,
    rippedHead: number,
    currentRipCount: number,
    currentRipSig: number,
    lateralCost: number,
  ) => void
  _moveCost: number
  buildRoutePointsFromStates: (
    states: ArrayLike<number>,
    startPoint: RoutePoint,
    endPoint: RoutePoint,
  ) => RoutePoint[]
}

type BreakoutAttemptConfig = {
  connectionOrderingStrategy: "shuffle" | "shortest-first" | "critical-first"
  effort: number
  maxRips: number
  shuffleSeed: number
  noPathRetryLimit: number
  deadEndRipUpCount: number
  lateStageBundleThreshold: number
  lateStageBundleExtraConnections: number
}

type MainAttemptConfig = {
  connectionOrderingStrategy: "shuffle" | "shortest-first" | "critical-first"
  effort: number
  maxRips: number
  shuffleSeed: number
  noPathRetryLimit: number
  deadEndRipUpCount: number
  lateStageBundleThreshold: number
  lateStageBundleExtraConnections: number
}

class LocalMinHeap {
  private items: Array<{ cost: number; state: number }> = []

  get size() {
    return this.items.length
  }

  push(cost: number, state: number) {
    this.items.push({ cost, state })
    let index = this.items.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.items[parent]!.cost <= this.items[index]!.cost) break
      const tmp = this.items[parent]!
      this.items[parent] = this.items[index]!
      this.items[index] = tmp
      index = parent
    }
  }

  pop() {
    const first = this.items[0]
    const last = this.items.pop()
    if (!first) return null
    if (this.items.length > 0 && last) {
      this.items[0] = last
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (
          left < this.items.length &&
          this.items[left]!.cost < this.items[smallest]!.cost
        ) {
          smallest = left
        }
        if (
          right < this.items.length &&
          this.items[right]!.cost < this.items[smallest]!.cost
        ) {
          smallest = right
        }
        if (smallest === index) break
        const tmp = this.items[index]!
        this.items[index] = this.items[smallest]!
        this.items[smallest] = tmp
        index = smallest
      }
    }
    return first
  }
}

export interface HighDensitySolverA06Props extends HighDensitySolverA05Props {
  breakoutCandidateLimit?: number
  breakoutAttemptLimit?: number
}

function appendRoutePoints(
  out: RoutePoint[],
  nextPoints: RoutePoint[],
  reverse = false,
) {
  const points = reverse ? nextPoints.slice().reverse() : nextPoints
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.x === point.x &&
      prev.y === point.y &&
      prev.z === point.z
    ) {
      continue
    }
    out.push({ ...point })
  }
}

function hashString(text: string) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function buildRotatedIndexOrder(
  length: number,
  rotate: number,
  reverse: boolean,
) {
  if (length <= 1) return [0]
  const order = Array.from({ length }, (_, index) => index)
  const rotated = [
    ...order.slice(rotate % length),
    ...order.slice(0, rotate % length),
  ]
  return reverse ? rotated.reverse() : rotated
}

function routePointKey(point: RoutePoint) {
  return `${point.x.toFixed(6)}:${point.y.toFixed(6)}:${point.z}`
}

export class HighDensitySolverA06 extends BaseSolver {
  private readonly props: HighDensitySolverA06Props
  private readonly breakoutCandidateLimit: number
  private readonly breakoutAttemptLimit: number
  private readonly nodeWithPortPoints: NodeWithPortPoints

  private breakoutSeeds: BreakoutSeedPlan[] = []
  private breakoutPlans: BreakoutPlan[] = []
  private breakoutRoutes: HighDensityIntraNodeRoute[] = []
  private lockedBreakoutPlans: BreakoutPlan[] | null = null
  private lockedBreakoutRoutes: HighDensityIntraNodeRoute[] | null = null
  private breakoutSolver: HighDensitySolverA05 | null = null
  private mainSolver: HighDensitySolverA05 | null = null
  private mainRoutes: HighDensityIntraNodeRoute[] = []
  private combinedRoutes: HighDensityIntraNodeRoute[] = []
  private phase: "breakout" | "main" | "done" = "breakout"
  private attemptIndex = -1
  private lastAttemptError: string | null = null
  private routingProbe: HighDensitySolverA05 | null = null

  constructor(props: HighDensitySolverA06Props) {
    super()
    this.props = props
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.breakoutCandidateLimit = Math.max(
      1,
      Math.floor(props.breakoutCandidateLimit ?? 4096),
    )
    this.breakoutAttemptLimit = Math.max(
      1,
      Math.floor(props.breakoutAttemptLimit ?? 8),
    )
    this.MAX_ITERATIONS = 1_000_000_000
  }

  override getConstructorParams(): [HighDensitySolverA06Props] {
    return [this.props]
  }

  override _setup(): void {
    const probe = new HighDensitySolverA05(
      this.buildProbeSolverProps(this.nodeWithPortPoints),
    )
    probe.setup()
    if (probe.failed) {
      this.failed = true
      this.error = probe.error
      return
    }

    this.breakoutSeeds = this.buildBreakoutSeeds(probe)
    this.routingProbe = probe
    this.initializeAttempt(0)
  }

  override _step(): void {
    if (this.failed || this.solved) return

    if (this.phase === "breakout") {
      if (!this.breakoutSolver) {
        this.startMainPhase()
        return
      }

      this.activeSubSolver = this.breakoutSolver
      this.breakoutSolver.step()
      this.stats = {
        ...this.stats,
        phase: this.phase,
        attempt: this.attemptIndex + 1,
        breakoutProgress: this.breakoutSolver.progress,
      }

      if (this.breakoutSolver.failed) {
        this.tryAdvanceAttempt(
          `A06 breakout phase failed: ${this.breakoutSolver.error}`,
        )
        return
      }

      if (this.breakoutSolver.solved) {
        this.startMainPhase()
      }
      return
    }

    if (!this.mainSolver) {
      this.tryAdvanceAttempt("A06 main phase was not initialized")
      return
    }

    this.activeSubSolver = this.mainSolver
    this.mainSolver.step()
    this.stats = {
      ...this.stats,
      phase: this.phase,
      attempt: this.attemptIndex + 1,
      mainProgress: this.mainSolver.progress,
    }

    if (this.mainSolver.failed) {
      const repairedMainRoutes = this.completeMainRoutes(
        this.mainSolver.getOutput(),
      )
      if (repairedMainRoutes && this.finalizeMainRoutes(repairedMainRoutes)) {
        return
      }
      this.tryAdvanceAttempt(`A06 main phase failed: ${this.mainSolver.error}`)
      return
    }

    if (!this.mainSolver.solved) return

    this.finalizeMainRoutes(this.mainSolver.getOutput())
  }

  computeProgress(): number {
    if (this.solved) return 1
    if (this.phase === "breakout") {
      return (this.breakoutSolver?.progress ?? 0) * 0.45
    }
    return 0.45 + (this.mainSolver?.progress ?? 0) * 0.55
  }

  override visualize() {
    if (this.phase === "breakout" && this.breakoutSolver) {
      return this.breakoutSolver.visualize()
    }
    if (this.mainSolver) {
      return this.mainSolver.visualize()
    }
    return {
      points: [],
      lines: [],
      circles: [],
      rects: [],
      coordinateSystem: "cartesian" as const,
      title: "HighDensityA06",
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    if (this.combinedRoutes.length > 0) return this.combinedRoutes
    return this.mainSolver?.getOutput() ?? this.breakoutRoutes
  }

  private initializeAttempt(attemptIndex: number): boolean {
    if (attemptIndex >= this.breakoutAttemptLimit) {
      this.failed = true
      this.error =
        this.lastAttemptError ??
        `A06 failed after ${this.breakoutAttemptLimit} attempts`
      return false
    }

    this.attemptIndex = attemptIndex
    this.breakoutSolver = null
    this.mainSolver = null
    this.mainRoutes = []
    this.combinedRoutes = []
    if (this.lockedBreakoutPlans && this.lockedBreakoutRoutes) {
      this.phase = "main"
      this.breakoutPlans = this.lockedBreakoutPlans.map((plan) => ({
        ...plan,
        startPoint: { ...plan.startPoint },
        endPoint: { ...plan.endPoint },
        breakoutStartPoint: { ...plan.breakoutStartPoint },
        breakoutEndPoint: { ...plan.breakoutEndPoint },
      }))
      this.breakoutRoutes = this.lockedBreakoutRoutes.map((route) => ({
        ...route,
        route: route.route.map((point) => ({ ...point })),
        vias: route.vias.map((via) => ({ ...via })),
      }))
      return this.startMainPhase()
    }

    this.phase = "breakout"
    this.breakoutRoutes = []
    this.breakoutPlans = this.buildBreakoutPlansForAttempt(attemptIndex)

    const breakoutRoutes = this.solveBreakoutRoutes()
    if (!breakoutRoutes) {
      return this.initializeAttempt(attemptIndex + 1)
    }

    this.breakoutRoutes = breakoutRoutes
    this.stats = {
      ...this.stats,
      phase: this.phase,
      attempt: this.attemptIndex + 1,
      breakoutPlans: this.breakoutPlans.length,
      breakoutConnections: breakoutRoutes.length,
    }
    return this.startMainPhase()
  }

  private tryAdvanceAttempt(reason: string): boolean {
    this.lastAttemptError = reason
    const nextAttempt = this.attemptIndex + 1
    if (nextAttempt < this.breakoutAttemptLimit) {
      this.initializeAttempt(nextAttempt)
      return true
    }

    const attemptCount = this.attemptIndex + 1
    this.failed = true
    this.error = `${reason} after ${attemptCount} A06 attempt${attemptCount === 1 ? "" : "s"}`
    return false
  }

  private finalizeMainRoutes(mainRoutes: HighDensityIntraNodeRoute[]) {
    this.mainRoutes = mainRoutes.map((route) => ({
      ...route,
      route: route.route.map((point) => ({ ...point })),
      vias: route.vias.map((via) => ({ ...via })),
    }))

    const mainViolations = findRouteGeometryViolations(this.mainRoutes)
    if (mainViolations.length > 0) {
      this.mainRoutes = []
      return this.tryAdvanceAttempt(
        `A06 main phase geometry is invalid (${mainViolations.length} violation${mainViolations.length === 1 ? "" : "s"}): ${this.summarizeViolations(mainViolations)}`,
      )
    }

    this.combinedRoutes = this.stitchRoutes()
    const combinedViolations = findRouteGeometryViolations(this.combinedRoutes)
    if (combinedViolations.length > 0) {
      this.mainRoutes = []
      this.combinedRoutes = []
      return this.tryAdvanceAttempt(
        `A06 stitched route geometry is invalid (${combinedViolations.length} violation${combinedViolations.length === 1 ? "" : "s"}): ${this.summarizeViolations(combinedViolations)}`,
      )
    }

    this.phase = "done"
    this.solved = true
    return true
  }

  private summarizeViolations(
    violations: ReturnType<typeof findRouteGeometryViolations>,
  ) {
    return violations
      .slice(0, 5)
      .map((violation) => {
        const zPart = violation.z === null ? "z=all" : `z=${violation.z}`
        return `${violation.trace1} x ${violation.trace2} [${violation.type}] ${zPart}`
      })
      .join("; ")
  }

  private startMainPhase(): boolean {
    const trimmedBreakoutRoutes = this.trimBreakoutRoutesToCoarseAnchors(
      this.breakoutRoutes,
    )
    const breakoutViolations = findRouteGeometryViolations(trimmedBreakoutRoutes)
    if (breakoutViolations.length > 0) {
      const summary = breakoutViolations
        .slice(0, 5)
        .map((violation) => {
          const zPart = violation.z === null ? "z=all" : `z=${violation.z}`
          return `${violation.trace1} x ${violation.trace2} [${violation.type}] ${zPart}`
        })
        .join("; ")
      return this.tryAdvanceAttempt(
        `A06 breakout geometry is invalid (${breakoutViolations.length} violation${breakoutViolations.length === 1 ? "" : "s"}): ${summary}`,
      )
    }

    this.breakoutRoutes = trimmedBreakoutRoutes
    this.updateBreakoutPlanEndpointsFromRoutes(this.breakoutRoutes)
    if (!this.lockedBreakoutPlans || !this.lockedBreakoutRoutes) {
      this.lockedBreakoutPlans = this.breakoutPlans.map((plan) => ({
        ...plan,
        startPoint: { ...plan.startPoint },
        endPoint: { ...plan.endPoint },
        breakoutStartPoint: { ...plan.breakoutStartPoint },
        breakoutEndPoint: { ...plan.breakoutEndPoint },
      }))
      this.lockedBreakoutRoutes = this.breakoutRoutes.map((route) => ({
        ...route,
        route: route.route.map((point) => ({ ...point })),
        vias: route.vias.map((via) => ({ ...via })),
      }))
    }

    const mainNode = this.buildMainPhaseNode()
    this.mainSolver = new HighDensitySolverA05(
      this.buildMainSolverProps(mainNode, this.props.fixedObstacleRoutes ?? []),
    )
    this.mainSolver.MAX_ITERATIONS = this.getPhaseIterationBudget()
    this.mainSolver.setup()
    if (this.mainSolver.failed) {
      return this.tryAdvanceAttempt(
        `A06 main phase setup failed: ${this.mainSolver.error}`,
      )
    }

    this.phase = "main"
    this.activeSubSolver = this.mainSolver
    this.stats = {
      ...this.stats,
      phase: this.phase,
      attempt: this.attemptIndex + 1,
      breakoutPlans: this.breakoutPlans.length,
      breakoutConnections: this.breakoutRoutes.length,
    }
    return true
  }

  private buildProbeSolverProps(
    nodeWithPortPoints: NodeWithPortPoints,
  ): HighDensitySolverA05Props {
    return this.buildBasePhaseSolverProps(nodeWithPortPoints)
  }

  private buildBreakoutSolverProps(
    nodeWithPortPoints: NodeWithPortPoints,
    alternativeGoalPointsByConnectionName?: Record<string, BreakoutGoalPoint[]>,
  ): HighDensitySolverA05Props {
    const attemptConfig = this.getBreakoutAttemptConfig()
    return {
      ...this.buildBasePhaseSolverProps(nodeWithPortPoints),
      alternativeGoalPointsByConnectionName,
      effort: attemptConfig.effort,
      maxRips: attemptConfig.maxRips,
      connectionOrderingStrategy: attemptConfig.connectionOrderingStrategy,
      noPathRetryLimit: attemptConfig.noPathRetryLimit,
      deadEndRipUpCount: attemptConfig.deadEndRipUpCount,
      lateStageBundleThreshold: attemptConfig.lateStageBundleThreshold,
      lateStageBundleExtraConnections:
        attemptConfig.lateStageBundleExtraConnections,
      hyperParameters: {
        ...(this.props.hyperParameters ?? {}),
        shuffleSeed: attemptConfig.shuffleSeed,
      },
      postRouteSegmentCount: 0,
      postRouteForceDirectedSteps: 0,
    }
  }

  private buildMainSolverProps(
    nodeWithPortPoints: NodeWithPortPoints,
    fixedObstacleRoutes: HighDensityIntraNodeRoute[],
  ): HighDensitySolverA05Props {
    const attemptConfig = this.getMainAttemptConfig()
    const phaseBudget = this.getPhaseIterationBudget()
    return {
      ...this.buildBasePhaseSolverProps(nodeWithPortPoints),
      effort: attemptConfig.effort,
      maxRips: attemptConfig.maxRips,
      connectionOrderingStrategy: attemptConfig.connectionOrderingStrategy,
      noPathRetryLimit: attemptConfig.noPathRetryLimit,
      deadEndRipUpCount: attemptConfig.deadEndRipUpCount,
      lateStageBundleThreshold: attemptConfig.lateStageBundleThreshold,
      lateStageBundleExtraConnections:
        attemptConfig.lateStageBundleExtraConnections,
      hyperParameters: {
        ...(this.props.hyperParameters ?? {}),
        shuffleSeed: attemptConfig.shuffleSeed,
      },
      minimumBaseSearchBudget: Math.max(
        4_000_000,
        Math.floor(phaseBudget * 0.5),
      ),
      fixedObstacleRoutes,
    }
  }

  private buildBasePhaseSolverProps(
    nodeWithPortPoints: NodeWithPortPoints,
  ): HighDensitySolverA05Props {
    const phaseBudget = this.getPhaseIterationBudget()
    const {
      breakoutCandidateLimit: _breakoutCandidateLimit,
      breakoutAttemptLimit: _breakoutAttemptLimit,
      nodeWithPortPoints: _originalNode,
      ...a05Props
    } = this.props

    return {
      ...a05Props,
      nodeWithPortPoints,
      maxRips: Math.max(4000, Math.floor((a05Props.maxRips ?? 200) * 8)),
      noPathRetryLimit: Math.max(
        3,
        Math.floor(a05Props.noPathRetryLimit ?? 0),
      ),
      deadEndRipUpCount: Math.max(
        3,
        Math.floor(a05Props.deadEndRipUpCount ?? 0),
      ),
      minimumIterationBudget: phaseBudget,
      minimumBaseSearchBudget: Math.max(
        2_000_000,
        Math.floor(phaseBudget * 0.35),
      ),
      postRouteSegmentCount: 0,
      postRouteForceDirectedSteps: 0,
    }
  }

  private getPhaseIterationBudget() {
    return Math.max(
      500_000,
      Math.floor(this.MAX_ITERATIONS / Math.max(1, this.breakoutAttemptLimit * 2)),
    )
  }

  private getBreakoutAttemptConfig(): BreakoutAttemptConfig {
    const profiles: BreakoutAttemptConfig[] = [
      {
        connectionOrderingStrategy: "shortest-first",
        effort: 20,
        maxRips: 500_000,
        shuffleSeed: 0,
        noPathRetryLimit: 10,
        deadEndRipUpCount: 10,
        lateStageBundleThreshold: 8,
        lateStageBundleExtraConnections: 16,
      },
      {
        connectionOrderingStrategy: "critical-first",
        effort: 20,
        maxRips: 500_000,
        shuffleSeed: 0,
        noPathRetryLimit: 10,
        deadEndRipUpCount: 10,
        lateStageBundleThreshold: 8,
        lateStageBundleExtraConnections: 16,
      },
      {
        connectionOrderingStrategy: "shuffle",
        effort: 20,
        maxRips: 500_000,
        shuffleSeed: 1,
        noPathRetryLimit: 10,
        deadEndRipUpCount: 10,
        lateStageBundleThreshold: 8,
        lateStageBundleExtraConnections: 16,
      },
      {
        connectionOrderingStrategy: "shortest-first",
        effort: 24,
        maxRips: 1_000_000,
        shuffleSeed: 2,
        noPathRetryLimit: 12,
        deadEndRipUpCount: 12,
        lateStageBundleThreshold: 10,
        lateStageBundleExtraConnections: 20,
      },
      {
        connectionOrderingStrategy: "critical-first",
        effort: 24,
        maxRips: 1_000_000,
        shuffleSeed: 3,
        noPathRetryLimit: 12,
        deadEndRipUpCount: 12,
        lateStageBundleThreshold: 10,
        lateStageBundleExtraConnections: 20,
      },
      {
        connectionOrderingStrategy: "shuffle",
        effort: 24,
        maxRips: 1_000_000,
        shuffleSeed: 5,
        noPathRetryLimit: 12,
        deadEndRipUpCount: 12,
        lateStageBundleThreshold: 10,
        lateStageBundleExtraConnections: 20,
      },
      {
        connectionOrderingStrategy: "shortest-first",
        effort: 32,
        maxRips: 2_000_000,
        shuffleSeed: 7,
        noPathRetryLimit: 16,
        deadEndRipUpCount: 16,
        lateStageBundleThreshold: 12,
        lateStageBundleExtraConnections: 24,
      },
      {
        connectionOrderingStrategy: "critical-first",
        effort: 32,
        maxRips: 2_000_000,
        shuffleSeed: 11,
        noPathRetryLimit: 16,
        deadEndRipUpCount: 16,
        lateStageBundleThreshold: 12,
        lateStageBundleExtraConnections: 24,
      },
    ]

    const profile = profiles[this.attemptIndex % profiles.length]!
    return {
      ...profile,
      shuffleSeed: profile.shuffleSeed + this.attemptIndex,
    }
  }

  private getMainAttemptConfig(): MainAttemptConfig {
    const profiles: MainAttemptConfig[] = [
      {
        connectionOrderingStrategy: "critical-first",
        effort: 16,
        maxRips: 200_000,
        shuffleSeed: 0,
        noPathRetryLimit: 8,
        deadEndRipUpCount: 8,
        lateStageBundleThreshold: 6,
        lateStageBundleExtraConnections: 12,
      },
      {
        connectionOrderingStrategy: "shortest-first",
        effort: 16,
        maxRips: 200_000,
        shuffleSeed: 1,
        noPathRetryLimit: 8,
        deadEndRipUpCount: 8,
        lateStageBundleThreshold: 6,
        lateStageBundleExtraConnections: 12,
      },
      {
        connectionOrderingStrategy: "shuffle",
        effort: 16,
        maxRips: 200_000,
        shuffleSeed: 3,
        noPathRetryLimit: 8,
        deadEndRipUpCount: 8,
        lateStageBundleThreshold: 6,
        lateStageBundleExtraConnections: 12,
      },
      {
        connectionOrderingStrategy: "critical-first",
        effort: 24,
        maxRips: 400_000,
        shuffleSeed: 5,
        noPathRetryLimit: 12,
        deadEndRipUpCount: 12,
        lateStageBundleThreshold: 8,
        lateStageBundleExtraConnections: 16,
      },
      {
        connectionOrderingStrategy: "shortest-first",
        effort: 24,
        maxRips: 400_000,
        shuffleSeed: 7,
        noPathRetryLimit: 12,
        deadEndRipUpCount: 12,
        lateStageBundleThreshold: 8,
        lateStageBundleExtraConnections: 16,
      },
      {
        connectionOrderingStrategy: "shuffle",
        effort: 24,
        maxRips: 400_000,
        shuffleSeed: 11,
        noPathRetryLimit: 12,
        deadEndRipUpCount: 12,
        lateStageBundleThreshold: 8,
        lateStageBundleExtraConnections: 16,
      },
      {
        connectionOrderingStrategy: "critical-first",
        effort: 32,
        maxRips: 800_000,
        shuffleSeed: 13,
        noPathRetryLimit: 16,
        deadEndRipUpCount: 16,
        lateStageBundleThreshold: 12,
        lateStageBundleExtraConnections: 24,
      },
      {
        connectionOrderingStrategy: "shuffle",
        effort: 32,
        maxRips: 800_000,
        shuffleSeed: 17,
        noPathRetryLimit: 16,
        deadEndRipUpCount: 16,
        lateStageBundleThreshold: 12,
        lateStageBundleExtraConnections: 24,
      },
    ]

    const profile = profiles[this.attemptIndex % profiles.length]!
    return {
      ...profile,
      shuffleSeed: profile.shuffleSeed + this.attemptIndex,
    }
  }

  private solveBreakoutRoutes() {
    const breakoutNode = this.buildBreakoutPhaseNode()
    if (breakoutNode.portPoints.length === 0) {
      return [] as HighDensityIntraNodeRoute[]
    }
    const breakoutGoalMap = this.buildBreakoutGoalMapForAttempt()

    const simultaneousSolver = new HighDensitySolverA05(
      this.buildBreakoutSolverProps(breakoutNode, breakoutGoalMap),
    )
    simultaneousSolver.MAX_ITERATIONS = this.getPhaseIterationBudget()
    simultaneousSolver.solve()
    if (simultaneousSolver.solved && !simultaneousSolver.failed) {
      const simultaneousRoutes = simultaneousSolver.getOutput()
      const simultaneousViolations =
        findRouteGeometryViolations(simultaneousRoutes)
      if (simultaneousViolations.length === 0) {
        return simultaneousRoutes
      }
    }

    const partialRoutes = simultaneousSolver.getOutput()
    if (partialRoutes.length > 0) {
      const completedRoutes = this.completeBreakoutRoutes(partialRoutes)
      if (completedRoutes) {
        return completedRoutes
      }
    }

    this.lastAttemptError = simultaneousSolver.error
      ? `A06 breakout phase failed: ${simultaneousSolver.error}`
      : "A06 breakout phase failed"
    if (this.attemptIndex + 1 < this.breakoutAttemptLimit) {
      return null
    }

    const breakoutLegs = this.buildBreakoutLegs()
    const legLength = (leg: BreakoutLeg) =>
      Math.hypot(
        leg.startPoint.x - (leg.candidates[0]?.point.x ?? leg.startPoint.x),
        leg.startPoint.y - (leg.candidates[0]?.point.y ?? leg.startPoint.y),
      )
    const legOrderMode = this.attemptIndex % 4
    breakoutLegs.sort((a, b) => {
      if (legOrderMode === 0) return legLength(a) - legLength(b)
      if (legOrderMode === 1) return legLength(b) - legLength(a)
      if (legOrderMode === 2) {
        return hashString(a.connectionName) - hashString(b.connectionName)
      }
      return (
        hashString(`${a.connectionName}:${a.side}`) -
        hashString(`${b.connectionName}:${b.side}`)
      )
    })

    const solvedRoutes: HighDensityIntraNodeRoute[] = []

    for (const leg of breakoutLegs) {
      const legRoute = this.solveBreakoutLegWithCandidateSet(leg, solvedRoutes)
      if (!legRoute) {
        return null
      }

      const chosenEndpoint = legRoute.route[legRoute.route.length - 1]
      if (chosenEndpoint) {
        if (leg.side === "start") {
          this.breakoutPlans[leg.planIndex]!.breakoutStartPoint = {
            ...chosenEndpoint,
          }
        } else {
          this.breakoutPlans[leg.planIndex]!.breakoutEndPoint = {
            ...chosenEndpoint,
          }
        }
      }

      solvedRoutes.push(legRoute)
    }

    const violations = findRouteGeometryViolations(solvedRoutes)
    if (violations.length > 0) {
      const summary = violations
        .slice(0, 5)
        .map((violation) => {
          const zPart = violation.z === null ? "z=all" : `z=${violation.z}`
          return `${violation.trace1} x ${violation.trace2} [${violation.type}] ${zPart}`
        })
        .join("; ")
      this.lastAttemptError = `A06 breakout geometry is invalid (${violations.length} violation${violations.length === 1 ? "" : "s"}): ${summary}`
      return null
    }

    return solvedRoutes
  }

  private completeBreakoutRoutes(
    partialRoutes: HighDensityIntraNodeRoute[],
  ) {
    const solvedRoutes = partialRoutes.map((route) => ({
      ...route,
      route: route.route.map((point) => ({ ...point })),
      vias: route.vias.map((via) => ({ ...via })),
    }))
    const solvedNames = new Set(solvedRoutes.map((route) => route.connectionName))
    const breakoutLegs = this.buildBreakoutLegs().filter(
      (leg) => !solvedNames.has(leg.connectionName),
    )

    const legLength = (leg: BreakoutLeg) =>
      Math.hypot(
        leg.startPoint.x - (leg.candidates[0]?.point.x ?? leg.startPoint.x),
        leg.startPoint.y - (leg.candidates[0]?.point.y ?? leg.startPoint.y),
      )
    breakoutLegs.sort((a, b) => legLength(a) - legLength(b))

    const legByName = new Map(
      this.buildBreakoutLegs().map((leg) => [leg.connectionName, leg]),
    )

    for (const leg of breakoutLegs) {
      const repairedRoutes = this.solveOrRepairBreakoutLeg(
        leg,
        solvedRoutes,
        legByName,
      )
      if (!repairedRoutes) {
        return null
      }
      solvedRoutes.length = 0
      solvedRoutes.push(...repairedRoutes)
    }

    const violations = findRouteGeometryViolations(solvedRoutes)
    if (violations.length > 0) {
      return null
    }

    return solvedRoutes
  }

  private buildMainSegments() {
    const segments: MainSegment[] = []
    for (const plan of this.breakoutPlans) {
      if (plan.breakoutStartConnectionName) {
        segments.push({
          connectionName: plan.breakoutStartConnectionName,
          rootConnectionName: plan.rootConnectionName ?? plan.connectionName,
          startPoint: { ...plan.startPoint },
          endPoint: { ...plan.breakoutStartPoint },
        })
      }

      segments.push({
        connectionName: plan.connectionName,
        rootConnectionName: plan.rootConnectionName,
        startPoint: { ...plan.breakoutStartPoint },
        endPoint: { ...plan.breakoutEndPoint },
      })

      if (plan.breakoutEndConnectionName) {
        segments.push({
          connectionName: plan.breakoutEndConnectionName,
          rootConnectionName: plan.rootConnectionName ?? plan.connectionName,
          startPoint: { ...plan.breakoutEndPoint },
          endPoint: { ...plan.endPoint },
        })
      }
    }
    return segments
  }

  private completeMainRoutes(partialRoutes: HighDensityIntraNodeRoute[]) {
    if (partialRoutes.length === 0) return null

    const solvedRoutes = partialRoutes.map((route) => ({
      ...route,
      route: route.route.map((point) => ({ ...point })),
      vias: route.vias.map((via) => ({ ...via })),
    }))
    const allSegments = this.buildMainSegments()
    const solvedNames = new Set(solvedRoutes.map((route) => route.connectionName))
    const missingSegments = allSegments.filter(
      (segment) => !solvedNames.has(segment.connectionName),
    )
    if (missingSegments.length === 0) {
      return solvedRoutes
    }

    missingSegments.sort(
      (a, b) =>
        Math.hypot(a.startPoint.x - a.endPoint.x, a.startPoint.y - a.endPoint.y) -
        Math.hypot(b.startPoint.x - b.endPoint.x, b.startPoint.y - b.endPoint.y),
    )

    const segmentByName = new Map(
      allSegments.map((segment) => [segment.connectionName, segment]),
    )

    for (const segment of missingSegments) {
      const repairedRoutes = this.solveOrRepairMainSegment(
        segment,
        solvedRoutes,
        segmentByName,
      )
      if (!repairedRoutes) return null
      solvedRoutes.length = 0
      solvedRoutes.push(...repairedRoutes)
    }

    const violations = findRouteGeometryViolations(solvedRoutes)
    if (violations.length > 0) {
      return null
    }

    return solvedRoutes
  }

  private solveOrRepairMainSegment(
    segment: MainSegment,
    solvedRoutes: HighDensityIntraNodeRoute[],
    segmentByName: Map<string, MainSegment>,
  ) {
    const directRoute = this.solveMainSegmentDirect(segment, solvedRoutes)
    if (directRoute) {
      return [...solvedRoutes, directRoute]
    }

    const blockerRoutes = this.getNearbyMainBlockers(segment, solvedRoutes)
    for (let blockerCount = 1; blockerCount <= 3; blockerCount++) {
      const limit = Math.min(blockerRoutes.length, 6)
      const indices = Array.from({ length: limit }, (_, index) => index)
      const combinations =
        blockerCount === 1
          ? indices.map((index) => [index])
          : indices.flatMap((firstIndex, offset) =>
              indices
                .slice(offset + 1)
                .map((secondIndex) => [firstIndex, secondIndex]),
            )

      for (const combination of combinations) {
        const removedRoutes = combination.map((index) => blockerRoutes[index]!)
        const remainingRoutes = solvedRoutes.filter(
          (route) => !removedRoutes.includes(route),
        )
        const repairedSegmentRoute = this.solveMainSegmentDirect(
          segment,
          remainingRoutes,
        )
        if (!repairedSegmentRoute) continue

        const rebuiltRoutes = [...remainingRoutes, repairedSegmentRoute]
        let repairFailed = false
        for (const removedRoute of removedRoutes) {
          const removedSegment = segmentByName.get(removedRoute.connectionName)
          if (!removedSegment) {
            repairFailed = true
            break
          }
          const rerouted = this.solveMainSegmentDirect(
            removedSegment,
            rebuiltRoutes,
          )
          if (!rerouted) {
            repairFailed = true
            break
          }
          rebuiltRoutes.push(rerouted)
        }
        if (repairFailed) continue

        return rebuiltRoutes
      }
    }

    return null
  }

  private getNearbyMainBlockers(
    segment: MainSegment,
    solvedRoutes: HighDensityIntraNodeRoute[],
  ) {
    return [...solvedRoutes]
      .map((route) => ({
        route,
        score: route.route.reduce((best, point) => {
          const startDistance = Math.hypot(
            point.x - segment.startPoint.x,
            point.y - segment.startPoint.y,
          )
          const endDistance = Math.hypot(
            point.x - segment.endPoint.x,
            point.y - segment.endPoint.y,
          )
          return Math.min(best, startDistance + endDistance * 0.5)
        }, Number.POSITIVE_INFINITY),
      }))
      .sort((a, b) => a.score - b.score)
      .map((entry) => entry.route)
  }

  private solveMainSegmentDirect(
    segment: MainSegment,
    solvedRoutes: HighDensityIntraNodeRoute[],
  ) {
    const phaseBudget = this.getPhaseIterationBudget()
    const segmentRootNet =
      segment.rootConnectionName ?? segment.connectionName.replace(/_mst\d+$/, "")
    const filteredObstacleRoutes = [
      ...(this.props.fixedObstacleRoutes ?? []),
      ...solvedRoutes.filter((route) => {
        const routeRootNet =
          route.rootConnectionName ?? route.connectionName.replace(/_mst\d+$/, "")
        return routeRootNet !== segmentRootNet
      }),
    ]
    const directNode: NodeWithPortPoints = {
      capacityMeshNodeId: `${this.nodeWithPortPoints.capacityMeshNodeId}__${segment.connectionName}`,
      center: { ...this.nodeWithPortPoints.center },
      width: this.nodeWithPortPoints.width,
      height: this.nodeWithPortPoints.height,
      availableZ: this.nodeWithPortPoints.availableZ,
      portPoints: [
        {
          ...segment.startPoint,
          connectionName: segment.connectionName,
          rootConnectionName: segment.rootConnectionName,
        },
        {
          ...segment.endPoint,
          connectionName: segment.connectionName,
          rootConnectionName: segment.rootConnectionName,
        },
      ],
    }

    const probe = new HighDensitySolverA05({
      ...this.buildBasePhaseSolverProps(directNode),
      fixedObstacleRoutes: filteredObstacleRoutes,
      effort: 24,
      maxRips: Math.max(200_000, Math.floor((this.props.maxRips ?? 200) * 32)),
      connectionOrderingStrategy: "shortest-first",
      noPathRetryLimit: 16,
      deadEndRipUpCount: 12,
      lateStageBundleThreshold: 2,
      lateStageBundleExtraConnections: 8,
      minimumIterationBudget: Math.max(20_000_000, phaseBudget * 2),
      minimumBaseSearchBudget: Math.max(10_000_000, phaseBudget),
      hyperParameters: {
        ...(this.props.hyperParameters ?? {}),
        shuffleSeed: 0,
      },
      postRouteSegmentCount: 0,
      postRouteForceDirectedSteps: 0,
    })
    probe.MAX_ITERATIONS = Math.max(
      20_000_000,
      phaseBudget * 8,
    )
    probe.solve()
    if (!probe.solved) return null

    return (
      probe
        .getOutput()
        .find((route) => route.connectionName === segment.connectionName) ?? null
    )
  }

  private solveOrRepairBreakoutLeg(
    leg: BreakoutLeg,
    solvedRoutes: HighDensityIntraNodeRoute[],
    legByName: Map<string, BreakoutLeg>,
  ) {
    const directRoute = this.solveBreakoutLegWithCandidateSet(leg, solvedRoutes)
    if (directRoute) {
      return [...solvedRoutes, directRoute]
    }

    const blockerRoutes = this.getNearbyBreakoutBlockers(leg, solvedRoutes)
    for (let blockerCount = 1; blockerCount <= 3; blockerCount++) {
      const limit = Math.min(blockerRoutes.length, 6)
      const indices = Array.from({ length: limit }, (_, index) => index)
      const combinations =
        blockerCount === 1
          ? indices.map((index) => [index])
          : indices.flatMap((firstIndex, offset) =>
              indices
                .slice(offset + 1)
                .map((secondIndex) => [firstIndex, secondIndex]),
            )

      for (const combination of combinations) {
        const removedRoutes = combination.map((index) => blockerRoutes[index]!)
        const remainingRoutes = solvedRoutes.filter(
          (route) => !removedRoutes.includes(route),
        )
        const repairedLegRoute = this.solveBreakoutLegWithCandidateSet(
          leg,
          remainingRoutes,
        )
        if (!repairedLegRoute) continue

        const rebuiltRoutes = [...remainingRoutes, repairedLegRoute]
        let repairFailed = false
        for (const removedRoute of removedRoutes) {
          const removedLeg = legByName.get(removedRoute.connectionName)
          if (!removedLeg) {
            repairFailed = true
            break
          }
          const rerouted = this.solveBreakoutLegWithCandidateSet(
            removedLeg,
            rebuiltRoutes,
          )
          if (!rerouted) {
            repairFailed = true
            break
          }
          rebuiltRoutes.push(rerouted)
        }
        if (repairFailed) continue

        return rebuiltRoutes
      }
    }

    return null
  }

  private getNearbyBreakoutBlockers(
    leg: BreakoutLeg,
    solvedRoutes: HighDensityIntraNodeRoute[],
  ) {
    const anchor = leg.candidates[0]?.point ?? leg.startPoint
    return [...solvedRoutes]
      .map((route) => ({
        route,
        score: route.route.reduce((best, point) => {
          const startDistance = Math.hypot(
            point.x - leg.startPoint.x,
            point.y - leg.startPoint.y,
          )
          const anchorDistance = Math.hypot(
            point.x - anchor.x,
            point.y - anchor.y,
          )
          return Math.min(best, startDistance + anchorDistance * 0.5)
        }, Number.POSITIVE_INFINITY),
      }))
      .sort((a, b) => a.score - b.score)
      .map((entry) => entry.route)
  }

  private buildBreakoutLegs() {
    const legs: BreakoutLeg[] = []
    for (let planIndex = 0; planIndex < this.breakoutPlans.length; planIndex++) {
      const plan = this.breakoutPlans[planIndex]!
      const seed = this.breakoutSeeds[planIndex]!
      if (plan.breakoutStartConnectionName) {
        legs.push({
          planIndex,
          side: "start",
          connectionName: plan.breakoutStartConnectionName,
          rootConnectionName: plan.rootConnectionName ?? plan.connectionName,
          startPoint: { ...plan.startPoint },
          candidates: this.getOrderedCandidatesForAttempt(
            seed.startCandidates,
            `${plan.connectionName}:start`,
          ),
        })
      }
      if (plan.breakoutEndConnectionName) {
        legs.push({
          planIndex,
          side: "end",
          connectionName: plan.breakoutEndConnectionName,
          rootConnectionName: plan.rootConnectionName ?? plan.connectionName,
          startPoint: { ...plan.endPoint },
          candidates: this.getOrderedCandidatesForAttempt(
            seed.endCandidates,
            `${plan.connectionName}:end`,
          ),
        })
      }
    }
    return legs
  }

  private solveBreakoutLegWithCandidateSet(
    leg: BreakoutLeg,
    solvedRoutes: HighDensityIntraNodeRoute[],
  ) {
    const breakoutNode: NodeWithPortPoints = {
      capacityMeshNodeId: `${this.nodeWithPortPoints.capacityMeshNodeId}__${leg.connectionName}`,
      center: { ...this.nodeWithPortPoints.center },
      width: this.nodeWithPortPoints.width,
      height: this.nodeWithPortPoints.height,
      availableZ: this.nodeWithPortPoints.availableZ,
      portPoints: [
        {
          ...leg.startPoint,
          connectionName: leg.connectionName,
          rootConnectionName: leg.rootConnectionName ?? leg.connectionName,
        },
        ...leg.candidates.map((candidate) => ({
          ...candidate.point,
          connectionName: leg.connectionName,
          rootConnectionName: leg.rootConnectionName ?? leg.connectionName,
        })),
      ],
    }

    const legRootNet = leg.rootConnectionName ?? leg.connectionName.replace(/_mst\d+$/, "")
    const probe = new HighDensitySolverA05({
      ...this.buildBreakoutSolverProps(breakoutNode),
      fixedObstacleRoutes: [
        ...(this.props.fixedObstacleRoutes ?? []),
        ...solvedRoutes.filter((route) => {
          const routeRootNet =
            route.rootConnectionName ??
            route.connectionName.replace(/_mst\d+$/, "")
          return routeRootNet !== legRootNet
        }),
      ],
    })
    probe.MAX_ITERATIONS = Math.max(5_000_000, this.getPhaseIterationBudget() * 8)
    probe.setup()
    if (probe.failed) {
      this.lastAttemptError = `A06 breakout phase failed for ${leg.connectionName}: ${probe.error}`
      return null
    }

    const view = probe as unknown as A05BreakoutProbeView
    const start = view.pointToCell(leg.startPoint)
    const startState = start.z * view.planeSize + start.cellId
    const goalStates = new Map<number, RoutePoint>()
    for (const candidate of leg.candidates) {
      const goal = view.pointToCell(candidate.point)
      goalStates.set(goal.z * view.planeSize + goal.cellId, candidate.point)
    }

    const heap = new LocalMinHeap()
    const bestCost = new Map<number, number>()
    const previous = new Map<number, number>()
    heap.push(0, startState)
    bestCost.set(startState, 0)
    previous.set(startState, -1)

    while (heap.size > 0) {
      const current = heap.pop()
      if (!current) break
      if (current.cost !== bestCost.get(current.state)) continue

      const z = Math.floor(current.state / view.planeSize)
      const cellId = current.state - z * view.planeSize
      const goalPoint = goalStates.get(current.state)
      if (goalPoint) {
        const states: number[] = []
        let state = current.state
        while (state !== -1) {
          states.push(state)
          state = previous.get(state) ?? -1
        }
        states.reverse()
        const routePoints = view.buildRoutePointsFromStates(
          states,
          leg.startPoint,
          goalPoint,
        )
        return {
          connectionName: leg.connectionName,
          rootConnectionName: leg.rootConnectionName,
          traceThickness: this.props.traceThickness ?? 0.1,
          viaDiameter: this.props.viaDiameter,
          route: routePoints,
          vias: deriveViasFromRoutePoints(routePoints),
        } satisfies HighDensityIntraNodeRoute
      }

      const neighborStart = view.neighborOffset[cellId]!
      const neighborEnd = view.neighborOffset[cellId + 1]!
      for (let i = neighborStart; i < neighborEnd; i++) {
        const nextCellId = view.neighborIds[i]!
        view.computeMoveCostAndRips(
          0,
          z,
          nextCellId,
          false,
          -1,
          0,
          0,
          view.neighborCosts[i]!,
        )
        if (view._moveCost < 0) continue
        const nextState = z * view.planeSize + nextCellId
        const nextCost = current.cost + view._moveCost
        if (nextCost >= (bestCost.get(nextState) ?? Number.POSITIVE_INFINITY)) {
          continue
        }
        bestCost.set(nextState, nextCost)
        previous.set(nextState, current.state)
        heap.push(nextCost, nextState)
      }

      if (view.viaAllowed[cellId]) {
        for (let nextZ = 0; nextZ < view.layers; nextZ++) {
          if (nextZ === z) continue
          view.computeMoveCostAndRips(0, nextZ, cellId, true, -1, 0, 0, 0)
          if (view._moveCost < 0) continue
          const nextState = nextZ * view.planeSize + cellId
          const nextCost = current.cost + view._moveCost
          if (nextCost >= (bestCost.get(nextState) ?? Number.POSITIVE_INFINITY)) {
            continue
          }
          bestCost.set(nextState, nextCost)
          previous.set(nextState, current.state)
          heap.push(nextCost, nextState)
        }
      }
    }

    this.lastAttemptError = `A06 breakout phase failed for ${leg.connectionName}: No path found for ${leg.connectionName}`
    return null
  }

  private buildBreakoutSeeds(probe: HighDensitySolverA05) {
    const probeView = probe as unknown as A05ProbeView
    const segs = probe.unsolvedConnections as unknown as A05SegView[]
    const middleRegion = probeView.regions.find((region) => region.name === "middle")
    const boundaryMiddleCells = this.getBoundaryMiddleCellIds(probeView, middleRegion)
    const allMiddleCells = this.getAllMiddleCellIds(probeView, middleRegion)

    return segs.map((seg) => {
      const connectionName = probeView.connIdToName[seg.connId]!
      const rootConnectionName = probeView.connIdToRootNet[seg.connId]
      return {
        connectionName,
        rootConnectionName,
        startPoint: { ...seg.startPoint },
        endPoint: { ...seg.endPoint },
        startCandidates: this.buildBreakoutCandidates(
          probeView,
          seg.startPoint,
          seg.startCellId,
          seg.endPoint,
          boundaryMiddleCells,
          allMiddleCells,
        ),
        endCandidates: this.buildBreakoutCandidates(
          probeView,
          seg.endPoint,
          seg.endCellId,
          seg.startPoint,
          boundaryMiddleCells,
          allMiddleCells,
        ),
      }
    })
  }

  private buildBreakoutPlansForAttempt(attemptIndex: number) {
    const plans: BreakoutPlan[] = Array.from(
      { length: this.breakoutSeeds.length },
      () => ({
        connectionName: "",
        startPoint: { x: 0, y: 0, z: 0 },
        endPoint: { x: 0, y: 0, z: 0 },
        breakoutStartPoint: { x: 0, y: 0, z: 0 },
        breakoutEndPoint: { x: 0, y: 0, z: 0 },
      }),
    )
    const usedTargets = new Set<number>()
    const assignmentOrder = this.getAssignmentOrder(
      this.breakoutSeeds.length,
      attemptIndex,
    )

    for (const seedIndex of assignmentOrder) {
      const seed = this.breakoutSeeds[seedIndex]!
      const startCandidate = this.chooseBreakoutCandidate(
        seed.startCandidates,
        usedTargets,
        attemptIndex,
        `${seed.connectionName}:start`,
      )
      const endCandidate = this.chooseBreakoutCandidate(
        seed.endCandidates,
        usedTargets,
        attemptIndex,
        `${seed.connectionName}:end`,
      )

      plans[seedIndex] = {
        connectionName: seed.connectionName,
        rootConnectionName: seed.rootConnectionName,
        startPoint: { ...seed.startPoint },
        endPoint: { ...seed.endPoint },
        breakoutStartPoint: { ...startCandidate.point },
        breakoutEndPoint: { ...endCandidate.point },
        breakoutStartConnectionName: startCandidate.needsBreakout
          ? this.getBreakoutConnectionName(seed.connectionName, "start")
          : undefined,
        breakoutEndConnectionName: endCandidate.needsBreakout
          ? this.getBreakoutConnectionName(seed.connectionName, "end")
          : undefined,
      }
    }

    return plans
  }

  private buildBreakoutCandidates(
    probeView: A05ProbeView,
    point: RoutePoint,
    sourceCellId: number,
    oppositePoint: RoutePoint,
    boundaryMiddleCells: Record<
      "left" | "top" | "right" | "bottom",
      number[]
    >,
    allMiddleCells: number[],
  ): BreakoutCandidate[] {
    const sourceRegion = probeView.regions[probeView.cellRegion[sourceCellId]!]!
    if (sourceRegion.name === "middle") {
      return [{ point: { ...point }, needsBreakout: false }]
    }

    const primaryCandidates = this.rankBoundaryCandidates(
      probeView,
      point,
      oppositePoint,
      boundaryMiddleCells[sourceRegion.name],
    )
    const seamCandidates =
      allMiddleCells.length <= 9
        ? this.rankBoundaryCandidates(
            probeView,
            point,
            oppositePoint,
            this.getInnerBoundaryCellIds(probeView, sourceRegion.name),
          )
        : []
    const fallbackCandidates = this.rankBoundaryCandidates(
      probeView,
      point,
      oppositePoint,
      allMiddleCells,
    )

    const orderedCellIds: number[] = []
    const seen = new Set<number>()
    for (const cellId of [
      ...primaryCandidates,
      ...seamCandidates,
      ...fallbackCandidates,
    ]) {
      if (seen.has(cellId)) continue
      seen.add(cellId)
      orderedCellIds.push(cellId)
      if (
        this.breakoutCandidateLimit > 0 &&
        orderedCellIds.length >= this.breakoutCandidateLimit
      ) {
        break
      }
    }

    if (orderedCellIds.length === 0) {
      return [{ point: { ...point }, needsBreakout: false }]
    }

    const availableZ = [
      point.z,
      ...((this.nodeWithPortPoints.availableZ ?? [])
        .filter((z) => z !== point.z)
        .sort((a, b) => a - b) ?? []),
    ]

    const candidates: BreakoutCandidate[] = []
    for (const cellId of orderedCellIds) {
      for (const z of availableZ) {
        candidates.push({
          point: {
            x: probeView.cellCenterX[cellId]!,
            y: probeView.cellCenterY[cellId]!,
            z,
          },
          needsBreakout: true,
          targetKey: z * probeView.planeSize + cellId,
        })
      }
    }

    return candidates
  }

  private rankBoundaryCandidates(
    probeView: A05ProbeView,
    point: RoutePoint,
    oppositePoint: RoutePoint,
    cellIds: number[],
  ) {
    return [...cellIds]
      .map((cellId) => ({
        cellId,
        score:
          Math.hypot(
            probeView.cellCenterX[cellId]! - point.x,
            probeView.cellCenterY[cellId]! - point.y,
          ) +
          Math.hypot(
            probeView.cellCenterX[cellId]! - oppositePoint.x,
            probeView.cellCenterY[cellId]! - oppositePoint.y,
          ) *
            0.35,
      }))
      .sort((a, b) => a.score - b.score)
      .map((entry) => entry.cellId)
  }

  private chooseBreakoutCandidate(
    candidates: BreakoutCandidate[],
    usedTargets: Set<number>,
    attemptIndex: number,
    saltText: string,
  ) {
    if (candidates.length === 0) {
      return {
        point: { x: 0, y: 0, z: 0 },
        needsBreakout: false,
      }
    }

    const salt = hashString(saltText)
    const order = buildRotatedIndexOrder(
      candidates.length,
      (attemptIndex + (salt % Math.max(1, candidates.length))) %
        Math.max(1, candidates.length),
      ((Math.floor(attemptIndex / Math.max(1, candidates.length)) + salt) & 1) ===
        1,
    )

    for (const index of order) {
      const candidate = candidates[index]!
      if (candidate.targetKey === undefined || !usedTargets.has(candidate.targetKey)) {
        if (candidate.targetKey !== undefined) {
          usedTargets.add(candidate.targetKey)
        }
        return candidate
      }
    }

    const fallback = candidates[order[0] ?? 0]!
    if (fallback.targetKey !== undefined) {
      usedTargets.add(fallback.targetKey)
    }
    return fallback
  }

  private getOrderedCandidatesForAttempt(
    candidates: BreakoutCandidate[],
    saltText: string,
  ) {
    if (candidates.length <= 1) return candidates
    const salt = hashString(saltText)
    const order = buildRotatedIndexOrder(
      candidates.length,
      (this.attemptIndex + (salt % Math.max(1, candidates.length))) %
        Math.max(1, candidates.length),
      ((Math.floor(this.attemptIndex / Math.max(1, candidates.length)) + salt) &
        1) === 1,
    )
    return order.map((index) => candidates[index]!)
  }

  private getAssignmentOrder(length: number, attemptIndex: number) {
    if (length <= 1) return [0]
    return buildRotatedIndexOrder(
      length,
      attemptIndex % length,
      Math.floor(attemptIndex / length) % 2 === 1,
    )
  }

  private getBoundaryMiddleCellIds(
    probeView: A05ProbeView,
    middleRegion:
      | {
          id: number
          name: "left" | "top" | "right" | "bottom" | "middle"
          rows: number
          cols: number
        }
      | undefined,
  ) {
    const boundaryBySide: Record<"left" | "top" | "right" | "bottom", number[]> =
      {
        left: [],
        top: [],
        right: [],
        bottom: [],
      }
    if (!middleRegion || middleRegion.rows === 0 || middleRegion.cols === 0) {
      return boundaryBySide
    }

    for (let cellId = 0; cellId < probeView.planeSize; cellId++) {
      if (probeView.cellRegion[cellId] !== middleRegion.id) continue
      const row = probeView.cellRow[cellId]!
      const col = probeView.cellCol[cellId]!
      if (col === 0) boundaryBySide.left.push(cellId)
      if (col === middleRegion.cols - 1) boundaryBySide.right.push(cellId)
      if (row === 0) boundaryBySide.top.push(cellId)
      if (row === middleRegion.rows - 1) boundaryBySide.bottom.push(cellId)
    }

    return boundaryBySide
  }

  private getInnerBoundaryCellIds(
    probeView: A05ProbeView,
    regionName: "left" | "top" | "right" | "bottom",
  ) {
    const region = probeView.regions.find((entry) => entry.name === regionName)
    if (!region || region.rows === 0 || region.cols === 0) return [] as number[]

    const cellIds: number[] = []
    for (let cellId = 0; cellId < probeView.planeSize; cellId++) {
      if (probeView.cellRegion[cellId] !== region.id) continue
      const row = probeView.cellRow[cellId]!
      const col = probeView.cellCol[cellId]!
      if (regionName === "left" && col === region.cols - 1) cellIds.push(cellId)
      if (regionName === "right" && col === 0) cellIds.push(cellId)
      if (regionName === "top" && row === region.rows - 1) cellIds.push(cellId)
      if (regionName === "bottom" && row === 0) cellIds.push(cellId)
    }
    return cellIds
  }

  private getAllMiddleCellIds(
    probeView: A05ProbeView,
    middleRegion:
      | {
          id: number
          name: "left" | "top" | "right" | "bottom" | "middle"
          rows: number
          cols: number
        }
      | undefined,
  ) {
    const cellIds: number[] = []
    if (!middleRegion || middleRegion.rows === 0 || middleRegion.cols === 0) {
      return cellIds
    }

    for (let cellId = 0; cellId < probeView.planeSize; cellId++) {
      if (probeView.cellRegion[cellId] === middleRegion.id) {
        cellIds.push(cellId)
      }
    }

    return cellIds
  }

  private buildBreakoutPhaseNode(): NodeWithPortPoints {
    const portPoints: PortPoint[] = []

    for (const plan of this.breakoutPlans) {
      if (plan.breakoutStartConnectionName) {
        portPoints.push({
          ...plan.startPoint,
          connectionName: plan.breakoutStartConnectionName,
          rootConnectionName: plan.rootConnectionName ?? plan.connectionName,
        })
      }

      if (plan.breakoutEndConnectionName) {
        portPoints.push({
          ...plan.endPoint,
          connectionName: plan.breakoutEndConnectionName,
          rootConnectionName: plan.rootConnectionName ?? plan.connectionName,
        })
      }
    }

    return {
      capacityMeshNodeId: `${this.nodeWithPortPoints.capacityMeshNodeId}__a06_breakout`,
      center: { ...this.nodeWithPortPoints.center },
      width: this.nodeWithPortPoints.width,
      height: this.nodeWithPortPoints.height,
      availableZ: this.nodeWithPortPoints.availableZ,
      portPoints,
    }
  }

  private buildBreakoutGoalMapForAttempt() {
    const goalMap: Record<string, BreakoutGoalPoint[]> = {}

    for (let planIndex = 0; planIndex < this.breakoutPlans.length; planIndex++) {
      const plan = this.breakoutPlans[planIndex]!
      const seed = this.breakoutSeeds[planIndex]!

      if (plan.breakoutStartConnectionName) {
        goalMap[plan.breakoutStartConnectionName] = this.getOrderedCandidatesForAttempt(
          seed.startCandidates,
          `${plan.connectionName}:start`,
        )
          .filter((candidate) => candidate.needsBreakout)
          .map((candidate) =>
            this.toBreakoutGoalPoint(candidate.point, plan.endPoint),
          )
      }

      if (plan.breakoutEndConnectionName) {
        goalMap[plan.breakoutEndConnectionName] = this.getOrderedCandidatesForAttempt(
          seed.endCandidates,
          `${plan.connectionName}:end`,
        )
          .filter((candidate) => candidate.needsBreakout)
          .map((candidate) =>
            this.toBreakoutGoalPoint(candidate.point, plan.startPoint),
          )
      }
    }

    return goalMap
  }

  private buildMainPhaseNode(): NodeWithPortPoints {
    const portPoints: PortPoint[] = []
    for (const plan of this.breakoutPlans) {
      if (plan.breakoutStartConnectionName) {
        portPoints.push({
          ...plan.startPoint,
          connectionName: plan.breakoutStartConnectionName,
          rootConnectionName: plan.rootConnectionName ?? plan.connectionName,
        })
        portPoints.push({
          ...plan.breakoutStartPoint,
          connectionName: plan.breakoutStartConnectionName,
          rootConnectionName: plan.rootConnectionName ?? plan.connectionName,
        })
      }

      portPoints.push({
        ...plan.breakoutStartPoint,
        connectionName: plan.connectionName,
        rootConnectionName: plan.rootConnectionName,
      })
      portPoints.push({
        ...plan.breakoutEndPoint,
        connectionName: plan.connectionName,
        rootConnectionName: plan.rootConnectionName,
      })

      if (plan.breakoutEndConnectionName) {
        portPoints.push({
          ...plan.breakoutEndPoint,
          connectionName: plan.breakoutEndConnectionName,
          rootConnectionName: plan.rootConnectionName ?? plan.connectionName,
        })
        portPoints.push({
          ...plan.endPoint,
          connectionName: plan.breakoutEndConnectionName,
          rootConnectionName: plan.rootConnectionName ?? plan.connectionName,
        })
      }
    }

    return {
      capacityMeshNodeId: `${this.nodeWithPortPoints.capacityMeshNodeId}__a06_main`,
      center: { ...this.nodeWithPortPoints.center },
      width: this.nodeWithPortPoints.width,
      height: this.nodeWithPortPoints.height,
      availableZ: this.nodeWithPortPoints.availableZ,
      portPoints,
    }
  }

  private stitchRoutes() {
    const routedMainSegments =
      this.mainRoutes.length > 0
        ? this.mainRoutes
        : this.mainSolver?.solved
          ? this.mainSolver.getOutput()
          : []
    if (routedMainSegments.length === 0) return []

    const breakoutRouteMap = new Map(
      this.breakoutRoutes.map((route) => [route.connectionName, route]),
    )
    for (const route of routedMainSegments) {
      if (!route.connectionName.includes("__a06_breakout_")) continue
      breakoutRouteMap.set(route.connectionName, route)
    }
    const trunkRouteMap = new Map(
      routedMainSegments
        .filter((route) => !route.connectionName.includes("__a06_breakout_"))
        .map((route) => [route.connectionName, route]),
    )

    const stitchedRoutes: HighDensityIntraNodeRoute[] = []

    for (const plan of this.breakoutPlans) {
      const trunkRoute = trunkRouteMap.get(plan.connectionName)
      if (!trunkRoute) continue

      const segmentRoutes: HighDensityIntraNodeRoute[] = [trunkRoute]
      if (plan.breakoutStartConnectionName) {
        const breakoutRoute = breakoutRouteMap.get(plan.breakoutStartConnectionName)
        if (!breakoutRoute) continue
        segmentRoutes.push(breakoutRoute)
      }
      if (plan.breakoutEndConnectionName) {
        const breakoutRoute = breakoutRouteMap.get(plan.breakoutEndConnectionName)
        if (!breakoutRoute) continue
        segmentRoutes.push(breakoutRoute)
      }

      const routePoints =
        this.buildPathFromSegmentUnion(
          segmentRoutes,
          plan.startPoint,
          plan.endPoint,
        ) ?? []
      if (routePoints.length === 0) continue

      stitchedRoutes.push({
        connectionName: plan.connectionName,
        rootConnectionName: plan.rootConnectionName,
        traceThickness: trunkRoute.traceThickness,
        viaDiameter: trunkRoute.viaDiameter,
        route: routePoints,
        vias: deriveViasFromRoutePoints(routePoints),
      })
    }

    return stitchedRoutes
  }

  private getBreakoutConnectionName(
    connectionName: string,
    side: BreakoutSide,
  ) {
    return `${connectionName}__a06_breakout_${side}`
  }

  private updateBreakoutPlanEndpointsFromRoutes(
    breakoutRoutes: HighDensityIntraNodeRoute[],
  ) {
    const breakoutRouteMap = new Map(
      breakoutRoutes.map((route) => [route.connectionName, route]),
    )

    for (const plan of this.breakoutPlans) {
      if (plan.breakoutStartConnectionName) {
        const route = breakoutRouteMap.get(plan.breakoutStartConnectionName)
        const endpoint = route?.route[route.route.length - 1]
        if (endpoint) {
          plan.breakoutStartPoint = { ...endpoint }
        }
      } else {
        plan.breakoutStartPoint = { ...plan.startPoint }
      }

      if (plan.breakoutEndConnectionName) {
        const route = breakoutRouteMap.get(plan.breakoutEndConnectionName)
        const endpoint = route?.route[route.route.length - 1]
        if (endpoint) {
          plan.breakoutEndPoint = { ...endpoint }
        }
      } else {
        plan.breakoutEndPoint = { ...plan.endPoint }
      }
    }
  }

  private buildPathFromSegmentUnion(
    segmentRoutes: HighDensityIntraNodeRoute[],
    startPoint: RoutePoint,
    endPoint: RoutePoint,
  ) {
    const pointByKey = new Map<string, RoutePoint>()
    const neighbors = new Map<string, Set<string>>()

    const addPoint = (point: RoutePoint) => {
      const key = routePointKey(point)
      if (!pointByKey.has(key)) {
        pointByKey.set(key, { ...point })
      }
      return key
    }

    const link = (a: RoutePoint, b: RoutePoint) => {
      const keyA = addPoint(a)
      const keyB = addPoint(b)
      if (!neighbors.has(keyA)) neighbors.set(keyA, new Set())
      if (!neighbors.has(keyB)) neighbors.set(keyB, new Set())
      neighbors.get(keyA)!.add(keyB)
      neighbors.get(keyB)!.add(keyA)
    }

    for (const route of segmentRoutes) {
      for (let index = 1; index < route.route.length; index++) {
        link(route.route[index - 1]!, route.route[index]!)
      }
    }

    const startKey = addPoint(startPoint)
    const endKey = addPoint(endPoint)
    if (startKey === endKey) return [{ ...startPoint }]

    const queue: string[] = [startKey]
    const previous = new Map<string, string | null>([[startKey, null]])

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === endKey) break
      for (const next of neighbors.get(current) ?? []) {
        if (previous.has(next)) continue
        previous.set(next, current)
        queue.push(next)
      }
    }

    if (!previous.has(endKey)) return null

    const pathKeys: string[] = []
    let current: string | null = endKey
    while (current) {
      pathKeys.push(current)
      current = previous.get(current) ?? null
    }
    pathKeys.reverse()

    return pathKeys.map((key, index) => {
      if (index === 0) return { ...startPoint }
      if (index === pathKeys.length - 1) return { ...endPoint }
      return { ...pointByKey.get(key)! }
    })
  }

  private trimBreakoutRoutesToCoarseAnchors(
    breakoutRoutes: HighDensityIntraNodeRoute[],
  ) {
    return breakoutRoutes.map((route) => {
      const anchorIndex = this.findFirstCoarsePointIndex(route.route)
      if (anchorIndex <= 0 || anchorIndex >= route.route.length - 1) {
        return route
      }

      const trimmedRoute = route.route
        .slice(0, anchorIndex + 1)
        .map((point) => ({ ...point }))
      return {
        ...route,
        route: trimmedRoute,
        vias: deriveViasFromRoutePoints(trimmedRoute),
      }
    })
  }

  private findFirstCoarsePointIndex(routePoints: RoutePoint[]) {
    const probe = this.routingProbe as any
    if (!probe) return routePoints.length - 1

    for (let index = 0; index < routePoints.length; index++) {
      const point = routePoints[index]!
      const cell = probe.pointToCell(point) as { z: number; cellId: number }
      const region = probe.regions[probe.cellRegion[cell.cellId]!]
      if (region?.name === "middle") {
        return index
      }
    }
    return routePoints.length - 1
  }

  private toBreakoutGoalPoint(
    point: RoutePoint,
    _oppositePoint: RoutePoint,
  ): BreakoutGoalPoint {
    return {
      ...point,
    }
  }
}

export { HighDensitySolverA06 as HighDensityA06Solver }
