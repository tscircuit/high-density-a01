import type { HighDensitySolverA01Props } from "./HighDensitySolverA01/HighDensitySolverA01"
import type { HighDensitySolverA02Props } from "./HighDensitySolverA02/HighDensitySolverA02"
import type { HighDensitySolverA03Props } from "./HighDensitySolverA03/HighDensitySolverA03"

export const defaultParams: Pick<
  HighDensitySolverA01Props,
  | "cellSizeMm"
  | "traceMargin"
  | "traceThickness"
  | "viaDiameter"
  | "viaMinDistFromBorder"
> = {
  cellSizeMm: 0.1,
  traceMargin: 0.15,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,
}

export const defaultA02Params: Pick<
  HighDensitySolverA02Props,
  | "outerGridCellSize"
  | "outerGridCellThickness"
  | "innerGridCellSize"
  | "traceMargin"
  | "traceThickness"
  | "viaDiameter"
  | "viaMinDistFromBorder"
> = {
  outerGridCellSize: 0.1,
  outerGridCellThickness: 1,
  innerGridCellSize: 0.4,
  traceMargin: 0.15,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,
}

export const defaultA03Params: Pick<
  HighDensitySolverA03Props,
  | "highResolutionCellSize"
  | "highResolutionCellThickness"
  | "lowResolutionCellSize"
  | "traceMargin"
  | "traceThickness"
  | "viaDiameter"
  | "viaMinDistFromBorder"
> = {
  highResolutionCellSize: 0.1,
  highResolutionCellThickness: 8,
  lowResolutionCellSize: 0.4,
  traceMargin: 0.15,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  viaMinDistFromBorder: 0.15,
}
