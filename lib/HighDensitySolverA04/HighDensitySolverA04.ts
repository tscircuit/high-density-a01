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
  penalty2d: Float64Array
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
  initialCornerCongestionPenalty?: number
}

export class HighDensitySolverA04 extends HighDensitySolverA01 {
  minEffort: number
  iterationMultiplier: number
  maxExtendedIterations: number
  maxExtendedRips: number
  initialCornerCongestionPenalty: number

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
    this.initialCornerCongestionPenalty =
      props.initialCornerCongestionPenalty ?? 0.1
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
        initialCornerCongestionPenalty: this.initialCornerCongestionPenalty,
      },
    ]
  }

  override _setup(): void {
    super._setup()
    if (this.failed) return

    this.prioritizeInitialConnections()
    this.applyInitialCornerCongestionMap()

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

  private applyInitialCornerCongestionMap(): void {
    if (this.initialCornerCongestionPenalty <= 0) return

    const state = this as unknown as A04InternalState
    const rows = state.rows
    const cols = state.cols
    const penalty2d = state.penalty2d

    const sideCounts = {
      leftByRow: new Int32Array(rows),
      rightByRow: new Int32Array(rows),
      topByCol: new Int32Array(cols),
      bottomByCol: new Int32Array(cols),
    }

    const pointToCell = state.pointToCell.bind(this)
    for (let i = 0; i < state.nodeWithPortPoints.portPoints.length; i++) {
      const port = pointToCell(state.nodeWithPortPoints.portPoints[i]!)
      const dLeft = port.col
      const dRight = cols - 1 - port.col
      const dTop = port.row
      const dBottom = rows - 1 - port.row
      const minBorderDistance = Math.min(dLeft, dRight, dTop, dBottom)

      if (minBorderDistance === dLeft) {
        sideCounts.leftByRow[port.row]!++
      } else if (minBorderDistance === dRight) {
        sideCounts.rightByRow[port.row]!++
      } else if (minBorderDistance === dTop) {
        sideCounts.topByCol[port.col]!++
      } else {
        sideCounts.bottomByCol[port.col]!++
      }
    }

    const prefix = (counts: Int32Array) => {
      const out = new Int32Array(counts.length)
      let running = 0
      for (let i = 0; i < counts.length; i++) {
        running += counts[i]!
        out[i] = running
      }
      return out
    }

    const leftPrefix = prefix(sideCounts.leftByRow)
    const rightPrefix = prefix(sideCounts.rightByRow)
    const topPrefix = prefix(sideCounts.topByCol)
    const bottomPrefix = prefix(sideCounts.bottomByCol)

    const leftTotal = leftPrefix[leftPrefix.length - 1] ?? 0
    const rightTotal = rightPrefix[rightPrefix.length - 1] ?? 0
    const topTotal = topPrefix[topPrefix.length - 1] ?? 0
    const bottomTotal = bottomPrefix[bottomPrefix.length - 1] ?? 0

    const getPrefixValue = (values: Int32Array, idx: number) =>
      idx >= 0 ? values[idx] ?? 0 : 0

    const getSuffixValue = (values: Int32Array, total: number, idx: number) =>
      total - getPrefixValue(values, idx - 1)

    const cornerPressure = new Float64Array(rows * cols)
    let maxPressure = 0

    for (let row = 0; row < rows; row++) {
      const leftAtOrAbove = leftPrefix[row] ?? 0
      const leftAtOrBelow = getSuffixValue(leftPrefix, leftTotal, row)
      const rightAtOrAbove = rightPrefix[row] ?? 0
      const rightAtOrBelow = getSuffixValue(rightPrefix, rightTotal, row)

      for (let col = 0; col < cols; col++) {
        const topAtOrLeft = topPrefix[col] ?? 0
        const topAtOrRight = getSuffixValue(topPrefix, topTotal, col)
        const bottomAtOrLeft = bottomPrefix[col] ?? 0
        const bottomAtOrRight = getSuffixValue(bottomPrefix, bottomTotal, col)

        const topLeftPressure =
          (leftAtOrAbove + topAtOrLeft) / (row + col + 2)
        const bottomLeftPressure =
          (leftAtOrBelow + bottomAtOrLeft) / (rows - row + col + 1)
        const topRightPressure =
          (rightAtOrAbove + topAtOrRight) / (row + (cols - col) + 1)
        const bottomRightPressure =
          (rightAtOrBelow + bottomAtOrRight) / (rows - row + cols - col)

        const pressure = Math.max(
          topLeftPressure,
          bottomLeftPressure,
          topRightPressure,
          bottomRightPressure,
        )
        const idx = row * cols + col
        cornerPressure[idx] = pressure
        if (pressure > maxPressure) maxPressure = pressure
      }
    }

    if (maxPressure <= 0) return

    // Keep the seeded congestion soft: it should only bias the search away
    // from oversubscribed corners, not override the real routing costs.
    const penaltyScale = this.initialCornerCongestionPenalty / maxPressure
    for (let i = 0; i < cornerPressure.length; i++) {
      penalty2d[i] = penalty2d[i]! + cornerPressure[i]! * penaltyScale
    }
  }
}
