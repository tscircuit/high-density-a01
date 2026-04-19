import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { NodeWithPortPoints } from "../types"
import {
  type A08BreakoutRoute,
  type A08BreakoutSolverOutput,
  type A08SpreadAssignment,
  type RectBounds,
  type Side,
  type SpreadAnchor,
  EPSILON,
  POINT_EPSILON,
  SIDE_ORDER,
  buildSpreadAnchors,
  clamp,
  getNodeBounds,
  getSortCoordinate,
  lerp,
  pickExactSideInsetRect,
  rectFromBounds,
  sortAnchorsForSide,
} from "./shared"

type CrossSection = {
  tangentMin: number
  tangentMax: number
  orthogonal: number
}

type BreakoutPoint = {
  x: number
  y: number
  z: number
}

type Vector2 = {
  x: number
  y: number
}

type BreakoutPathState = {
  anchor: SpreadAnchor
  midpoint: BreakoutPoint
  targetMidpoint: BreakoutPoint
  assignedPoint: BreakoutPoint
}

type SideState = {
  side: Side
  paths: BreakoutPathState[]
  solved: boolean
  idealSpacingSatisfied: boolean
  violationCount: number
  minSegmentDistance: number
  minBoundaryClearance: number
}

type SegmentDistanceResult = {
  distance: number
  aWeight: number
  bWeight: number
  pointA: { x: number; y: number }
  pointB: { x: number; y: number }
}

type ForceIterationMode = "hard" | "optimize"

type MidpointForceComputation = {
  beforeMidpoint: BreakoutPoint
  requestedMidpoint: BreakoutPoint
  targetMidpoint: BreakoutPoint
  clearancePressure: number
  repulsionForce: Vector2
  smoothingForce: Vector2
  attractionForce: Vector2
  totalForce: Vector2
  requestedDelta: Vector2
}

type MidpointForceSnapshot = {
  anchorKey: string
  side: Side
  connectionName: string
  rootConnectionName?: string
  z: number
  midpointBefore: BreakoutPoint
  midpointRequested: BreakoutPoint
  midpointAfter: BreakoutPoint
  targetMidpoint: BreakoutPoint
  repulsionForce: Vector2
  smoothingForce: Vector2
  attractionForce: Vector2
  totalForce: Vector2
  requestedDelta: Vector2
  appliedDelta: Vector2
}

type ForceIterationSnapshot = {
  side: Side
  mode: ForceIterationMode
  rectIteration: number
  snapshots: MidpointForceSnapshot[]
}

type ShrinkRectResult =
  | { ok: true; rect: RectBounds }
  | { ok: false; reason: "unchanged" | "collapsed" }

const BREAKOUT_SEGMENT_COUNT = 2
const BREAKOUT_MIDPOINT_INDEX = 1
const BREAKOUT_ENDPOINT_INDEX = 2
const BREAKOUT_MIDPOINT_INFLUENCE_FLOOR = 0.35
const LAYER_COLORS = ["red", "blue", "orange", "green"]
const TRACE_COLORS = [
  "rgba(255,0,0,0.85)",
  "rgba(0,0,255,0.85)",
  "rgba(255,165,0,0.85)",
  "rgba(0,128,0,0.85)",
]

export interface A08BreakoutSolverProps {
  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm?: number
  maxCellCount?: number
  traceMargin?: number
  traceThickness?: number
  effort?: number
  initialRectMarginMm?: number
  innerRectMarginMm?: number
  rectShrinkStepMm?: number
  breakoutTraceMarginMm?: number
  breakoutBoundaryMarginMm?: number
  breakoutSegmentCount?: number
  breakoutMaxIterationsPerRect?: number
  breakoutForceStepSize?: number
  breakoutRepulsionStrength?: number
  breakoutSmoothingStrength?: number
  breakoutAttractionStrength?: number
  innerPortSpreadFactor?: number
}

function dot(a: { x: number; y: number }, b: { x: number; y: number }) {
  return a.x * b.x + a.y * b.y
}

function sub(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: a.x - b.x, y: a.y - b.y }
}

function add(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(point: { x: number; y: number }, scalar: number) {
  return { x: point.x * scalar, y: point.y * scalar }
}

function length(vector: Vector2) {
  return Math.hypot(vector.x, vector.y)
}

function normalize(vector: Vector2) {
  const magnitude = length(vector)
  if (magnitude <= EPSILON) return { x: 0, y: 0 }
  return scale(vector, 1 / magnitude)
}

function clampMagnitude(vector: Vector2, maxMagnitude: number) {
  const magnitude = length(vector)
  if (magnitude <= maxMagnitude || magnitude <= EPSILON) return vector
  return scale(vector, maxMagnitude / magnitude)
}

function clamp01(value: number) {
  return clamp(value, 0, 1)
}

function segmentSegmentDistance(
  a0: { x: number; y: number },
  a1: { x: number; y: number },
  b0: { x: number; y: number },
  b1: { x: number; y: number },
): SegmentDistanceResult {
  const d1 = sub(a1, a0)
  const d2 = sub(b1, b0)
  const r = sub(a0, b0)
  const a = dot(d1, d1)
  const e = dot(d2, d2)
  const f = dot(d2, r)

  let aWeight = 0
  let bWeight = 0

  if (a <= EPSILON && e <= EPSILON) {
    return {
      distance: Math.hypot(a0.x - b0.x, a0.y - b0.y),
      aWeight,
      bWeight,
      pointA: a0,
      pointB: b0,
    }
  }

  if (a <= EPSILON) {
    bWeight = clamp01(f / Math.max(e, EPSILON))
  } else {
    const c = dot(d1, r)
    if (e <= EPSILON) {
      aWeight = clamp01(-c / Math.max(a, EPSILON))
    } else {
      const b = dot(d1, d2)
      const denom = a * e - b * b
      if (Math.abs(denom) > EPSILON) {
        aWeight = clamp01((b * f - c * e) / denom)
      }
      const tNom = b * aWeight + f
      if (tNom <= 0) {
        bWeight = 0
        aWeight = clamp01(-c / Math.max(a, EPSILON))
      } else if (tNom >= e) {
        bWeight = 1
        aWeight = clamp01((b - c) / Math.max(a, EPSILON))
      } else {
        bWeight = tNom / e
      }
    }
  }

  const pointA = add(a0, scale(d1, aWeight))
  const pointB = add(b0, scale(d2, bWeight))
  return {
    distance: Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y),
    aWeight,
    bWeight,
    pointA,
    pointB,
  }
}

function getTangentValue(side: Side, point: { x: number; y: number }) {
  return side === "left" || side === "right" ? point.y : point.x
}

function getAnchorNetName(anchor: SpreadAnchor) {
  return (
    anchor.representative.rootConnectionName ??
    anchor.representative.connectionName.replace(/_mst\d+$/, "")
  )
}

function getMidpointInfluence(segmentIndex: number, segmentWeight: number) {
  const rawInfluence = segmentIndex === 0 ? segmentWeight : 1 - segmentWeight
  return lerp(BREAKOUT_MIDPOINT_INFLUENCE_FLOOR, 1, rawInfluence)
}

function getOrthogonalUnitVector(side: Side) {
  return side === "left" || side === "right" ? { x: 1, y: 0 } : { x: 0, y: 1 }
}

function formatSigned(value: number) {
  return value >= 0 ? `+${value.toFixed(3)}` : value.toFixed(3)
}

function formatVector(vector: Vector2) {
  return `(${formatSigned(vector.x)},${formatSigned(vector.y)})`
}

function getOrthogonalValue(side: Side, point: { x: number; y: number }) {
  return side === "left" || side === "right" ? point.x : point.y
}

function pointFromCoordinates(
  side: Side,
  orthogonal: number,
  tangent: number,
  z: number,
): BreakoutPoint {
  return side === "left" || side === "right"
    ? { x: orthogonal, y: tangent, z }
    : { x: tangent, y: orthogonal, z }
}

function getSegmentAwayNormal(
  start: { x: number; y: number },
  end: { x: number; y: number },
  closestPointOnSegment: { x: number; y: number },
  otherClosestPoint: { x: number; y: number },
) {
  const segmentDirection = sub(end, start)
  const unitDirection = normalize(segmentDirection)
  if (length(unitDirection) <= EPSILON) return { x: 0, y: 0 }

  let normal = { x: -unitDirection.y, y: unitDirection.x }
  if (dot(normal, sub(otherClosestPoint, closestPointOnSegment)) > 0) {
    normal = scale(normal, -1)
  }
  return normal
}

function groupPathIndexesByLayer(sideState: SideState) {
  const groups = new Map<number, number[]>()
  for (let pathIndex = 0; pathIndex < sideState.paths.length; pathIndex++) {
    const z = sideState.paths[pathIndex]!.anchor.representative.z
    if (!groups.has(z)) {
      groups.set(z, [])
    }
    groups.get(z)!.push(pathIndex)
  }
  return [...groups.values()]
}

export class HighDensitySolverA08BreakoutSolver extends BaseSolver {
  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm: number
  maxCellCount?: number
  traceMargin: number
  traceThickness: number
  effort: number
  initialRectMarginMm: number
  rectShrinkStepMm: number
  breakoutTraceMarginMm: number
  breakoutBoundaryMarginMm: number
  breakoutSegmentCount: number
  breakoutMaxIterationsPerRect: number
  breakoutForceStepSize: number
  breakoutRepulsionStrength: number
  breakoutSmoothingStrength: number
  breakoutAttractionStrength: number
  innerPortSpreadFactor: number

  outerBounds!: RectBounds
  innerRect: RectBounds | null = null
  innerNodeWithPortPoints: NodeWithPortPoints | null = null
  spreadAssignments: A08SpreadAssignment[] = []
  breakoutRoutes: A08BreakoutRoute[] = []
  sideStates: SideState[] = []
  shrinkCount = 0
  iterationsAtCurrentRect = 0
  lastForceIteration: ForceIterationSnapshot | null = null

  private readonly constructorProps: A08BreakoutSolverProps
  private anchorsBySide = new Map<Side, SpreadAnchor[]>()
  private pendingShrinkSides: Side[] = []
  private nextForceSideCursor = 0

  constructor(props: A08BreakoutSolverProps) {
    super()
    this.constructorProps = props
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.cellSizeMm = props.cellSizeMm ?? 0.1
    this.maxCellCount = props.maxCellCount
    this.traceMargin = props.traceMargin ?? 0.15
    this.traceThickness = props.traceThickness ?? 0.1
    this.effort = props.effort ?? 1
    this.initialRectMarginMm =
      props.initialRectMarginMm ?? props.innerRectMarginMm ?? 0.2
    this.rectShrinkStepMm = props.rectShrinkStepMm ?? 0.4
    this.breakoutTraceMarginMm = props.breakoutTraceMarginMm ?? 0.1
    this.breakoutBoundaryMarginMm =
      props.breakoutBoundaryMarginMm ?? this.breakoutTraceMarginMm / 2
    this.breakoutSegmentCount = BREAKOUT_SEGMENT_COUNT
    this.breakoutMaxIterationsPerRect = Math.max(
      1,
      props.breakoutMaxIterationsPerRect ?? 60,
    )
    this.breakoutForceStepSize = props.breakoutForceStepSize ?? 0.2
    this.breakoutRepulsionStrength = props.breakoutRepulsionStrength ?? 1.8
    this.breakoutSmoothingStrength = props.breakoutSmoothingStrength ?? 0.16
    this.breakoutAttractionStrength = props.breakoutAttractionStrength ?? 0.06
    this.innerPortSpreadFactor = props.innerPortSpreadFactor ?? 0.4
    this.MAX_ITERATIONS = 100_000
  }

  override getConstructorParams(): [A08BreakoutSolverProps] {
    return [
      {
        ...this.constructorProps,
        nodeWithPortPoints: this.nodeWithPortPoints,
      },
    ]
  }

  override _setup(): void {
    this.outerBounds = getNodeBounds(this.nodeWithPortPoints)
    const anchors = buildSpreadAnchors(this.nodeWithPortPoints)
    this.anchorsBySide = new Map(
      SIDE_ORDER.map((side) => [side, sortAnchorsForSide(side, anchors)]),
    )
    this.pendingShrinkSides = []
    this.shrinkCount = 0
    this.iterationsAtCurrentRect = 0
    this.lastForceIteration = null
    this.nextForceSideCursor = 0
    this.spreadAssignments = []
    this.breakoutRoutes = []
    this.innerNodeWithPortPoints = null
    this.sideStates = []

    const initialRect = pickExactSideInsetRect(
      this.nodeWithPortPoints,
      this.initialRectMarginMm,
    )
    if (!initialRect) {
      this.error = "A08_BreakoutSolver could not build the initial inset rect"
      this.failed = true
      return
    }

    this.reinitializeForInnerRect(initialRect)
  }

  override _step(): void {
    if (!this.innerRect) {
      this.error = "A08_BreakoutSolver missing inner rect"
      this.failed = true
      return
    }

    if (this.pendingShrinkSides.length > 0) {
      this.lastForceIteration = null
      this.applyPendingShrink()
      return
    }

    const nextSideIteration = this.pickNextSideStateForForceIteration()
    if (!nextSideIteration) {
      if (this.shouldShrinkForMaxCellCount()) {
        this.pendingShrinkSides = [...SIDE_ORDER]
        return
      }
      this.solved = true
      return
    }

    const computations = this.runSideForceIteration(nextSideIteration.sideState)
    this.enforceSideStateConstraints(nextSideIteration.sideState)

    this.iterationsAtCurrentRect += 1
    this.lastForceIteration = this.captureForceIterationSnapshot(
      nextSideIteration.sideState,
      nextSideIteration.mode,
      computations,
      this.iterationsAtCurrentRect,
    )
    this.refreshDerivedState()

    const nextHardUnsolvedSides = this.getHardUnsolvedSideStates()
    const nextOptimizationPendingSides = this.getOptimizationPendingSideStates()

    if (
      nextHardUnsolvedSides.length === 0 &&
      nextOptimizationPendingSides.length === 0
    ) {
      if (this.shouldShrinkForMaxCellCount()) {
        this.pendingShrinkSides = [...SIDE_ORDER]
        return
      }
      this.solved = true
      return
    }

    if (this.iterationsAtCurrentRect >= this.breakoutMaxIterationsPerRect) {
      if (nextHardUnsolvedSides.length > 0) {
        this.pendingShrinkSides = nextHardUnsolvedSides.map(
          (sideState) => sideState.side,
        )
        return
      }

      if (this.shouldShrinkForMaxCellCount()) {
        this.pendingShrinkSides = [...SIDE_ORDER]
        return
      }

      this.solved = true
    }
  }

  override getOutput(): A08BreakoutSolverOutput | null {
    if (!this.solved || !this.innerRect || !this.innerNodeWithPortPoints) {
      return null
    }
    return {
      innerRect: this.innerRect,
      innerNodeWithPortPoints: this.innerNodeWithPortPoints,
      assignments: this.spreadAssignments,
      breakoutRoutes: this.breakoutRoutes,
    }
  }

  private reinitializeForInnerRect(innerRect: RectBounds) {
    this.innerRect = innerRect
    this.lastForceIteration = null
    this.nextForceSideCursor = 0
    this.sideStates = SIDE_ORDER.map((side) => ({
      side,
      paths: this.createPathStatesForSide(side),
      solved: false,
      idealSpacingSatisfied: false,
      violationCount: 0,
      minSegmentDistance: Infinity,
      minBoundaryClearance: Infinity,
    }))
    this.iterationsAtCurrentRect = 0
    this.refreshDerivedState()
  }

  private getHardUnsolvedSideStates() {
    return this.sideStates.filter(
      (sideState) => sideState.paths.length > 0 && !sideState.solved,
    )
  }

  private getOptimizationPendingSideStates() {
    return this.sideStates.filter(
      (sideState) =>
        sideState.paths.length > 1 &&
        sideState.solved &&
        !sideState.idealSpacingSatisfied,
    )
  }

  private pickNextSideStateForForceIteration(): {
    sideState: SideState
    mode: ForceIterationMode
  } | null {
    const hardUnsolvedSides = this.getHardUnsolvedSideStates().filter(
      (sideState) => sideState.paths.length > 1,
    )
    if (hardUnsolvedSides.length > 0) {
      const index = this.nextForceSideCursor % hardUnsolvedSides.length
      this.nextForceSideCursor =
        (this.nextForceSideCursor + 1) % hardUnsolvedSides.length
      return {
        sideState: hardUnsolvedSides[index]!,
        mode: "hard",
      }
    }

    const optimizationPendingSides = this.getOptimizationPendingSideStates()
    if (optimizationPendingSides.length === 0) return null

    const index = this.nextForceSideCursor % optimizationPendingSides.length
    this.nextForceSideCursor =
      (this.nextForceSideCursor + 1) % optimizationPendingSides.length
    return {
      sideState: optimizationPendingSides[index]!,
      mode: "optimize",
    }
  }

  private getSideOrthogonalEndpoints(side: Side) {
    if (!this.innerRect) {
      throw new Error("A08_BreakoutSolver missing inner rect")
    }

    switch (side) {
      case "top":
        return { outer: this.outerBounds.maxY, inner: this.innerRect.maxY }
      case "bottom":
        return { outer: this.outerBounds.minY, inner: this.innerRect.minY }
      case "left":
        return { outer: this.outerBounds.minX, inner: this.innerRect.minX }
      case "right":
        return { outer: this.outerBounds.maxX, inner: this.innerRect.maxX }
    }
  }

  private getSideUFromPoint(side: Side, point: { x: number; y: number }) {
    const { outer, inner } = this.getSideOrthogonalEndpoints(side)
    const denominator = inner - outer
    if (Math.abs(denominator) <= EPSILON) return 1
    return clamp((getOrthogonalValue(side, point) - outer) / denominator, 0, 1)
  }

  private clampPointToSidePolygon(
    side: Side,
    point: { x: number; y: number },
    z: number,
  ) {
    const { outer, inner } = this.getSideOrthogonalEndpoints(side)
    let orthogonalMin = Math.min(outer, inner) + this.breakoutBoundaryMarginMm
    let orthogonalMax = Math.max(outer, inner) - this.breakoutBoundaryMarginMm

    if (orthogonalMax < orthogonalMin) {
      const midpoint = (outer + inner) / 2
      orthogonalMin = midpoint
      orthogonalMax = midpoint
    }

    const orthogonal = clamp(
      getOrthogonalValue(side, point),
      orthogonalMin,
      orthogonalMax,
    )
    const u = this.getSideUFromPoint(
      side,
      pointFromCoordinates(side, orthogonal, getTangentValue(side, point), z),
    )
    const crossSection = this.getCrossSection(side, u)
    let tangentMin = crossSection.tangentMin + this.breakoutBoundaryMarginMm
    let tangentMax = crossSection.tangentMax - this.breakoutBoundaryMarginMm

    if (tangentMax < tangentMin) {
      const midpoint = (crossSection.tangentMin + crossSection.tangentMax) / 2
      tangentMin = midpoint
      tangentMax = midpoint
    }

    return pointFromCoordinates(
      side,
      orthogonal,
      clamp(getTangentValue(side, point), tangentMin, tangentMax),
      z,
    )
  }

  private withPointTangent(side: Side, point: BreakoutPoint, tangent: number) {
    return pointFromCoordinates(
      side,
      getOrthogonalValue(side, point),
      tangent,
      point.z,
    )
  }

  private getBoundaryClearance(side: Side, point: BreakoutPoint) {
    const u = this.getSideUFromPoint(side, point)
    const crossSection = this.getCrossSection(side, u)
    const tangent = getTangentValue(side, point)
    const tangentClearance = Math.min(
      tangent - crossSection.tangentMin,
      crossSection.tangentMax - tangent,
    )
    const { outer, inner } = this.getSideOrthogonalEndpoints(side)
    const orthogonal = getOrthogonalValue(side, point)
    const orthogonalClearance = Math.min(
      Math.abs(orthogonal - outer),
      Math.abs(inner - orthogonal),
    )
    return Math.min(tangentClearance, orthogonalClearance)
  }

  private createPathStatesForSide(side: Side) {
    const anchors = this.anchorsBySide.get(side) ?? []
    if (anchors.length === 0) return []

    const innerRange = this.getCrossSection(side, 1)
    let availableMin = innerRange.tangentMin + this.breakoutBoundaryMarginMm
    let availableMax = innerRange.tangentMax - this.breakoutBoundaryMarginMm

    if (availableMax < availableMin) {
      const midpoint = (innerRange.tangentMin + innerRange.tangentMax) / 2
      availableMin = midpoint
      availableMax = midpoint
    }

    const targetInnerTangentByAnchorKey = new Map<string, number>()
    const anchorsByLayer = new Map<number, SpreadAnchor[]>()

    for (const anchor of anchors) {
      const z = anchor.representative.z
      if (!anchorsByLayer.has(z)) {
        anchorsByLayer.set(z, [])
      }
      anchorsByLayer.get(z)!.push(anchor)
    }

    for (const layerAnchors of anchorsByLayer.values()) {
      for (
        let layerAnchorIndex = 0;
        layerAnchorIndex < layerAnchors.length;
        layerAnchorIndex++
      ) {
        const anchor = layerAnchors[layerAnchorIndex]!
        const outerTangent = getSortCoordinate(side, anchor.representative)
        const clampedOuterTangent = clamp(
          outerTangent,
          availableMin,
          availableMax,
        )
        const fullySpreadInnerTangent =
          layerAnchors.length === 1
            ? clampedOuterTangent
            : clamp(
                lerp(
                  availableMin,
                  availableMax,
                  (layerAnchorIndex + 1) / (layerAnchors.length + 1),
                ),
                availableMin,
                availableMax,
              )
        targetInnerTangentByAnchorKey.set(
          anchor.key,
          lerp(
            clampedOuterTangent,
            fullySpreadInnerTangent,
            this.innerPortSpreadFactor,
          ),
        )
      }
    }

    return anchors.map((anchor) => {
      const outerTangent = getSortCoordinate(side, anchor.representative)
      const targetInnerTangent =
        targetInnerTangentByAnchorKey.get(anchor.key) ?? outerTangent
      const assignedPoint = this.pointFromTangent(
        side,
        1,
        targetInnerTangent,
        anchor.representative.z,
      )
      const targetMidpoint = {
        x: (anchor.representative.x + assignedPoint.x) / 2,
        y: (anchor.representative.y + assignedPoint.y) / 2,
        z: anchor.representative.z,
      }

      return {
        anchor,
        midpoint: { ...targetMidpoint },
        targetMidpoint,
        assignedPoint,
      }
    })
  }

  private getCrossSection(side: Side, u: number): CrossSection {
    if (!this.innerRect) {
      throw new Error("A08_BreakoutSolver missing inner rect")
    }

    switch (side) {
      case "top":
        return {
          tangentMin: lerp(this.outerBounds.minX, this.innerRect.minX, u),
          tangentMax: lerp(this.outerBounds.maxX, this.innerRect.maxX, u),
          orthogonal: lerp(this.outerBounds.maxY, this.innerRect.maxY, u),
        }
      case "bottom":
        return {
          tangentMin: lerp(this.outerBounds.minX, this.innerRect.minX, u),
          tangentMax: lerp(this.outerBounds.maxX, this.innerRect.maxX, u),
          orthogonal: lerp(this.outerBounds.minY, this.innerRect.minY, u),
        }
      case "left":
        return {
          tangentMin: lerp(this.outerBounds.minY, this.innerRect.minY, u),
          tangentMax: lerp(this.outerBounds.maxY, this.innerRect.maxY, u),
          orthogonal: lerp(this.outerBounds.minX, this.innerRect.minX, u),
        }
      case "right":
        return {
          tangentMin: lerp(this.outerBounds.minY, this.innerRect.minY, u),
          tangentMax: lerp(this.outerBounds.maxY, this.innerRect.maxY, u),
          orthogonal: lerp(this.outerBounds.maxX, this.innerRect.maxX, u),
        }
    }
  }

  private pointFromTangent(
    side: Side,
    u: number,
    tangent: number,
    z: number,
  ): BreakoutPoint {
    const crossSection = this.getCrossSection(side, u)
    if (side === "left" || side === "right") {
      return {
        x: crossSection.orthogonal,
        y: tangent,
        z,
      }
    }
    return {
      x: tangent,
      y: crossSection.orthogonal,
      z,
    }
  }

  private getPathPoints(pathState: BreakoutPathState): BreakoutPoint[] {
    return [
      {
        x: pathState.anchor.representative.x,
        y: pathState.anchor.representative.y,
        z: pathState.anchor.representative.z,
      },
      pathState.midpoint,
      pathState.assignedPoint,
    ]
  }

  private runSideForceIteration(sideState: SideState) {
    const computations = sideState.paths.map<MidpointForceComputation>(
      (pathState) => ({
        beforeMidpoint: { ...pathState.midpoint },
        requestedMidpoint: { ...pathState.midpoint },
        targetMidpoint: { ...pathState.targetMidpoint },
        clearancePressure: 0,
        repulsionForce: { x: 0, y: 0 },
        smoothingForce: { x: 0, y: 0 },
        attractionForce: { x: 0, y: 0 },
        totalForce: { x: 0, y: 0 },
        requestedDelta: { x: 0, y: 0 },
      }),
    )
    const pointLists = sideState.paths.map((pathState) =>
      this.getPathPoints(pathState),
    )
    const idealTraceSpacing = this.getRequiredTraceSpacing()

    for (const pathIndexes of groupPathIndexesByLayer(sideState)) {
      for (
        let groupIndexA = 0;
        groupIndexA < pathIndexes.length - 1;
        groupIndexA++
      ) {
        const pathIndexA = pathIndexes[groupIndexA]!
        const pathStateA = sideState.paths[pathIndexA]!
        const pointListA = pointLists[pathIndexA]!

        for (
          let groupIndexB = groupIndexA + 1;
          groupIndexB < pathIndexes.length;
          groupIndexB++
        ) {
          const pathIndexB = pathIndexes[groupIndexB]!
          const pathStateB = sideState.paths[pathIndexB]!

          if (
            getAnchorNetName(pathStateA.anchor) ===
            getAnchorNetName(pathStateB.anchor)
          ) {
            continue
          }

          const pointListB = pointLists[pathIndexB]!

          for (
            let segmentIndexA = 0;
            segmentIndexA < this.breakoutSegmentCount;
            segmentIndexA++
          ) {
            for (
              let segmentIndexB = 0;
              segmentIndexB < this.breakoutSegmentCount;
              segmentIndexB++
            ) {
              const distance = segmentSegmentDistance(
                pointListA[segmentIndexA]!,
                pointListA[segmentIndexA + 1]!,
                pointListB[segmentIndexB]!,
                pointListB[segmentIndexB + 1]!,
              )

              if (distance.distance + EPSILON >= idealTraceSpacing) continue

              const shortfall =
                idealTraceSpacing - Math.max(distance.distance, POINT_EPSILON)
              const strength = shortfall * this.breakoutRepulsionStrength
              const midpointInfluenceA = getMidpointInfluence(
                segmentIndexA,
                distance.aWeight,
              )
              const midpointInfluenceB = getMidpointInfluence(
                segmentIndexB,
                distance.bWeight,
              )
              const awayNormalA = getSegmentAwayNormal(
                pointListA[segmentIndexA]!,
                pointListA[segmentIndexA + 1]!,
                distance.pointA,
                distance.pointB,
              )
              const awayNormalB = getSegmentAwayNormal(
                pointListB[segmentIndexB]!,
                pointListB[segmentIndexB + 1]!,
                distance.pointB,
                distance.pointA,
              )

              computations[pathIndexA]!.repulsionForce = add(
                computations[pathIndexA]!.repulsionForce,
                scale(awayNormalA, strength * midpointInfluenceA),
              )
              computations[pathIndexA]!.clearancePressure +=
                shortfall * midpointInfluenceA
              computations[pathIndexB]!.repulsionForce = add(
                computations[pathIndexB]!.repulsionForce,
                scale(awayNormalB, strength * midpointInfluenceB),
              )
              computations[pathIndexB]!.clearancePressure +=
                shortfall * midpointInfluenceB
            }
          }
        }
      }
    }

    for (let pathIndex = 0; pathIndex < sideState.paths.length; pathIndex++) {
      const pathState = sideState.paths[pathIndex]!
      const computation = computations[pathIndex]!
      const startPoint = pointLists[pathIndex]![0]!
      const endPoint = pointLists[pathIndex]![BREAKOUT_ENDPOINT_INDEX]!
      const stabilizationScale =
        computation.clearancePressure > POINT_EPSILON ? 0.2 : 1

      computation.smoothingForce = scale(
        sub(
          {
            x: (startPoint.x + endPoint.x) / 2,
            y: (startPoint.y + endPoint.y) / 2,
          },
          computation.beforeMidpoint,
        ),
        this.breakoutSmoothingStrength * stabilizationScale,
      )
      computation.attractionForce = scale(
        sub(computation.targetMidpoint, computation.beforeMidpoint),
        this.breakoutAttractionStrength * stabilizationScale,
      )
      computation.totalForce = add(
        add(computation.repulsionForce, computation.smoothingForce),
        computation.attractionForce,
      )
      computation.requestedDelta = clampMagnitude(
        scale(computation.totalForce, this.breakoutForceStepSize),
        this.rectShrinkStepMm,
      )
      computation.requestedMidpoint = {
        x: computation.beforeMidpoint.x + computation.requestedDelta.x,
        y: computation.beforeMidpoint.y + computation.requestedDelta.y,
        z: computation.beforeMidpoint.z,
      }
      pathState.midpoint = { ...computation.requestedMidpoint }
    }

    return computations
  }

  private captureForceIterationSnapshot(
    sideState: SideState,
    mode: ForceIterationMode,
    computations: MidpointForceComputation[],
    rectIteration: number,
  ): ForceIterationSnapshot {
    return {
      side: sideState.side,
      mode,
      rectIteration,
      snapshots: sideState.paths.map((pathState, pathIndex) => {
        const computation = computations[pathIndex]!
        const z = pathState.anchor.representative.z
        return {
          anchorKey: pathState.anchor.key,
          side: sideState.side,
          connectionName: pathState.anchor.representative.connectionName,
          rootConnectionName:
            pathState.anchor.representative.rootConnectionName,
          z,
          midpointBefore: { ...computation.beforeMidpoint },
          midpointRequested: { ...computation.requestedMidpoint },
          midpointAfter: { ...pathState.midpoint },
          targetMidpoint: { ...computation.targetMidpoint },
          repulsionForce: computation.repulsionForce,
          smoothingForce: computation.smoothingForce,
          attractionForce: computation.attractionForce,
          totalForce: computation.totalForce,
          requestedDelta: { ...computation.requestedDelta },
          appliedDelta: sub(pathState.midpoint, computation.beforeMidpoint),
        }
      }),
    }
  }

  private enforceSideStateConstraints(sideState: SideState) {
    const pathCount = sideState.paths.length

    for (const pathState of sideState.paths) {
      pathState.midpoint = this.clampPointToSidePolygon(
        sideState.side,
        pathState.midpoint,
        pathState.midpoint.z,
      )
    }

    if (pathCount <= 1) return

    for (const pathIndexes of groupPathIndexesByLayer(sideState)) {
      if (pathIndexes.length <= 1) continue
      const gap = POINT_EPSILON

      for (let groupIndex = 1; groupIndex < pathIndexes.length; groupIndex++) {
        const previousIndex = pathIndexes[groupIndex - 1]!
        const currentIndex = pathIndexes[groupIndex]!
        const previous = getTangentValue(
          sideState.side,
          sideState.paths[previousIndex]!.midpoint,
        )
        const current = getTangentValue(
          sideState.side,
          sideState.paths[currentIndex]!.midpoint,
        )
        if (current < previous + gap) {
          sideState.paths[currentIndex]!.midpoint =
            this.clampPointToSidePolygon(
              sideState.side,
              this.withPointTangent(
                sideState.side,
                sideState.paths[currentIndex]!.midpoint,
                previous + gap,
              ),
              sideState.paths[currentIndex]!.midpoint.z,
            )
        }
      }

      for (
        let groupIndex = pathIndexes.length - 2;
        groupIndex >= 0;
        groupIndex--
      ) {
        const currentIndex = pathIndexes[groupIndex]!
        const nextIndex = pathIndexes[groupIndex + 1]!
        const next = getTangentValue(
          sideState.side,
          sideState.paths[nextIndex]!.midpoint,
        )
        const current = getTangentValue(
          sideState.side,
          sideState.paths[currentIndex]!.midpoint,
        )
        if (current > next - gap) {
          sideState.paths[currentIndex]!.midpoint =
            this.clampPointToSidePolygon(
              sideState.side,
              this.withPointTangent(
                sideState.side,
                sideState.paths[currentIndex]!.midpoint,
                next - gap,
              ),
              sideState.paths[currentIndex]!.midpoint.z,
            )
        }
      }
    }

    for (const pathState of sideState.paths) {
      pathState.midpoint = this.clampPointToSidePolygon(
        sideState.side,
        pathState.midpoint,
        pathState.midpoint.z,
      )
    }
  }

  private evaluateSideState(sideState: SideState) {
    const idealTraceSpacing = this.getRequiredTraceSpacing()

    if (sideState.paths.length <= 1) {
      sideState.solved = true
      sideState.idealSpacingSatisfied = true
      sideState.violationCount = 0
      sideState.minSegmentDistance = Infinity
      sideState.minBoundaryClearance = Infinity
      return
    }

    const pointLists = sideState.paths.map((pathState) =>
      this.getPathPoints(pathState),
    )
    let minSegmentDistance = Infinity
    let minBoundaryClearance = Infinity
    let violationCount = 0

    for (const pathIndexes of groupPathIndexesByLayer(sideState)) {
      for (
        let groupIndexA = 0;
        groupIndexA < pathIndexes.length - 1;
        groupIndexA++
      ) {
        const pathIndexA = pathIndexes[groupIndexA]!
        const pathStateA = sideState.paths[pathIndexA]!
        const pointListA = pointLists[pathIndexA]!

        for (
          let groupIndexB = groupIndexA + 1;
          groupIndexB < pathIndexes.length;
          groupIndexB++
        ) {
          const pathIndexB = pathIndexes[groupIndexB]!
          const pathStateB = sideState.paths[pathIndexB]!

          if (
            getAnchorNetName(pathStateA.anchor) ===
            getAnchorNetName(pathStateB.anchor)
          ) {
            continue
          }

          const pointListB = pointLists[pathIndexB]!
          for (
            let segmentIndexA = 0;
            segmentIndexA < this.breakoutSegmentCount;
            segmentIndexA++
          ) {
            for (
              let segmentIndexB = 0;
              segmentIndexB < this.breakoutSegmentCount;
              segmentIndexB++
            ) {
              const distance = segmentSegmentDistance(
                pointListA[segmentIndexA]!,
                pointListA[segmentIndexA + 1]!,
                pointListB[segmentIndexB]!,
                pointListB[segmentIndexB + 1]!,
              ).distance
              minSegmentDistance = Math.min(minSegmentDistance, distance)
              if (distance + EPSILON < idealTraceSpacing) {
                violationCount += 1
              }
            }
          }
        }
      }
    }

    for (const pathState of sideState.paths) {
      const boundaryClearance = this.getBoundaryClearance(
        sideState.side,
        pathState.midpoint,
      )
      minBoundaryClearance = Math.min(minBoundaryClearance, boundaryClearance)
      if (boundaryClearance + EPSILON < this.breakoutBoundaryMarginMm) {
        violationCount += 1
      }
    }

    sideState.solved = violationCount === 0
    sideState.idealSpacingSatisfied =
      !Number.isFinite(minSegmentDistance) ||
      minSegmentDistance + EPSILON >= idealTraceSpacing
    sideState.violationCount = violationCount
    sideState.minSegmentDistance = minSegmentDistance
    sideState.minBoundaryClearance = minBoundaryClearance
  }

  private refreshDerivedState() {
    for (const sideState of this.sideStates) {
      this.evaluateSideState(sideState)
    }

    this.breakoutRoutes = this.buildBreakoutRoutes()
    this.spreadAssignments = this.breakoutRoutes.map((route) => ({
      anchorKey: route.anchorKey,
      side: route.side,
      original: route.original,
      assigned: route.assigned,
    }))
    this.innerNodeWithPortPoints = this.buildInnerNodeWithPortPoints()

    const populatedSideStates = this.sideStates.filter(
      (sideState) => sideState.paths.length > 0,
    )
    const completedSideCount = populatedSideStates.filter(
      (sideState) => sideState.solved && sideState.idealSpacingSatisfied,
    ).length

    this.progress =
      populatedSideStates.length === 0
        ? 1
        : completedSideCount / populatedSideStates.length
    this.stats = {
      shrinkCount: this.shrinkCount,
      iterationsAtCurrentRect: this.iterationsAtCurrentRect,
      innerRect: this.innerRect,
      unsolvedSides: this.getHardUnsolvedSideStates().map(
        (sideState) => sideState.side,
      ),
      optimizationSides: this.getOptimizationPendingSideStates().map(
        (sideState) => sideState.side,
      ),
      completedSides: populatedSideStates
        .filter(
          (sideState) => sideState.solved && sideState.idealSpacingSatisfied,
        )
        .map((sideState) => sideState.side),
      lastForceSide: this.lastForceIteration?.side ?? null,
      lastForceMode: this.lastForceIteration?.mode ?? null,
      lastForceRectIteration: this.lastForceIteration?.rectIteration ?? null,
      lastForceMovedPaths:
        this.lastForceIteration?.snapshots.filter(
          (snapshot) => length(snapshot.appliedDelta) > POINT_EPSILON,
        ).length ?? 0,
      sides: Object.fromEntries(
        this.sideStates.map((sideState) => [
          sideState.side,
          {
            solved: sideState.solved,
            idealSpacingSatisfied: sideState.idealSpacingSatisfied,
            paths: sideState.paths.length,
            violationCount: sideState.violationCount,
            minSegmentDistance: Number.isFinite(sideState.minSegmentDistance)
              ? Number(sideState.minSegmentDistance.toFixed(4))
              : null,
            minBoundaryClearance: Number.isFinite(
              sideState.minBoundaryClearance,
            )
              ? Number(sideState.minBoundaryClearance.toFixed(4))
              : null,
          },
        ]),
      ),
    }
  }

  private buildBreakoutRoutes() {
    const routes: A08BreakoutRoute[] = []
    for (const sideState of this.sideStates) {
      for (const pathState of sideState.paths) {
        const route = this.getPathPoints(pathState)
        const assigned = route[route.length - 1]!
        routes.push({
          anchorKey: pathState.anchor.key,
          side: sideState.side,
          connectionName: pathState.anchor.representative.connectionName,
          rootConnectionName:
            pathState.anchor.representative.rootConnectionName,
          original: {
            x: pathState.anchor.representative.x,
            y: pathState.anchor.representative.y,
            z: pathState.anchor.representative.z,
          },
          assigned,
          route,
        })
      }
    }
    return routes
  }

  private buildInnerNodeWithPortPoints() {
    if (!this.innerRect) return null

    const assignedByAnchorKey = new Map(
      this.breakoutRoutes.map((route) => [route.anchorKey, route.assigned]),
    )

    return {
      capacityMeshNodeId: this.nodeWithPortPoints.capacityMeshNodeId,
      center: this.innerRect.center,
      width: this.innerRect.width,
      height: this.innerRect.height,
      availableZ: this.nodeWithPortPoints.availableZ,
      portPoints: this.nodeWithPortPoints.portPoints.map((portPoint) => {
        const assigned = assignedByAnchorKey.get(
          portPoint.portPointId ??
            `${portPoint.z}:${portPoint.x.toFixed(6)}:${portPoint.y.toFixed(6)}`,
        )
        if (!assigned) return portPoint
        return {
          ...portPoint,
          x: assigned.x,
          y: assigned.y,
        }
      }),
    }
  }

  private getInnerLayerCount() {
    return (
      this.nodeWithPortPoints.availableZ?.length ??
      new Set(
        this.nodeWithPortPoints.portPoints.map((portPoint) => portPoint.z),
      ).size
    )
  }

  private getCellCountForInnerRect(rect: Pick<RectBounds, "width" | "height">) {
    const rows = Math.floor(rect.height / this.cellSizeMm)
    const cols = Math.floor(rect.width / this.cellSizeMm)
    return this.getInnerLayerCount() * rows * cols
  }

  private getRequiredTraceSpacing() {
    return Math.max(
      this.breakoutTraceMarginMm * 2,
      this.traceThickness + this.traceMargin,
    )
  }

  private shouldShrinkForMaxCellCount() {
    return (
      this.maxCellCount !== undefined &&
      this.innerRect !== null &&
      this.getCellCountForInnerRect(this.innerRect) > this.maxCellCount
    )
  }

  private shrinkRectBySides(
    innerRect: RectBounds,
    sides: Side[],
  ): ShrinkRectResult {
    const minDimension = Math.max(
      this.cellSizeMm,
      this.breakoutBoundaryMarginMm * 2,
    )
    const nextBounds = {
      minX: innerRect.minX,
      maxX: innerRect.maxX,
      minY: innerRect.minY,
      maxY: innerRect.maxY,
    }
    let changed = false

    for (const side of sides) {
      switch (side) {
        case "left":
          if (
            nextBounds.maxX - (nextBounds.minX + this.rectShrinkStepMm) >
            minDimension
          ) {
            nextBounds.minX += this.rectShrinkStepMm
            changed = true
          }
          break
        case "right":
          if (
            nextBounds.maxX - this.rectShrinkStepMm - nextBounds.minX >
            minDimension
          ) {
            nextBounds.maxX -= this.rectShrinkStepMm
            changed = true
          }
          break
        case "bottom":
          if (
            nextBounds.maxY - (nextBounds.minY + this.rectShrinkStepMm) >
            minDimension
          ) {
            nextBounds.minY += this.rectShrinkStepMm
            changed = true
          }
          break
        case "top":
          if (
            nextBounds.maxY - this.rectShrinkStepMm - nextBounds.minY >
            minDimension
          ) {
            nextBounds.maxY -= this.rectShrinkStepMm
            changed = true
          }
          break
      }
    }

    if (!changed) {
      return { ok: false, reason: "unchanged" }
    }

    const nextRect = rectFromBounds(nextBounds)
    if (
      nextRect.width <= Math.max(minDimension, EPSILON) ||
      nextRect.height <= Math.max(minDimension, EPSILON)
    ) {
      return { ok: false, reason: "collapsed" }
    }

    return { ok: true, rect: nextRect }
  }

  private applyPendingShrink() {
    if (!this.innerRect) {
      this.error = "A08_BreakoutSolver missing rect before shrink"
      this.failed = true
      return false
    }

    const shrinkResult = this.shrinkRectBySides(
      this.innerRect,
      this.pendingShrinkSides,
    )
    this.pendingShrinkSides = []

    if (!shrinkResult.ok) {
      this.error =
        shrinkResult.reason === "collapsed"
          ? "A08_BreakoutSolver inner rect collapsed during shrink"
          : "A08_BreakoutSolver could not shrink the inner rect any further"
      this.failed = true
      return false
    }

    this.shrinkCount += 1
    this.reinitializeForInnerRect(shrinkResult.rect)
    return true
  }

  override visualize(): GraphicsObject {
    const rects = [
      {
        center: this.nodeWithPortPoints.center,
        width: this.nodeWithPortPoints.width,
        height: this.nodeWithPortPoints.height,
        stroke: "gray",
      },
    ]

    if (this.innerRect) {
      rects.push({
        center: this.innerRect.center,
        width: this.innerRect.width,
        height: this.innerRect.height,
        stroke: "green",
      })
    }

    const points: NonNullable<GraphicsObject["points"]> =
      this.nodeWithPortPoints.portPoints.map((portPoint) => ({
        x: portPoint.x,
        y: portPoint.y,
        color: "black",
        label: portPoint.connectionName,
      }))
    for (const route of this.breakoutRoutes) {
      const z = route.route[0]?.z ?? route.assigned.z ?? 0
      points.push({
        x: route.assigned.x,
        y: route.assigned.y,
        color: LAYER_COLORS[z] ?? "black",
      })
    }

    const lines: NonNullable<GraphicsObject["lines"]> = this.breakoutRoutes.map(
      (route) => {
        const z = route.route[0]?.z ?? route.assigned.z ?? 0
        return {
          points: route.route.map((point) => ({ x: point.x, y: point.y })),
          strokeColor: TRACE_COLORS[z] ?? "rgba(128,128,128,0.85)",
        }
      },
    )

    const lastSnapshotByAnchorKey = new Map(
      this.lastForceIteration?.snapshots.map((snapshot) => [
        snapshot.anchorKey,
        snapshot,
      ]) ?? [],
    )
    const activeForceSide = this.lastForceIteration?.side ?? null

    for (const sideState of this.sideStates) {
      for (const pathState of sideState.paths) {
        const route = this.getPathPoints(pathState)
        const midpoint = route[BREAKOUT_MIDPOINT_INDEX]!
        const snapshot = lastSnapshotByAnchorKey.get(pathState.anchor.key)
        const isActiveSide = activeForceSide === sideState.side
        const z = pathState.anchor.representative.z

        points.push({
          x: midpoint.x,
          y: midpoint.y,
          color: LAYER_COLORS[z] ?? "black",
          label:
            isActiveSide && snapshot
              ? `${snapshot.connectionName} mid ` +
                `Δ=${formatVector(snapshot.appliedDelta)} ` +
                `rep=${formatVector(snapshot.repulsionForce)} ` +
                `sm=${formatVector(snapshot.smoothingForce)} ` +
                `att=${formatVector(snapshot.attractionForce)}`
              : undefined,
        })

        if (!snapshot || !isActiveSide) continue

        points.push({
          x: snapshot.midpointBefore.x,
          y: snapshot.midpointBefore.y,
          color: "rgba(96,96,96,0.75)",
        })
        points.push({
          x: snapshot.targetMidpoint.x,
          y: snapshot.targetMidpoint.y,
          color: "rgba(0,0,0,0.35)",
        })
      }
    }

    if (this.lastForceIteration) {
      const orthogonalVector = getOrthogonalUnitVector(
        this.lastForceIteration.side,
      )
      const forceLineSpecs = [
        {
          key: "repulsion" as const,
          color: "rgba(255,0,0,0.65)",
          offset: -0.12,
          scaleFactor: this.breakoutForceStepSize,
          strokeDash: [1.5, 1.5] as number[],
        },
        {
          key: "smoothing" as const,
          color: "rgba(160,32,240,0.65)",
          offset: 0,
          scaleFactor: this.breakoutForceStepSize,
          strokeDash: [1.5, 1.5] as number[],
        },
        {
          key: "attraction" as const,
          color: "rgba(96,96,96,0.65)",
          offset: 0.12,
          scaleFactor: this.breakoutForceStepSize,
          strokeDash: [1.5, 1.5] as number[],
        },
        {
          key: "applied" as const,
          color: "rgba(0,0,0,0.85)",
          offset: 0.24,
          scaleFactor: 1,
          strokeDash: undefined,
        },
      ]

      for (const snapshot of this.lastForceIteration.snapshots) {
        for (const lineSpec of forceLineSpecs) {
          const vector =
            lineSpec.key === "repulsion"
              ? scale(snapshot.repulsionForce, lineSpec.scaleFactor)
              : lineSpec.key === "smoothing"
                ? scale(snapshot.smoothingForce, lineSpec.scaleFactor)
                : lineSpec.key === "attraction"
                  ? scale(snapshot.attractionForce, lineSpec.scaleFactor)
                  : snapshot.appliedDelta

          if (length(vector) <= POINT_EPSILON) continue

          const start = add(
            snapshot.midpointBefore,
            scale(orthogonalVector, lineSpec.offset),
          )
          lines.push({
            points: [start, add(start, vector)],
            strokeColor: lineSpec.color,
            strokeDash: lineSpec.strokeDash,
          })
        }
      }
    }

    return {
      points,
      lines,
      rects,
      coordinateSystem: "cartesian" as const,
      title:
        `A08_BreakoutSolver ` +
        `[rect=${this.shrinkCount}, unsolved=${this.getHardUnsolvedSideStates().length}, ` +
        `optimize=${this.getOptimizationPendingSideStates().length}, ` +
        `iter=${this.iterationsAtCurrentRect}, ` +
        `last=${this.lastForceIteration?.side ?? "none"}/${this.lastForceIteration?.mode ?? "none"}]`,
    }
  }
}

export { HighDensitySolverA08BreakoutSolver as A08_BreakoutSolver }
