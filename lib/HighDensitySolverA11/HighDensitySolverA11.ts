import { getPhysicalConnectionStats } from "../getPhysicalConnectionStats"
import {
  HighDensitySolverA01,
  type HighDensitySolverA01Props,
} from "../HighDensitySolverA01/HighDensitySolverA01"
import { getRouteGeometryViolationError } from "../routeGeometryValidation"

export type HighDensitySolverA11Props = Omit<
  HighDensitySolverA01Props,
  "cellSizeMm"
>

const MAX_A11_CELL_SIZE_MM = 0.05
const MIN_BRANCHING_CONNECTION_COUNT = 6
const MIN_EXTRA_BRANCH_COUNT_FOR_SHORTEST_FIRST = 3

export function getA11CellSizeMm(props: HighDensitySolverA11Props): number {
  const traceThickness = props.traceThickness ?? 0.1
  const traceMargin = props.traceMargin ?? 0.15
  if (traceThickness <= 0 || traceMargin <= 0 || props.viaDiameter <= 0) {
    throw new Error("A11 copper dimensions must be positive")
  }

  const cellSizeMm = Math.min(
    MAX_A11_CELL_SIZE_MM,
    traceThickness / 2,
    traceMargin / 2,
    props.viaDiameter / 6,
  )
  return Number(cellSizeMm.toFixed(12))
}

export class HighDensitySolverA11 extends HighDensitySolverA01 {
  protected override useExactViaTraceClearance = true
  protected override ripHistoryCostMultiplier = 1
  protected override useBestGPruning = true
  private physicalConnectionCount: number
  private useExactCopperOccupancy: boolean
  private routeShortestBranchesFirst: boolean

  protected override getTraceMarginCells(): number {
    return this.useExactCopperOccupancy
      ? Math.ceil(this.traceThickness / 2 / this.cellSizeMm)
      : super.getTraceMarginCells()
  }

  protected override getInitialConnectionOrdering():
    | "shortest-first"
    | "topology-aware" {
    return this.routeShortestBranchesFirst ? "shortest-first" : "topology-aware"
  }

  override getSolverName(): string {
    return "HighDensitySolverA11"
  }

  computeProgress(): number {
    if (this.physicalConnectionCount === 0) return 0
    let solvedPhysicalConnections = 0
    for (const routes of this.solvedConnectionsMap.values()) {
      solvedPhysicalConnections += routes.length
    }
    return Math.min(1, solvedPhysicalConnections / this.physicalConnectionCount)
  }

  constructor(props: HighDensitySolverA11Props) {
    const { total, rootNets } = getPhysicalConnectionStats(
      props.nodeWithPortPoints,
    )
    const extraBranches = total - rootNets
    super({
      ...props,
      cellSizeMm: getA11CellSizeMm(props),
    })
    this.physicalConnectionCount = total
    this.useExactCopperOccupancy =
      total >= MIN_BRANCHING_CONNECTION_COUNT && extraBranches > 0
    this.routeShortestBranchesFirst =
      this.useExactCopperOccupancy &&
      extraBranches >= MIN_EXTRA_BRANCH_COUNT_FOR_SHORTEST_FIRST
  }

  override _step(): void {
    super._step()
    if (!this.solved) return

    const geometryError = getRouteGeometryViolationError(this.getOutput())
    if (geometryError) {
      this.solved = false
      this.failed = true
      this.error = `A11 solution failed geometry validation: ${geometryError}`
    }
  }
}
