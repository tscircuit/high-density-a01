import {
  HighDensitySolverA03,
  type HighDensitySolverA03Props,
} from "../HighDensitySolverA03/HighDensitySolverA03"
import { getA11CellSizeMm } from "../HighDensitySolverA11/HighDensitySolverA11"
import { getRouteGeometryViolationError } from "../routeGeometryValidation"

export type HighDensitySolverA12Props = Omit<
  HighDensitySolverA03Props,
  | "highResolutionCellSize"
  | "highResolutionCellThickness"
  | "lowResolutionCellSize"
  | "enableDiagonalMoves"
> & {
  /** Number of fine-grid cells in the perimeter band. */
  fineGridCellThickness?: number
}

const A12_FINE_PERIMETER_CELL_THICKNESS = 16
const A12_COARSE_CELL_SCALE = 4

/**
 * A03's five-region grid with A11's feature-derived fine pitch around the
 * perimeter and a four-times coarser middle region.
 */
export class HighDensitySolverA12 extends HighDensitySolverA03 {
  fineGridCellThickness: number
  protected override preserveExactSameCellEndpoints = true

  override getSolverName(): string {
    return "HighDensitySolverA12"
  }

  constructor(props: HighDensitySolverA12Props) {
    const {
      fineGridCellThickness = A12_FINE_PERIMETER_CELL_THICKNESS,
      ...a03Props
    } = props
    const fineCellSizeMm = getA11CellSizeMm({
      nodeWithPortPoints: props.nodeWithPortPoints,
      viaDiameter: props.viaDiameter,
      traceThickness: props.traceThickness,
      traceMargin: props.traceMargin,
    })

    super({
      ...a03Props,
      highResolutionCellSize: fineCellSizeMm,
      highResolutionCellThickness: fineGridCellThickness,
      lowResolutionCellSize: fineCellSizeMm * A12_COARSE_CELL_SCALE,
      enableDiagonalMoves: true,
    })
    this.fineGridCellThickness = fineGridCellThickness
  }

  override getConstructorParams(): [HighDensitySolverA12Props] {
    const [a03Props] = super.getConstructorParams()
    const {
      highResolutionCellSize: _highResolutionCellSize,
      highResolutionCellThickness: _highResolutionCellThickness,
      lowResolutionCellSize: _lowResolutionCellSize,
      enableDiagonalMoves: _enableDiagonalMoves,
      ...sharedProps
    } = a03Props

    return [
      {
        ...sharedProps,
        fineGridCellThickness: this.fineGridCellThickness,
      },
    ]
  }

  override _step(): void {
    super._step()
    if (!this.solved) return

    const geometryError = getRouteGeometryViolationError(this.getOutput())
    if (geometryError) {
      this.solved = false
      this.failed = true
      this.error = `A12 solution failed geometry validation: ${geometryError}`
    }
  }
}
