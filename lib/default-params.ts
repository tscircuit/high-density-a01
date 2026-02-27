import type { HighDensitySolverA01Props } from "./HighDensitySolverA01/HighDensitySolverA01"

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
