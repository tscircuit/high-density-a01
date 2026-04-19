import {
  BasePipelineSolver,
  definePipelineStep,
  type PipelineStep,
} from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  HighDensitySolverA01,
  type HighDensitySolverA01Props,
} from "../HighDensitySolverA01/HighDensitySolverA01"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../types"
import {
  A08_BreakoutSolver,
  HighDensitySolverA08BreakoutSolver,
  type A08BreakoutSolverProps,
} from "./A08_BreakoutSolver"
import { getSameLayerIntersectionError } from "../routeGeometryValidation"
import {
  type A08BreakoutRoute,
  type A08BreakoutSolverOutput,
  type A08SpreadAssignment,
  type RectBounds,
  type Side,
  combineBreakoutAndInnerRoutes,
  getNodeBounds,
} from "./shared"

export interface HighDensitySolverA08Props extends HighDensitySolverA01Props {
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

function normalizeA08Props(
  props: HighDensitySolverA08Props,
): HighDensitySolverA08Props {
  return {
    ...props,
    initialRectMarginMm: props.initialRectMarginMm ?? props.innerRectMarginMm,
  }
}

function toBreakoutSolverProps(
  props: HighDensitySolverA08Props,
): A08BreakoutSolverProps {
  return {
    nodeWithPortPoints: props.nodeWithPortPoints,
    cellSizeMm: props.cellSizeMm,
    maxCellCount: props.maxCellCount,
    traceMargin: props.traceMargin,
    traceThickness: props.traceThickness,
    effort: props.effort,
    initialRectMarginMm: props.initialRectMarginMm,
    innerRectMarginMm: props.innerRectMarginMm,
    rectShrinkStepMm: props.rectShrinkStepMm,
    breakoutTraceMarginMm: props.breakoutTraceMarginMm,
    breakoutBoundaryMarginMm: props.breakoutBoundaryMarginMm,
    breakoutSegmentCount: props.breakoutSegmentCount,
    breakoutMaxIterationsPerRect: props.breakoutMaxIterationsPerRect,
    breakoutForceStepSize: props.breakoutForceStepSize,
    breakoutRepulsionStrength: props.breakoutRepulsionStrength,
    breakoutSmoothingStrength: props.breakoutSmoothingStrength,
    breakoutAttractionStrength: props.breakoutAttractionStrength,
    innerPortSpreadFactor: props.innerPortSpreadFactor,
  }
}

function toInnerA01Props(
  props: HighDensitySolverA08Props,
  nodeWithPortPoints: NodeWithPortPoints,
): HighDensitySolverA01Props {
  return {
    nodeWithPortPoints,
    cellSizeMm: props.cellSizeMm,
    viaDiameter: props.viaDiameter,
    maxCellCount: props.maxCellCount,
    stepMultiplier: props.stepMultiplier,
    traceThickness: props.traceThickness,
    traceMargin: props.traceMargin,
    viaMinDistFromBorder: props.viaMinDistFromBorder,
    showPenaltyMap: props.showPenaltyMap,
    showUsedCellMap: props.showUsedCellMap,
    effort: props.effort,
    hyperParameters: props.hyperParameters,
    initialPenaltyFn: props.initialPenaltyFn,
  }
}

export class HighDensitySolverA08 extends BasePipelineSolver<HighDensitySolverA08Props> {
  A08_BreakoutSolver?: HighDensitySolverA08BreakoutSolver
  A01?: HighDensitySolverA01

  pipelineDef: PipelineStep<any>[] = [
    definePipelineStep(
      "A08_BreakoutSolver",
      A08_BreakoutSolver,
      (instance: HighDensitySolverA08) => [
        toBreakoutSolverProps(instance.inputProblem),
      ],
    ),
    definePipelineStep(
      "A01",
      HighDensitySolverA01,
      (instance: HighDensitySolverA08) => {
        const breakoutOutput =
          instance.getStageOutput<A08BreakoutSolverOutput>("A08_BreakoutSolver")
        if (!breakoutOutput) {
          throw new Error("A08 breakout output missing before A01 stage")
        }
        return [
          toInnerA01Props(
            instance.inputProblem,
            breakoutOutput.innerNodeWithPortPoints,
          ),
        ]
      },
    ),
  ]

  constructor(props: HighDensitySolverA08Props) {
    super(normalizeA08Props(props))
    this.MAX_ITERATIONS = 100_000_000
  }

  override getConstructorParams(): [HighDensitySolverA08Props] {
    return [this.inputProblem]
  }

  override _step(): void {
    const previousSubSolver = this.activeSubSolver
    super._step()

    if (this.failed) return
    if (this.solved) {
      this.validateSolvedOutputOrFail()
      return
    }

    const currentSubSolver = this.activeSubSolver
    if (currentSubSolver && currentSubSolver !== previousSubSolver) {
      currentSubSolver.MAX_ITERATIONS = Math.max(1, this.MAX_ITERATIONS)
    }
  }

  private validateSolvedOutputOrFail(): void {
    const error = getSameLayerIntersectionError(this.getOutput())
    if (!error) return
    this.error = `A08 output validation failed: ${error}`
    this.failed = true
    this.solved = false
  }

  get stage() {
    return this.getCurrentStageName()
  }

  get breakoutSolver() {
    return (
      this.getSolver<HighDensitySolverA08BreakoutSolver>(
        "A08_BreakoutSolver",
      ) ?? null
    )
  }

  get innerSolver() {
    return this.getSolver<HighDensitySolverA01>("A01") ?? null
  }

  get breakoutOutput() {
    return (
      this.getStageOutput<A08BreakoutSolverOutput>("A08_BreakoutSolver") ??
      this.breakoutSolver?.getOutput() ??
      null
    )
  }

  get innerRect(): RectBounds | null {
    return (
      this.breakoutOutput?.innerRect ?? this.breakoutSolver?.innerRect ?? null
    )
  }

  get innerNodeWithPortPoints() {
    return (
      this.breakoutOutput?.innerNodeWithPortPoints ??
      this.breakoutSolver?.innerNodeWithPortPoints ??
      null
    )
  }

  get spreadAssignments(): A08SpreadAssignment[] {
    return (
      this.breakoutOutput?.assignments ??
      this.breakoutSolver?.spreadAssignments ??
      []
    )
  }

  get breakoutRoutes(): A08BreakoutRoute[] {
    return (
      this.breakoutOutput?.breakoutRoutes ??
      this.breakoutSolver?.breakoutRoutes ??
      []
    )
  }

  get gridStats() {
    return this.innerSolver?.gridStats
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const innerRoutes =
      this.getStageOutput<HighDensityIntraNodeRoute[]>("A01") ??
      this.innerSolver?.getOutput() ??
      []

    return combineBreakoutAndInnerRoutes({
      originalNodeWithPortPoints: this.inputProblem.nodeWithPortPoints,
      breakoutOutput: this.breakoutOutput,
      innerRoutes,
    })
  }

  override initialVisualize(): GraphicsObject | null {
    const LAYER_COLORS = ["red", "blue", "orange", "green"]

    return {
      points: this.inputProblem.nodeWithPortPoints.portPoints.map(
        (portPoint) => ({
          x: portPoint.x,
          y: portPoint.y,
          color: LAYER_COLORS[portPoint.z] ?? "black",
          label: portPoint.connectionName,
        }),
      ),
      rects: [
        {
          center: this.inputProblem.nodeWithPortPoints.center,
          width: this.inputProblem.nodeWithPortPoints.width,
          height: this.inputProblem.nodeWithPortPoints.height,
          stroke: "gray",
        },
      ],
      lines: [],
      circles: [],
      coordinateSystem: "cartesian" as const,
      title: "HighDensityA08 Initial Problem",
    }
  }

  override finalVisualize(): GraphicsObject | null {
    const routes = this.getOutput()
    if (routes.length === 0) return null

    const TRACE_COLORS = [
      "rgba(255,0,0,0.85)",
      "rgba(0,0,255,0.85)",
      "rgba(255,165,0,0.85)",
      "rgba(0,128,0,0.85)",
    ]
    const outerBounds = getNodeBounds(this.inputProblem.nodeWithPortPoints)

    const rects = [
      {
        center: this.inputProblem.nodeWithPortPoints.center,
        width: this.inputProblem.nodeWithPortPoints.width,
        height: this.inputProblem.nodeWithPortPoints.height,
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

    const lines: GraphicsObject["lines"] = []
    for (const breakoutRoute of this.breakoutRoutes) {
      lines.push({
        points: breakoutRoute.route.map((point) => ({
          x: point.x,
          y: point.y,
        })),
        strokeColor: "rgba(96,96,96,0.35)",
        strokeWidth: Math.max(
          0.05,
          (this.inputProblem.traceThickness ?? 0.1) / 2,
        ),
      })
    }

    const circles: GraphicsObject["circles"] = []
    for (const route of routes) {
      if (route.route.length >= 2) {
        let segmentStart = 0
        for (
          let pointIndex = 1;
          pointIndex < route.route.length;
          pointIndex++
        ) {
          const previous = route.route[pointIndex - 1]!
          const current = route.route[pointIndex]!
          if (previous.z !== current.z) {
            if (pointIndex - segmentStart >= 2) {
              lines.push({
                points: route.route
                  .slice(segmentStart, pointIndex)
                  .map((point) => ({ x: point.x, y: point.y })),
                strokeColor:
                  TRACE_COLORS[previous.z] ?? "rgba(128,128,128,0.85)",
                strokeWidth: route.traceThickness,
              })
            }
            segmentStart = pointIndex
          }
        }

        if (route.route.length - segmentStart >= 2) {
          const lastLayer = route.route[segmentStart]!.z
          lines.push({
            points: route.route
              .slice(segmentStart)
              .map((point) => ({ x: point.x, y: point.y })),
            strokeColor: TRACE_COLORS[lastLayer] ?? "rgba(128,128,128,0.85)",
            strokeWidth: route.traceThickness,
          })
        }
      }

      for (const via of route.vias) {
        circles.push({
          center: via,
          radius: route.viaDiameter / 2,
          fill: "rgba(0,0,0,0.3)",
          stroke: "black",
        })
      }
    }

    const points = this.inputProblem.nodeWithPortPoints.portPoints.map(
      (portPoint) => ({
        x: portPoint.x,
        y: portPoint.y,
        color: "black",
        label: portPoint.connectionName,
      }),
    )

    return {
      points,
      lines,
      circles,
      rects: [
        ...rects,
        {
          center: { x: outerBounds.center.x, y: outerBounds.center.y },
          width: outerBounds.width,
          height: outerBounds.height,
          stroke: "transparent",
        },
      ],
      coordinateSystem: "cartesian" as const,
      title: `HighDensityA08 [${routes.length} routes]`,
    }
  }

  override visualize(): GraphicsObject {
    if (this.solved) {
      return this.finalVisualize() ?? super.visualize()
    }
    return super.visualize()
  }
}

export { HighDensitySolverA08 as HighDensityA08Solver }
export { HighDensitySolverA08BreakoutSolver } from "./A08_BreakoutSolver"
export type {
  A08BreakoutRoute,
  A08BreakoutSolverOutput,
  A08SpreadAssignment,
  RectBounds,
  Side,
} from "./shared"
