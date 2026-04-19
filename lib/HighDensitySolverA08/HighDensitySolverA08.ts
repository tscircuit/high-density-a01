import { BaseSolver } from "@tscircuit/solver-utils"
import {
  HighDensitySolverA01,
  type HighDensitySolverA01Props,
} from "../HighDensitySolverA01/HighDensitySolverA01"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "../types"

type Side = "left" | "right" | "top" | "bottom"

type RectBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  width: number
  height: number
  center: { x: number; y: number }
}

type SpreadAnchor = {
  key: string
  side: Side
  representative: PortPoint
  members: PortPoint[]
}

type A08PlanStrategy = "exact-side-inset"

export type A08SpreadAssignment = {
  anchorKey: string
  side: Side
  original: { x: number; y: number; z: number }
  assigned: { x: number; y: number; z: number }
}

type SpreadPlan = {
  strategy: A08PlanStrategy
  innerRect: RectBounds
  innerNodeWithPortPoints: NodeWithPortPoints
  assignments: A08SpreadAssignment[]
}

type A08Stage =
  | "plan"
  | "create-inner-solver"
  | "step-inner-solver"
  | "finalize-inner-solution"

export interface HighDensitySolverA08Props extends HighDensitySolverA01Props {
  innerRectMarginMm?: number
}

const SIDE_ORDER: Side[] = ["left", "right", "bottom", "top"]
const EPSILON = 1e-9
const POINT_EPSILON = 1e-6

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function dedupeSortedNumbers(values: number[]) {
  const unique: number[] = []
  for (const value of values) {
    if (
      unique.length === 0 ||
      Math.abs(value - unique[unique.length - 1]!) > EPSILON
    ) {
      unique.push(value)
    }
  }
  return unique
}

function compareNumbers(a: number, b: number) {
  return a - b
}

function getNodeBounds(
  nodeWithPortPoints: Pick<NodeWithPortPoints, "center" | "width" | "height">,
): RectBounds {
  const minX = nodeWithPortPoints.center.x - nodeWithPortPoints.width / 2
  const maxX = nodeWithPortPoints.center.x + nodeWithPortPoints.width / 2
  const minY = nodeWithPortPoints.center.y - nodeWithPortPoints.height / 2
  const maxY = nodeWithPortPoints.center.y + nodeWithPortPoints.height / 2

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    },
  }
}

function rectFromBounds(bounds: {
  minX: number
  maxX: number
  minY: number
  maxY: number
}): RectBounds {
  return {
    ...bounds,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
  }
}

function pointToRectDistance(
  point: { x: number; y: number },
  rect: Pick<RectBounds, "minX" | "maxX" | "minY" | "maxY">,
) {
  const dx =
    point.x < rect.minX
      ? rect.minX - point.x
      : point.x > rect.maxX
        ? point.x - rect.maxX
        : 0
  const dy =
    point.y < rect.minY
      ? rect.minY - point.y
      : point.y > rect.maxY
        ? point.y - rect.maxY
        : 0
  return Math.hypot(dx, dy)
}

function chooseSide(
  portPoint: Pick<PortPoint, "x" | "y">,
  outerBounds: RectBounds,
): Side {
  const candidates: Array<[Side, number]> = [
    ["left", Math.abs(portPoint.x - outerBounds.minX)],
    ["right", Math.abs(portPoint.x - outerBounds.maxX)],
    ["bottom", Math.abs(portPoint.y - outerBounds.minY)],
    ["top", Math.abs(portPoint.y - outerBounds.maxY)],
  ]
  candidates.sort(
    (a, b) =>
      a[1] - b[1] || SIDE_ORDER.indexOf(a[0]) - SIDE_ORDER.indexOf(b[0]),
  )
  return candidates[0]![0]
}

function getAnchorKey(portPoint: PortPoint) {
  return (
    portPoint.portPointId ??
    `${portPoint.z}:${portPoint.x.toFixed(6)}:${portPoint.y.toFixed(6)}`
  )
}

function getSortCoordinate(side: Side, portPoint: Pick<PortPoint, "x" | "y">) {
  return side === "left" || side === "right" ? portPoint.y : portPoint.x
}

function buildCandidateValues(
  points: Array<Pick<PortPoint, "x" | "y">>,
  bounds: RectBounds,
  marginMm: number,
  axis: "x" | "y",
) {
  const minBound = axis === "x" ? bounds.minX : bounds.minY
  const maxBound = axis === "x" ? bounds.maxX : bounds.maxY
  const values = [minBound, maxBound]

  for (const point of points) {
    const value = axis === "x" ? point.x : point.y
    values.push(clamp(value - marginMm, minBound, maxBound))
    values.push(clamp(value, minBound, maxBound))
    values.push(clamp(value + marginMm, minBound, maxBound))
  }

  values.sort(compareNumbers)
  return dedupeSortedNumbers(values)
}

function findLargestGap(
  intervals: Array<[number, number]>,
  lowerBound: number,
  upperBound: number,
) {
  if (intervals.length === 0) return [lowerBound, upperBound] as const

  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  let cursor = lowerBound
  let bestGapStart = lowerBound
  let bestGapEnd = lowerBound

  for (const [rawStart, rawEnd] of intervals) {
    const start = clamp(rawStart, lowerBound, upperBound)
    const end = clamp(rawEnd, lowerBound, upperBound)
    if (end <= lowerBound || start >= upperBound) continue

    if (
      start > cursor + EPSILON &&
      start - cursor > bestGapEnd - bestGapStart
    ) {
      bestGapStart = cursor
      bestGapEnd = start
    }
    if (end > cursor) {
      cursor = end
    }
    if (cursor >= upperBound - EPSILON) {
      return [bestGapStart, bestGapEnd] as const
    }
  }

  if (upperBound - cursor > bestGapEnd - bestGapStart) {
    bestGapStart = cursor
    bestGapEnd = upperBound
  }

  return [bestGapStart, bestGapEnd] as const
}

function pickBetterRect(
  current: RectBounds | null,
  candidate: RectBounds | null,
) {
  if (!candidate) return current
  if (!current) return candidate

  const currentArea = current.width * current.height
  const candidateArea = candidate.width * candidate.height
  if (candidateArea > currentArea + EPSILON) return candidate
  if (candidateArea < currentArea - EPSILON) return current

  const currentMinDimension = Math.min(current.width, current.height)
  const candidateMinDimension = Math.min(candidate.width, candidate.height)
  if (candidateMinDimension > currentMinDimension + EPSILON) return candidate
  if (candidateMinDimension < currentMinDimension - EPSILON) return current

  if (candidate.width > current.width + EPSILON) return candidate
  if (candidate.width < current.width - EPSILON) return current

  return current
}

function scanForLargestRect(
  points: Array<Pick<PortPoint, "x" | "y">>,
  bounds: RectBounds,
  marginMm: number,
  primaryAxis: "x" | "y",
) {
  const secondaryAxis = primaryAxis === "x" ? "y" : "x"
  const primaryCandidates = buildCandidateValues(
    points,
    bounds,
    marginMm,
    primaryAxis,
  )

  const primaryLower = primaryAxis === "x" ? bounds.minX : bounds.minY
  const primaryUpper = primaryAxis === "x" ? bounds.maxX : bounds.maxY
  const secondaryLower = secondaryAxis === "x" ? bounds.minX : bounds.minY
  const secondaryUpper = secondaryAxis === "x" ? bounds.maxX : bounds.maxY

  let bestRect: RectBounds | null = null

  for (
    let startIndex = 0;
    startIndex < primaryCandidates.length;
    startIndex++
  ) {
    const primaryMin = primaryCandidates[startIndex]!
    for (
      let endIndex = startIndex + 1;
      endIndex < primaryCandidates.length;
      endIndex++
    ) {
      const primaryMax = primaryCandidates[endIndex]!
      if (primaryMax - primaryMin <= EPSILON) continue
      if (
        primaryMin < primaryLower - EPSILON ||
        primaryMax > primaryUpper + EPSILON
      ) {
        continue
      }

      const forbiddenIntervals: Array<[number, number]> = []
      for (const point of points) {
        const primaryValue = primaryAxis === "x" ? point.x : point.y
        const secondaryValue = secondaryAxis === "x" ? point.x : point.y
        let primaryDistance = 0
        if (primaryValue < primaryMin) {
          primaryDistance = primaryMin - primaryValue
        } else if (primaryValue > primaryMax) {
          primaryDistance = primaryValue - primaryMax
        }
        if (primaryDistance >= marginMm - EPSILON) continue

        const remainingSecondaryRadius = Math.sqrt(
          Math.max(0, marginMm * marginMm - primaryDistance * primaryDistance),
        )
        forbiddenIntervals.push([
          secondaryValue - remainingSecondaryRadius,
          secondaryValue + remainingSecondaryRadius,
        ])
      }

      const [secondaryMin, secondaryMax] = findLargestGap(
        forbiddenIntervals,
        secondaryLower,
        secondaryUpper,
      )
      if (secondaryMax - secondaryMin <= EPSILON) continue

      const candidate =
        primaryAxis === "x"
          ? rectFromBounds({
              minX: primaryMin,
              maxX: primaryMax,
              minY: secondaryMin,
              maxY: secondaryMax,
            })
          : rectFromBounds({
              minX: secondaryMin,
              maxX: secondaryMax,
              minY: primaryMin,
              maxY: primaryMax,
            })

      let valid = true
      for (const point of points) {
        if (pointToRectDistance(point, candidate) + POINT_EPSILON < marginMm) {
          valid = false
          break
        }
      }
      if (!valid) continue

      bestRect = pickBetterRect(bestRect, candidate)
    }
  }

  return bestRect
}

function enumerateCandidateRects(
  nodeWithPortPoints: NodeWithPortPoints,
  marginMm: number,
) {
  const outerBounds = getNodeBounds(nodeWithPortPoints)
  const points = nodeWithPortPoints.portPoints
  const candidates: RectBounds[] = []
  const candidateKeys = new Set<string>()

  const collectForAxis = (primaryAxis: "x" | "y") => {
    const secondaryAxis = primaryAxis === "x" ? "y" : "x"
    const primaryCandidates = buildCandidateValues(
      points,
      outerBounds,
      marginMm,
      primaryAxis,
    )

    const secondaryLower =
      secondaryAxis === "x" ? outerBounds.minX : outerBounds.minY
    const secondaryUpper =
      secondaryAxis === "x" ? outerBounds.maxX : outerBounds.maxY

    for (
      let startIndex = 0;
      startIndex < primaryCandidates.length;
      startIndex++
    ) {
      const primaryMin = primaryCandidates[startIndex]!
      for (
        let endIndex = startIndex + 1;
        endIndex < primaryCandidates.length;
        endIndex++
      ) {
        const primaryMax = primaryCandidates[endIndex]!
        if (primaryMax - primaryMin <= EPSILON) continue

        const forbiddenIntervals: Array<[number, number]> = []
        for (const point of points) {
          const primaryValue = primaryAxis === "x" ? point.x : point.y
          const secondaryValue = secondaryAxis === "x" ? point.x : point.y
          let primaryDistance = 0
          if (primaryValue < primaryMin) {
            primaryDistance = primaryMin - primaryValue
          } else if (primaryValue > primaryMax) {
            primaryDistance = primaryValue - primaryMax
          }
          if (primaryDistance >= marginMm - EPSILON) continue

          const remainingSecondaryRadius = Math.sqrt(
            Math.max(
              0,
              marginMm * marginMm - primaryDistance * primaryDistance,
            ),
          )
          forbiddenIntervals.push([
            secondaryValue - remainingSecondaryRadius,
            secondaryValue + remainingSecondaryRadius,
          ])
        }

        const [secondaryMin, secondaryMax] = findLargestGap(
          forbiddenIntervals,
          secondaryLower,
          secondaryUpper,
        )
        if (secondaryMax - secondaryMin <= EPSILON) continue

        const candidate =
          primaryAxis === "x"
            ? rectFromBounds({
                minX: primaryMin,
                maxX: primaryMax,
                minY: secondaryMin,
                maxY: secondaryMax,
              })
            : rectFromBounds({
                minX: secondaryMin,
                maxX: secondaryMax,
                minY: primaryMin,
                maxY: primaryMax,
              })

        let valid = true
        for (const point of points) {
          if (
            pointToRectDistance(point, candidate) + POINT_EPSILON <
            marginMm
          ) {
            valid = false
            break
          }
        }
        if (!valid) continue

        const key = [
          candidate.minX.toFixed(6),
          candidate.maxX.toFixed(6),
          candidate.minY.toFixed(6),
          candidate.maxY.toFixed(6),
        ].join("|")
        if (candidateKeys.has(key)) continue
        candidateKeys.add(key)
        candidates.push(candidate)
      }
    }
  }

  collectForAxis("x")
  collectForAxis("y")

  const byAreaBest =
    pickBetterRect(
      scanForLargestRect(points, outerBounds, marginMm, "x"),
      scanForLargestRect(points, outerBounds, marginMm, "y"),
    ) ?? null

  if (byAreaBest) {
    const key = [
      byAreaBest.minX.toFixed(6),
      byAreaBest.maxX.toFixed(6),
      byAreaBest.minY.toFixed(6),
      byAreaBest.maxY.toFixed(6),
    ].join("|")
    if (!candidateKeys.has(key)) {
      candidateKeys.add(key)
      candidates.push(byAreaBest)
    }
  }

  return candidates
}

function getSpreadSideLength(rect: RectBounds, side: Side) {
  return side === "left" || side === "right" ? rect.height : rect.width
}

function getPopulatedSides(nodeWithPortPoints: NodeWithPortPoints) {
  const outerBounds = getNodeBounds(nodeWithPortPoints)
  const populatedSides = new Set<Side>()

  for (const portPoint of nodeWithPortPoints.portPoints) {
    if (Math.abs(portPoint.x - outerBounds.minX) <= POINT_EPSILON) {
      populatedSides.add("left")
    }
    if (Math.abs(portPoint.x - outerBounds.maxX) <= POINT_EPSILON) {
      populatedSides.add("right")
    }
    if (Math.abs(portPoint.y - outerBounds.minY) <= POINT_EPSILON) {
      populatedSides.add("bottom")
    }
    if (Math.abs(portPoint.y - outerBounds.maxY) <= POINT_EPSILON) {
      populatedSides.add("top")
    }
  }

  return populatedSides
}

function pickExactSideInsetRect(
  nodeWithPortPoints: NodeWithPortPoints,
  marginMm: number,
) {
  const outerBounds = getNodeBounds(nodeWithPortPoints)
  const populatedSides = getPopulatedSides(nodeWithPortPoints)
  const candidate = rectFromBounds({
    minX: outerBounds.minX + (populatedSides.has("left") ? marginMm : 0),
    maxX: outerBounds.maxX - (populatedSides.has("right") ? marginMm : 0),
    minY: outerBounds.minY + (populatedSides.has("bottom") ? marginMm : 0),
    maxY: outerBounds.maxY - (populatedSides.has("top") ? marginMm : 0),
  })

  if (candidate.width <= EPSILON || candidate.height <= EPSILON) return null

  for (const portPoint of nodeWithPortPoints.portPoints) {
    if (pointToRectDistance(portPoint, candidate) + POINT_EPSILON < marginMm) {
      return null
    }
  }

  return candidate
}

function pickBestSpreadRect(
  nodeWithPortPoints: NodeWithPortPoints,
  marginMm: number,
) {
  const outerBounds = getNodeBounds(nodeWithPortPoints)
  const anchorSideCounts = new Map<Side, number>([
    ["left", 0],
    ["right", 0],
    ["bottom", 0],
    ["top", 0],
  ])
  const seenAnchors = new Set<string>()
  for (const portPoint of nodeWithPortPoints.portPoints) {
    const anchorKey = getAnchorKey(portPoint)
    if (seenAnchors.has(anchorKey)) continue
    seenAnchors.add(anchorKey)
    const side = chooseSide(portPoint, outerBounds)
    anchorSideCounts.set(side, (anchorSideCounts.get(side) ?? 0) + 1)
  }

  const relevantSides = SIDE_ORDER.filter(
    (side) => (anchorSideCounts.get(side) ?? 0) > 1,
  )
  const scoringSides =
    relevantSides.length > 0
      ? relevantSides
      : SIDE_ORDER.filter((side) => (anchorSideCounts.get(side) ?? 0) > 0)

  let bestRect: RectBounds | null = null
  let bestMinPitch = -Infinity
  let bestCongestion = Infinity

  for (const candidate of enumerateCandidateRects(
    nodeWithPortPoints,
    marginMm,
  )) {
    if (candidate.width <= EPSILON || candidate.height <= EPSILON) continue

    let minPitch = Infinity
    let congestion = 0

    for (const side of scoringSides) {
      const anchorCount = anchorSideCounts.get(side) ?? 0
      if (anchorCount <= 0) continue
      const spreadLength = Math.max(
        EPSILON,
        getSpreadSideLength(candidate, side),
      )
      const pitch = spreadLength / (anchorCount + 1)
      minPitch = Math.min(minPitch, pitch)
      congestion += (anchorCount * anchorCount) / spreadLength
    }

    if (minPitch > bestMinPitch + EPSILON) {
      bestRect = candidate
      bestMinPitch = minPitch
      bestCongestion = congestion
      continue
    }
    if (minPitch < bestMinPitch - EPSILON) continue

    if (congestion < bestCongestion - EPSILON) {
      bestRect = candidate
      bestCongestion = congestion
      continue
    }
    if (congestion > bestCongestion + EPSILON) continue

    bestRect = pickBetterRect(bestRect, candidate)
  }

  return bestRect
}

function samePoint(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  return (
    Math.abs(a.x - b.x) <= POINT_EPSILON &&
    Math.abs(a.y - b.y) <= POINT_EPSILON &&
    a.z === b.z
  )
}

function addPointIfDistinct(
  route: Array<{ x: number; y: number; z: number }>,
  point: { x: number; y: number; z: number },
) {
  const last = route[route.length - 1]
  if (last && samePoint(last, point)) return
  route.push(point)
}

export class HighDensitySolverA08 extends BaseSolver {
  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm: number
  viaDiameter: number
  maxCellCount?: number
  stepMultiplier: number
  traceThickness: number
  traceMargin: number
  viaMinDistFromBorder: number
  showPenaltyMap: boolean
  showUsedCellMap: boolean
  effort: number
  hyperParameters?: HighDensitySolverA01Props["hyperParameters"]
  initialPenaltyFn?: HighDensitySolverA01Props["initialPenaltyFn"]
  innerRectMarginMm: number

  innerRect: RectBounds | null = null
  innerRectStrategy: A08PlanStrategy | null = null
  innerNodeWithPortPoints: NodeWithPortPoints | null = null
  spreadAssignments: A08SpreadAssignment[] = []
  outputRoutes: HighDensityIntraNodeRoute[] = []
  innerSolver: HighDensitySolverA01 | null = null
  stage: A08Stage = "plan"
  private gridStatsSnapshot:
    | {
        cells: number
        layers: number
        states: number
      }
    | undefined
  private readonly constructorProps: HighDensitySolverA08Props

  constructor(props: HighDensitySolverA08Props) {
    super()
    this.constructorProps = props
    this.nodeWithPortPoints = props.nodeWithPortPoints
    this.cellSizeMm = props.cellSizeMm
    this.viaDiameter = props.viaDiameter
    this.maxCellCount = props.maxCellCount
    this.stepMultiplier = props.stepMultiplier ?? 1
    this.traceThickness = props.traceThickness ?? 0.1
    this.traceMargin = props.traceMargin ?? 0.15
    this.viaMinDistFromBorder = props.viaMinDistFromBorder ?? 0.15
    this.showPenaltyMap = props.showPenaltyMap ?? false
    this.showUsedCellMap = props.showUsedCellMap ?? false
    this.effort = props.effort ?? 1
    this.hyperParameters = props.hyperParameters
    this.initialPenaltyFn = props.initialPenaltyFn
    this.innerRectMarginMm = props.innerRectMarginMm ?? 1
    this.MAX_ITERATIONS = 100e6
  }

  override getConstructorParams(): [HighDensitySolverA08Props] {
    return [
      {
        ...this.constructorProps,
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
        innerRectMarginMm: this.innerRectMarginMm,
      },
    ]
  }

  get gridStats() {
    return this.gridStatsSnapshot
  }

  override _setup(): void {
    this.innerRect = null
    this.innerRectStrategy = null
    this.innerNodeWithPortPoints = null
    this.spreadAssignments = []
    this.outputRoutes = []
    this.innerSolver = null
    this.stage = "plan"
    this.activeSubSolver = null
    this.failedSubSolvers = undefined
    this.gridStatsSnapshot = undefined
  }

  override _step(): void {
    switch (this.stage) {
      case "plan":
        this.prepareSpreadPlan()
        return
      case "create-inner-solver":
        this.initializeInnerSolver()
        return
      case "step-inner-solver":
        this.stepInnerSolverOnce()
        return
      case "finalize-inner-solution":
        this.finalizeInnerSolution()
        return
    }
  }

  private createA01Solver(nodeWithPortPoints: NodeWithPortPoints) {
    return new HighDensitySolverA01({
      nodeWithPortPoints,
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
    })
  }

  private prepareSpreadPlan() {
    const spreadPlan = this.buildSpreadPlan()
    if (!spreadPlan) {
      this.error = "A08 could not find a valid 1mm inset inner rectangle"
      this.failed = true
      this.activeSubSolver = null
      return
    }

    this.innerRect = spreadPlan.innerRect
    this.innerRectStrategy = spreadPlan.strategy
    this.innerNodeWithPortPoints = spreadPlan.innerNodeWithPortPoints
    this.spreadAssignments = spreadPlan.assignments
    this.stage = "create-inner-solver"
  }

  private initializeInnerSolver() {
    if (!this.innerNodeWithPortPoints) {
      this.error = "A08 inner node was not prepared before solver creation"
      this.failed = true
      return
    }

    const innerSolver = this.createA01Solver(this.innerNodeWithPortPoints)
    innerSolver.MAX_ITERATIONS = Math.max(1, this.MAX_ITERATIONS - 3)
    this.innerSolver = innerSolver
    this.activeSubSolver = innerSolver
    this.stage = "step-inner-solver"
  }

  private stepInnerSolverOnce() {
    if (!this.innerSolver) {
      this.error = "A08 inner solver is missing"
      this.failed = true
      return
    }

    this.activeSubSolver = this.innerSolver
    this.innerSolver.step()
    this.gridStatsSnapshot = this.innerSolver.gridStats

    if (this.innerSolver.solved) {
      this.stage = "finalize-inner-solution"
      return
    }

    if (this.innerSolver.failed) {
      this.failedSubSolvers = [
        ...(this.failedSubSolvers ?? []),
        this.innerSolver,
      ]
      this.activeSubSolver = null
      this.failed = true
      this.error = this.innerSolver.error ?? "A08 inner solve failed"
    }
  }

  private finalizeInnerSolution() {
    if (!this.innerSolver || !this.innerSolver.solved) {
      this.error = "A08 cannot finalize before the inner solver succeeds"
      this.failed = true
      return
    }

    this.outputRoutes = this.combineRoutes(this.innerSolver.getOutput())
    this.activeSubSolver = null
    this.solved = true
    this.failed = false
    this.error = null
  }

  private buildSpreadPlan(): SpreadPlan | null {
    const strategy: A08PlanStrategy = "exact-side-inset"
    const innerRect = pickExactSideInsetRect(
      this.nodeWithPortPoints,
      this.innerRectMarginMm,
    )

    if (!innerRect) return null

    return this.buildSpreadPlanForRect(innerRect, strategy)
  }

  private buildSpreadPlanForRect(
    innerRect: RectBounds,
    strategy: A08PlanStrategy,
  ): SpreadPlan | null {
    if (
      innerRect.width <= this.cellSizeMm + EPSILON ||
      innerRect.height <= this.cellSizeMm + EPSILON
    ) {
      return null
    }

    const outerBounds = getNodeBounds(this.nodeWithPortPoints)
    const anchorsByKey = new Map<string, SpreadAnchor>()
    for (const portPoint of this.nodeWithPortPoints.portPoints) {
      const key = getAnchorKey(portPoint)
      if (!anchorsByKey.has(key)) {
        anchorsByKey.set(key, {
          key,
          side: chooseSide(portPoint, outerBounds),
          representative: portPoint,
          members: [],
        })
      }
      anchorsByKey.get(key)!.members.push(portPoint)
    }

    const assignedByKey = new Map<
      string,
      { x: number; y: number; z: number; side: Side }
    >()
    const assignments: A08SpreadAssignment[] = []

    for (const side of SIDE_ORDER) {
      const anchors = [...anchorsByKey.values()]
        .filter((anchor) => anchor.side === side)
        .sort((anchorA, anchorB) => {
          const coordinateDelta =
            getSortCoordinate(side, anchorA.representative) -
            getSortCoordinate(side, anchorB.representative)
          if (Math.abs(coordinateDelta) > POINT_EPSILON) return coordinateDelta
          const zDelta = anchorA.representative.z - anchorB.representative.z
          if (zDelta !== 0) return zDelta
          return anchorA.key.localeCompare(anchorB.key)
        })

      const count = anchors.length
      for (let index = 0; index < count; index++) {
        const anchor = anchors[index]!
        let assignedX = anchor.representative.x
        let assignedY = anchor.representative.y

        if (side === "left" || side === "right") {
          assignedX = side === "left" ? innerRect.minX : innerRect.maxX
          assignedY =
            count === 1
              ? clamp(anchor.representative.y, innerRect.minY, innerRect.maxY)
              : innerRect.minY + (innerRect.height * (index + 1)) / (count + 1)
        } else {
          assignedY = side === "bottom" ? innerRect.minY : innerRect.maxY
          assignedX =
            count === 1
              ? clamp(anchor.representative.x, innerRect.minX, innerRect.maxX)
              : innerRect.minX + (innerRect.width * (index + 1)) / (count + 1)
        }

        assignedByKey.set(anchor.key, {
          x: assignedX,
          y: assignedY,
          z: anchor.representative.z,
          side,
        })
        assignments.push({
          anchorKey: anchor.key,
          side,
          original: {
            x: anchor.representative.x,
            y: anchor.representative.y,
            z: anchor.representative.z,
          },
          assigned: {
            x: assignedX,
            y: assignedY,
            z: anchor.representative.z,
          },
        })
      }
    }

    const innerNodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: this.nodeWithPortPoints.capacityMeshNodeId,
      center: innerRect.center,
      width: innerRect.width,
      height: innerRect.height,
      availableZ: this.nodeWithPortPoints.availableZ,
      portPoints: this.nodeWithPortPoints.portPoints.map((portPoint) => {
        const assigned = assignedByKey.get(getAnchorKey(portPoint))
        if (!assigned) return portPoint
        return {
          ...portPoint,
          x: assigned.x,
          y: assigned.y,
        }
      }),
    }

    return {
      strategy,
      innerRect,
      innerNodeWithPortPoints,
      assignments,
    }
  }

  private combineRoutes(innerRoutes: HighDensityIntraNodeRoute[]) {
    const originalPointsByConnection = new Map<string, PortPoint[]>()
    for (const portPoint of this.nodeWithPortPoints.portPoints) {
      if (!originalPointsByConnection.has(portPoint.connectionName)) {
        originalPointsByConnection.set(portPoint.connectionName, [])
      }
      originalPointsByConnection.get(portPoint.connectionName)!.push(portPoint)
    }

    return innerRoutes.map((innerRoute) => {
      const originalPoints =
        originalPointsByConnection.get(innerRoute.connectionName) ?? []
      const firstOriginalPoint = originalPoints[0]
      const lastOriginalPoint = originalPoints[originalPoints.length - 1]
      const combinedRoute: Array<{ x: number; y: number; z: number }> = []

      if (firstOriginalPoint) {
        addPointIfDistinct(combinedRoute, {
          x: firstOriginalPoint.x,
          y: firstOriginalPoint.y,
          z: firstOriginalPoint.z,
        })
      }
      for (const routePoint of innerRoute.route) {
        addPointIfDistinct(combinedRoute, routePoint)
      }
      if (lastOriginalPoint) {
        addPointIfDistinct(combinedRoute, {
          x: lastOriginalPoint.x,
          y: lastOriginalPoint.y,
          z: lastOriginalPoint.z,
        })
      }

      return {
        ...innerRoute,
        rootConnectionName: firstOriginalPoint?.rootConnectionName,
        route: combinedRoute,
      }
    })
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    return this.outputRoutes
  }

  override visualize() {
    const LAYER_COLORS = ["red", "blue", "orange", "green"]
    const TRACE_COLORS = [
      "rgba(255,0,0,0.8)",
      "rgba(0,0,255,0.8)",
      "rgba(255,165,0,0.8)",
      "rgba(0,128,0,0.8)",
    ]

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
      center: this.nodeWithPortPoints.center,
      width: this.nodeWithPortPoints.width,
      height: this.nodeWithPortPoints.height,
      stroke: "gray",
    })

    if (this.innerRect) {
      rects.push({
        center: this.innerRect.center,
        width: this.innerRect.width,
        height: this.innerRect.height,
        stroke: "green",
      })
    }

    for (const portPoint of this.nodeWithPortPoints.portPoints) {
      points.push({
        x: portPoint.x,
        y: portPoint.y,
        color: LAYER_COLORS[portPoint.z] ?? "gray",
        label: portPoint.connectionName,
      })
    }

    for (const assignment of this.spreadAssignments) {
      lines.push({
        points: [
          { x: assignment.original.x, y: assignment.original.y },
          { x: assignment.assigned.x, y: assignment.assigned.y },
        ],
        strokeColor: "rgba(80,80,80,0.35)",
        strokeWidth: Math.max(0.05, this.traceThickness / 2),
      })
    }

    for (const route of this.outputRoutes) {
      if (route.route.length < 2) continue

      let segmentStart = 0
      for (let index = 1; index < route.route.length; index++) {
        const previous = route.route[index - 1]!
        const current = route.route[index]!
        if (previous.z !== current.z) {
          if (index - segmentStart >= 2) {
            lines.push({
              points: route.route
                .slice(segmentStart, index)
                .map((point) => ({ x: point.x, y: point.y })),
              strokeColor: TRACE_COLORS[previous.z] ?? "rgba(128,128,128,0.8)",
              strokeWidth: this.traceThickness,
            })
          }
          segmentStart = index
        }
      }

      if (route.route.length - segmentStart >= 2) {
        const lastLayer = route.route[segmentStart]!.z
        lines.push({
          points: route.route
            .slice(segmentStart)
            .map((point) => ({ x: point.x, y: point.y })),
          strokeColor: TRACE_COLORS[lastLayer] ?? "rgba(128,128,128,0.8)",
          strokeWidth: this.traceThickness,
        })
      }

      for (const via of route.vias) {
        circles.push({
          center: via,
          radius: this.viaDiameter / 2,
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
      title: `HighDensityA08 [${this.outputRoutes.length} routes]`,
    }
  }
}

export { HighDensitySolverA08 as HighDensityA08Solver }
