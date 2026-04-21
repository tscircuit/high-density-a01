import type { HighDensitySolverA01Props } from "./HighDensitySolverA01/HighDensitySolverA01"
import type { HighDensitySolverA02Props } from "./HighDensitySolverA02/HighDensitySolverA02"
import type { HighDensitySolverA03Props } from "./HighDensitySolverA03/HighDensitySolverA03"
import type { HighDensitySolverA05Props } from "./HighDensitySolverA05/HighDensitySolverA05"
import type { HighDensitySolverA08Props } from "./HighDensitySolverA08/HighDensitySolverA08"
import type { HighDensitySolverA09Props } from "./HighDensitySolverA09/HighDensitySolverA09"

type A08BreakoutMarginProps = Pick<
  HighDensitySolverA08Props,
  "breakoutBoundaryMarginMm" | "breakoutTraceMarginMm"
>

export const defaultParams: Required<
  Pick<
    HighDensitySolverA01Props,
    | "cellSizeMm"
    | "traceMargin"
    | "traceThickness"
    | "viaDiameter"
    | "viaMinDistFromBorder"
  >
> = {
  cellSizeMm: 0.1,
  traceMargin: 0.15,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,
}

export const defaultA02Params: Required<
  Pick<
    HighDensitySolverA02Props,
    | "outerGridCellSize"
    | "outerGridCellThickness"
    | "innerGridCellSize"
    | "traceMargin"
    | "traceThickness"
    | "viaDiameter"
    | "viaMinDistFromBorder"
  >
> = {
  outerGridCellSize: 0.1,
  outerGridCellThickness: 1,
  innerGridCellSize: 0.4,
  traceMargin: 0.15,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,
}

export const defaultA03Params: Required<
  Pick<
    HighDensitySolverA03Props,
    | "highResolutionCellSize"
    | "highResolutionCellThickness"
    | "lowResolutionCellSize"
    | "traceMargin"
    | "traceThickness"
    | "viaDiameter"
    | "viaMinDistFromBorder"
  >
> = {
  highResolutionCellSize: 0.1,
  highResolutionCellThickness: 8,
  lowResolutionCellSize: 0.4,
  traceMargin: 0.15,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,
}

export const defaultA05Params: Required<
  Pick<
    HighDensitySolverA05Props,
    | "highResolutionCellSize"
    | "highResolutionCellThickness"
    | "lowResolutionCellSize"
    | "traceMargin"
    | "traceThickness"
    | "viaDiameter"
    | "viaMinDistFromBorder"
  >
> = {
  highResolutionCellSize: 0.1,
  highResolutionCellThickness: 8,
  lowResolutionCellSize: 0.4,
  traceMargin: 0.15,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,
}

export const defaultA08Params: Required<
  Pick<
    HighDensitySolverA08Props,
    | "cellSizeMm"
    | "traceMargin"
    | "traceThickness"
    | "viaDiameter"
    | "viaMinDistFromBorder"
    | "stepMultiplier"
    | "showPenaltyMap"
    | "showUsedCellMap"
    | "effort"
    | "initialRectMarginMm"
    | "rectShrinkStepMm"
    | "breakoutTraceMarginMm"
    | "breakoutSegmentCount"
    | "breakoutMaxIterationsPerRect"
    | "breakoutForceStepSize"
    | "breakoutRepulsionStrength"
    | "breakoutSmoothingStrength"
    | "breakoutAttractionStrength"
    | "innerPortSpreadFactor"
  >
> = {
  ...defaultParams,
  stepMultiplier: 1,
  showPenaltyMap: false,
  showUsedCellMap: false,
  effort: 1,
  initialRectMarginMm: 0.2,
  rectShrinkStepMm: 0.1,
  breakoutTraceMarginMm: 0.1,
  breakoutSegmentCount: 2,
  breakoutMaxIterationsPerRect: 60,
  breakoutForceStepSize: 0.2,
  breakoutRepulsionStrength: 1.8,
  breakoutSmoothingStrength: 0.16,
  breakoutAttractionStrength: 0.06,
  innerPortSpreadFactor: 1,
}

export const defaultA09Params: Required<
  Pick<
    HighDensitySolverA09Props,
    | "highResolutionCellSize"
    | "highResolutionCellThickness"
    | "lowResolutionCellSize"
    | "traceMargin"
    | "traceThickness"
    | "viaDiameter"
    | "viaMinDistFromBorder"
    | "effort"
    | "boundaryBonus"
    | "boundaryBonusSigma"
    | "portShadowStrength"
    | "portShadowTangentSigma"
    | "portShadowDepthSigma"
    | "fullOrderSearchConnectionCountLimit"
    | "priorityHeadSize"
    | "maxCandidateOrders"
  >
> = {
  ...defaultA03Params,
  effort: 20,
  boundaryBonus: 0.18,
  boundaryBonusSigma: 0.22,
  portShadowStrength: 0.55,
  portShadowTangentSigma: 0.18,
  portShadowDepthSigma: 0.5,
  fullOrderSearchConnectionCountLimit: 6,
  priorityHeadSize: 4,
  maxCandidateOrders: 720,
}

export function getDefaultA08BreakoutBoundaryMarginMm(
  props: A08BreakoutMarginProps,
) {
  if (props.breakoutBoundaryMarginMm !== undefined) {
    return props.breakoutBoundaryMarginMm
  }
  if (props.breakoutTraceMarginMm !== undefined) {
    return props.breakoutTraceMarginMm / 2
  }
  return defaultA08Params.breakoutTraceMarginMm / 2
}
