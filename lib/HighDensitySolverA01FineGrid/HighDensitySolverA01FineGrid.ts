import {
  HighDensitySolverA01,
  type HighDensitySolverA01Props,
} from "../HighDensitySolverA01/HighDensitySolverA01"
import { getRouteGeometryViolationError } from "../routeGeometryValidation"

export type HighDensitySolverA01FineGridProps = Omit<
  HighDensitySolverA01Props,
  "cellSizeMm"
>

const MAX_FINE_GRID_CELL_SIZE_MM = 0.05

export function getA01FineGridCellSizeMm(
  props: HighDensitySolverA01FineGridProps,
): number {
  const traceThickness = props.traceThickness ?? 0.1
  const traceMargin = props.traceMargin ?? 0.15
  if (traceThickness <= 0 || traceMargin <= 0 || props.viaDiameter <= 0) {
    throw new Error("Fine-grid copper dimensions must be positive")
  }

  const cellSizeMm = Math.min(
    MAX_FINE_GRID_CELL_SIZE_MM,
    traceThickness / 2,
    traceMargin / 2,
    props.viaDiameter / 6,
  )
  return Number(cellSizeMm.toFixed(12))
}

export class HighDensitySolverA01FineGrid extends HighDensitySolverA01 {
  protected override useExactViaTraceClearance = true

  override getSolverName(): string {
    return "HighDensitySolverA01FineGrid"
  }

  constructor(props: HighDensitySolverA01FineGridProps) {
    super({
      ...props,
      cellSizeMm: getA01FineGridCellSizeMm(props),
    })
  }

  override _step(): void {
    super._step()
    if (!this.solved) return

    const geometryError = getRouteGeometryViolationError(this.getOutput())
    if (geometryError) {
      this.solved = false
      this.failed = true
      this.error = `Fine-grid solution failed geometry validation: ${geometryError}`
    }
  }
}
