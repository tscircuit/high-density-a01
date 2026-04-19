import { BaseSolver } from "@tscircuit/solver-utils"
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

type BreakoutPathState = {
  anchor: SpreadAnchor
  tangents: number[]
  targetTangents: number[]
}

type SideState = {
  side: Side
  paths: BreakoutPathState[]
  solved: boolean
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

export interface A08BreakoutSolverProps {
  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm?: number
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

  private readonly constructorProps: A08BreakoutSolverProps
  private anchorsBySide = new Map<Side, SpreadAnchor[]>()
  private pendingShrinkSides: Side[] = []

  constructor(props: A08BreakoutSolverProps) {
    super()
    this.constructorProps = props
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.cellSizeMm = props.cellSizeMm ?? 0.1
    this.traceThickness = props.traceThickness ?? 0.1
    this.effort = props.effort ?? 1
    this.initialRectMarginMm =
      props.initialRectMarginMm ?? props.innerRectMarginMm ?? 1
    this.rectShrinkStepMm = props.rectShrinkStepMm ?? 0.4
    this.breakoutTraceMarginMm = props.breakoutTraceMarginMm ?? 0.1
    this.breakoutBoundaryMarginMm =
      props.breakoutBoundaryMarginMm ?? this.breakoutTraceMarginMm / 2
    this.breakoutSegmentCount = Math.max(2, props.breakoutSegmentCount ?? 6)
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
    this.spreadAssignments = []
    this.breakoutRoutes = []
    this.innerNodeWithPortPoints = null
    this.sideStates = []

    const initialRect = pickExactSideInsetRect(
      this.nodeWithPortPoints,
      this.initialRectMarginMm,
    )
    if (!initialRect) {
      this.error =
        "A08_BreakoutSolver could not build the initial 1mm inset rect"
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

    if (this.sideStates.every((sideState) => sideState.solved)) {
      this.solved = true
      return
    }

    if (this.pendingShrinkSides.length > 0) {
      if (!this.applyPendingShrink()) return
    }

    for (const sideState of this.sideStates) {
      if (sideState.solved || sideState.paths.length <= 1) continue
      this.runSideForceIteration(sideState)
      this.enforceSideStateConstraints(sideState)
    }

    this.iterationsAtCurrentRect += 1
    this.refreshDerivedState()

    const unsolvedSides = this.sideStates
      .filter((sideState) => !sideState.solved)
      .map((sideState) => sideState.side)

    if (unsolvedSides.length === 0) {
      this.solved = true
      return
    }

    if (this.iterationsAtCurrentRect >= this.breakoutMaxIterationsPerRect) {
      this.pendingShrinkSides = unsolvedSides
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
    this.sideStates = SIDE_ORDER.map((side) => ({
      side,
      paths: this.createPathStatesForSide(side),
      solved: false,
      violationCount: 0,
      minSegmentDistance: Infinity,
      minBoundaryClearance: Infinity,
    }))
    this.iterationsAtCurrentRect = 0
    this.refreshDerivedState()
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

      const tangents: number[] = []
      for (
        let pointIndex = 0;
        pointIndex <= this.breakoutSegmentCount;
        pointIndex++
      ) {
        const u = pointIndex / this.breakoutSegmentCount
        tangents.push(lerp(outerTangent, targetInnerTangent, u))
      }

      return {
        anchor,
        tangents: [...tangents],
        targetTangents: tangents,
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

  private getPathPoints(
    side: Side,
    pathState: BreakoutPathState,
  ): BreakoutPoint[] {
    const points: BreakoutPoint[] = [
      {
        x: pathState.anchor.representative.x,
        y: pathState.anchor.representative.y,
        z: pathState.anchor.representative.z,
      },
    ]

    for (
      let pointIndex = 1;
      pointIndex <= this.breakoutSegmentCount;
      pointIndex++
    ) {
      points.push(
        this.pointFromTangent(
          side,
          pointIndex / this.breakoutSegmentCount,
          pathState.tangents[pointIndex]!,
          pathState.anchor.representative.z,
        ),
      )
    }

    return points
  }

  private runSideForceIteration(sideState: SideState) {
    const pointCount = this.breakoutSegmentCount + 1
    const forces = sideState.paths.map(() => new Array(pointCount).fill(0))
    const pointLists = sideState.paths.map((pathState) =>
      this.getPathPoints(sideState.side, pathState),
    )

    for (const pathIndexes of groupPathIndexesByLayer(sideState)) {
      for (
        let groupIndex = 0;
        groupIndex < pathIndexes.length - 1;
        groupIndex++
      ) {
        const pathIndexA = pathIndexes[groupIndex]!
        const pathIndexB = pathIndexes[groupIndex + 1]!
        const pointListA = pointLists[pathIndexA]!
        const pointListB = pointLists[pathIndexB]!
        const forceA = forces[pathIndexA]!
        const forceB = forces[pathIndexB]!

        for (
          let segmentIndex = 0;
          segmentIndex < this.breakoutSegmentCount;
          segmentIndex++
        ) {
          const distance = segmentSegmentDistance(
            pointListA[segmentIndex]!,
            pointListA[segmentIndex + 1]!,
            pointListB[segmentIndex]!,
            pointListB[segmentIndex + 1]!,
          )

          if (distance.distance + EPSILON >= this.breakoutTraceMarginMm)
            continue

          const shortfall =
            this.breakoutTraceMarginMm -
            Math.max(distance.distance, POINT_EPSILON)
          const strength = shortfall * this.breakoutRepulsionStrength
          forceA[segmentIndex] -= strength * (1 - distance.aWeight)
          forceA[segmentIndex + 1] -= strength * distance.aWeight
          forceB[segmentIndex] += strength * (1 - distance.bWeight)
          forceB[segmentIndex + 1] += strength * distance.bWeight
        }
      }
    }

    for (let pathIndex = 0; pathIndex < sideState.paths.length; pathIndex++) {
      const pathState = sideState.paths[pathIndex]!
      const pathForces = forces[pathIndex]!

      for (
        let pointIndex = 1;
        pointIndex < this.breakoutSegmentCount;
        pointIndex++
      ) {
        const previous = pathState.tangents[pointIndex - 1]!
        const current = pathState.tangents[pointIndex]!
        const next = pathState.tangents[pointIndex + 1]!
        pathForces[pointIndex] +=
          ((previous + next) / 2 - current) * this.breakoutSmoothingStrength
      }

      for (
        let pointIndex = 1;
        pointIndex <= this.breakoutSegmentCount;
        pointIndex++
      ) {
        pathForces[pointIndex] +=
          (pathState.targetTangents[pointIndex]! -
            pathState.tangents[pointIndex]!) *
          this.breakoutAttractionStrength
      }

      for (
        let pointIndex = 1;
        pointIndex <= this.breakoutSegmentCount;
        pointIndex++
      ) {
        const delta = clamp(
          pathForces[pointIndex]! * this.breakoutForceStepSize,
          -this.rectShrinkStepMm,
          this.rectShrinkStepMm,
        )
        pathState.tangents[pointIndex] = pathState.tangents[pointIndex]! + delta
      }
    }
  }

  private enforceSideStateConstraints(sideState: SideState) {
    const pathCount = sideState.paths.length
    for (
      let pointIndex = 1;
      pointIndex <= this.breakoutSegmentCount;
      pointIndex++
    ) {
      const u = pointIndex / this.breakoutSegmentCount
      const crossSection = this.getCrossSection(sideState.side, u)
      let min = crossSection.tangentMin + this.breakoutBoundaryMarginMm
      let max = crossSection.tangentMax - this.breakoutBoundaryMarginMm

      if (max < min) {
        const midpoint = (crossSection.tangentMin + crossSection.tangentMax) / 2
        min = midpoint
        max = midpoint
      }

      for (const pathState of sideState.paths) {
        pathState.tangents[pointIndex] = clamp(
          pathState.tangents[pointIndex]!,
          min,
          max,
        )
      }

      if (pathCount <= 1) continue

      for (const pathIndexes of groupPathIndexesByLayer(sideState)) {
        if (pathIndexes.length <= 1) continue
        const maxGap = Math.max(
          POINT_EPSILON,
          (max - min) / (pathIndexes.length - 1),
        )
        const gap = Math.min(POINT_EPSILON, maxGap)

        for (
          let groupIndex = 1;
          groupIndex < pathIndexes.length;
          groupIndex++
        ) {
          const previousIndex = pathIndexes[groupIndex - 1]!
          const currentIndex = pathIndexes[groupIndex]!
          const previous = sideState.paths[previousIndex]!.tangents[pointIndex]!
          if (
            sideState.paths[currentIndex]!.tangents[pointIndex]! <
            previous + gap
          ) {
            sideState.paths[currentIndex]!.tangents[pointIndex] = previous + gap
          }
        }

        for (
          let groupIndex = pathIndexes.length - 2;
          groupIndex >= 0;
          groupIndex--
        ) {
          const currentIndex = pathIndexes[groupIndex]!
          const nextIndex = pathIndexes[groupIndex + 1]!
          const next = sideState.paths[nextIndex]!.tangents[pointIndex]!
          if (
            sideState.paths[currentIndex]!.tangents[pointIndex]! >
            next - gap
          ) {
            sideState.paths[currentIndex]!.tangents[pointIndex] = next - gap
          }
        }
      }

      for (const pathState of sideState.paths) {
        pathState.tangents[pointIndex] = clamp(
          pathState.tangents[pointIndex]!,
          min,
          max,
        )
      }
    }
  }

  private evaluateSideState(sideState: SideState) {
    if (sideState.paths.length <= 1) {
      sideState.solved = true
      sideState.violationCount = 0
      sideState.minSegmentDistance = Infinity
      sideState.minBoundaryClearance = Infinity
      return
    }

    const pointLists = sideState.paths.map((pathState) =>
      this.getPathPoints(sideState.side, pathState),
    )
    let minSegmentDistance = Infinity
    let minBoundaryClearance = Infinity
    let violationCount = 0

    for (const pathIndexes of groupPathIndexesByLayer(sideState)) {
      for (
        let groupIndex = 0;
        groupIndex < pathIndexes.length - 1;
        groupIndex++
      ) {
        const pointListA = pointLists[pathIndexes[groupIndex]!]!
        const pointListB = pointLists[pathIndexes[groupIndex + 1]!]!
        for (
          let segmentIndex = 0;
          segmentIndex < this.breakoutSegmentCount;
          segmentIndex++
        ) {
          const distance = segmentSegmentDistance(
            pointListA[segmentIndex]!,
            pointListA[segmentIndex + 1]!,
            pointListB[segmentIndex]!,
            pointListB[segmentIndex + 1]!,
          ).distance
          minSegmentDistance = Math.min(minSegmentDistance, distance)
          if (distance + EPSILON < this.breakoutTraceMarginMm) {
            violationCount += 1
          }
        }
      }
    }

    for (const pathState of sideState.paths) {
      for (
        let pointIndex = 1;
        pointIndex <= this.breakoutSegmentCount;
        pointIndex++
      ) {
        const u = pointIndex / this.breakoutSegmentCount
        const crossSection = this.getCrossSection(sideState.side, u)
        const tangent = pathState.tangents[pointIndex]!
        const boundaryClearance = Math.min(
          tangent - crossSection.tangentMin,
          crossSection.tangentMax - tangent,
        )
        minBoundaryClearance = Math.min(minBoundaryClearance, boundaryClearance)
        if (boundaryClearance + EPSILON < this.breakoutBoundaryMarginMm) {
          violationCount += 1
        }
      }
    }

    sideState.solved = violationCount === 0
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
    const solvedSideCount = populatedSideStates.filter(
      (sideState) => sideState.solved,
    ).length

    this.progress =
      populatedSideStates.length === 0
        ? 1
        : solvedSideCount / populatedSideStates.length
    this.stats = {
      shrinkCount: this.shrinkCount,
      iterationsAtCurrentRect: this.iterationsAtCurrentRect,
      innerRect: this.innerRect,
      unsolvedSides: populatedSideStates
        .filter((sideState) => !sideState.solved)
        .map((sideState) => sideState.side),
      sides: Object.fromEntries(
        this.sideStates.map((sideState) => [
          sideState.side,
          {
            solved: sideState.solved,
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
        const route = this.getPathPoints(sideState.side, pathState)
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

  private applyPendingShrink() {
    if (!this.innerRect) {
      this.error = "A08_BreakoutSolver missing rect before shrink"
      this.failed = true
      return false
    }

    const minDimension = Math.max(
      this.cellSizeMm,
      this.breakoutBoundaryMarginMm * 2,
    )
    const nextBounds = {
      minX: this.innerRect.minX,
      maxX: this.innerRect.maxX,
      minY: this.innerRect.minY,
      maxY: this.innerRect.maxY,
    }
    let changed = false

    for (const side of this.pendingShrinkSides) {
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

    this.pendingShrinkSides = []

    if (!changed) {
      this.error =
        "A08_BreakoutSolver could not shrink the inner rect any further"
      this.failed = true
      return false
    }

    const nextRect = rectFromBounds(nextBounds)
    if (
      nextRect.width <= Math.max(minDimension, EPSILON) ||
      nextRect.height <= Math.max(minDimension, EPSILON)
    ) {
      this.error = "A08_BreakoutSolver inner rect collapsed during shrink"
      this.failed = true
      return false
    }

    this.shrinkCount += 1
    this.reinitializeForInnerRect(nextRect)
    return true
  }

  override visualize() {
    const sideColors: Record<Side, string> = {
      left: "rgba(0,128,255,0.75)",
      right: "rgba(255,0,0,0.75)",
      top: "rgba(0,160,0,0.75)",
      bottom: "rgba(255,140,0,0.75)",
    }

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

    const points = this.nodeWithPortPoints.portPoints.map((portPoint) => ({
      x: portPoint.x,
      y: portPoint.y,
      color: "black",
      label: portPoint.connectionName,
    }))

    const circles = this.breakoutRoutes.map((route) => ({
      center: { x: route.assigned.x, y: route.assigned.y },
      radius: Math.max(0.05, this.traceThickness / 2),
      fill: sideColors[route.side],
      stroke: "black",
    }))

    const lines = this.breakoutRoutes.map((route) => ({
      points: route.route.map((point) => ({ x: point.x, y: point.y })),
      strokeColor: sideColors[route.side],
      strokeWidth: this.traceThickness,
    }))

    return {
      points,
      lines,
      circles,
      rects,
      coordinateSystem: "cartesian" as const,
      title: `A08_BreakoutSolver [rect=${this.shrinkCount}, unsolved=${this.sideStates.filter((sideState) => !sideState.solved).length}]`,
    }
  }
}

export { HighDensitySolverA08BreakoutSolver as A08_BreakoutSolver }
