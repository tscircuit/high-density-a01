import {
  HighDensitySolverA01,
  type HighDensitySolverA01Props,
} from "../HighDensitySolverA01/HighDensitySolverA01"

interface A04ConnectionSeg {
  connId: number
  startZ: number
  startRow: number
  startCol: number
  endZ: number
  endRow: number
  endCol: number
}

interface A04CellRef {
  z: number
  row: number
  col: number
}

interface A04InternalState {
  rows: number
  cols: number
  unsolvedSegs: A04ConnectionSeg[]
  nodeWithPortPoints: {
    portPoints: Array<{ x: number; y: number; z: number }>
  }
  pointToCell(pt: { x: number; y: number; z: number }): A04CellRef
}

export interface HighDensitySolverA04Props extends HighDensitySolverA01Props {
  minEffort?: number
  iterationMultiplier?: number
  maxExtendedIterations?: number
  maxExtendedRips?: number
}

export class HighDensitySolverA04 extends HighDensitySolverA01 {
  minEffort: number
  iterationMultiplier: number
  maxExtendedIterations: number
  maxExtendedRips: number

  constructor(props: HighDensitySolverA04Props) {
    const minEffort = props.minEffort ?? 20
    super({
      ...props,
      effort: Math.max(props.effort ?? 1, minEffort),
    })
    this.minEffort = minEffort
    this.iterationMultiplier = props.iterationMultiplier ?? 8
    this.maxExtendedIterations = props.maxExtendedIterations ?? 50_000_000
    this.maxExtendedRips = props.maxExtendedRips ?? 20_000
  }

  override getConstructorParams(): [HighDensitySolverA04Props] {
    const [base] = super.getConstructorParams()
    return [
      {
        ...base,
        minEffort: this.minEffort,
        iterationMultiplier: this.iterationMultiplier,
        maxExtendedIterations: this.maxExtendedIterations,
        maxExtendedRips: this.maxExtendedRips,
      },
    ]
  }

  override _setup(): void {
    super._setup()
    if (this.failed) return

    this.prioritizeInitialConnections()

    const computedBudget = this.MAX_ITERATIONS
    const scaledBudget = Math.round(computedBudget * this.iterationMultiplier)
    this.MAX_ITERATIONS = Math.max(
      computedBudget,
      Math.min(this.maxExtendedIterations, scaledBudget),
    )
    this.MAX_RIPS = Math.max(this.MAX_RIPS, this.maxExtendedRips)
  }

  private prioritizeInitialConnections(): void {
    const state = this as unknown as A04InternalState
    if (state.unsolvedSegs.length < 2) return

    const pointToCell = state.pointToCell.bind(this)
    const portCells = state.nodeWithPortPoints.portPoints.map((pp) =>
      pointToCell(pp),
    )
    const rows = state.rows
    const cols = state.cols
    const densityRadiusSq = 4 * 4

    const getEndpointDensity = (z: number, row: number, col: number) => {
      let density = 0
      for (let i = 0; i < portCells.length; i++) {
        const port = portCells[i]!
        if (port.z !== z) continue
        const dr = port.row - row
        const dc = port.col - col
        if (dr * dr + dc * dc <= densityRadiusSq) density++
      }
      return density
    }

    const getBorderDistance = (row: number, col: number) =>
      Math.min(row, rows - 1 - row, col, cols - 1 - col)

    // Long routes become much more expensive once earlier nets consume the
    // shared corridors. A04 is the exact fallback, so it does better when
    // those corridor-hungry routes go first and the short locals clean up.
    state.unsolvedSegs.sort((a, b) => {
      const spanA =
        Math.abs(a.startRow - a.endRow) +
        Math.abs(a.startCol - a.endCol) +
        Math.abs(a.startZ - a.endZ) * 8
      const spanB =
        Math.abs(b.startRow - b.endRow) +
        Math.abs(b.startCol - b.endCol) +
        Math.abs(b.startZ - b.endZ) * 8
      if (spanA !== spanB) return spanB - spanA

      const crossesLayersA = a.startZ !== a.endZ ? 1 : 0
      const crossesLayersB = b.startZ !== b.endZ ? 1 : 0
      if (crossesLayersA !== crossesLayersB) {
        return crossesLayersB - crossesLayersA
      }

      const densityA =
        getEndpointDensity(a.startZ, a.startRow, a.startCol) +
        getEndpointDensity(a.endZ, a.endRow, a.endCol)
      const densityB =
        getEndpointDensity(b.startZ, b.startRow, b.startCol) +
        getEndpointDensity(b.endZ, b.endRow, b.endCol)
      if (densityA !== densityB) return densityB - densityA

      const borderDistanceA = Math.min(
        getBorderDistance(a.startRow, a.startCol),
        getBorderDistance(a.endRow, a.endCol),
      )
      const borderDistanceB = Math.min(
        getBorderDistance(b.startRow, b.startCol),
        getBorderDistance(b.endRow, b.endCol),
      )
      if (borderDistanceA !== borderDistanceB) {
        return borderDistanceA - borderDistanceB
      }

      return a.connId - b.connId
    })
  }
}
