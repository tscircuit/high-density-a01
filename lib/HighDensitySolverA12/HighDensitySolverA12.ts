import { getPhysicalConnectionStats } from "../getPhysicalConnectionStats"
import {
  HighDensitySolverA03,
  type HighDensitySolverA03Props,
} from "../HighDensitySolverA03/HighDensitySolverA03"
import { getA11CellSizeMm } from "../HighDensitySolverA11/HighDensitySolverA11"
import { getRouteGeometryViolationError } from "../routeGeometryValidation"
import type { NodeWithPortPoints } from "../types"

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
const A12_MAX_CONNECTIONS_PER_LAYER_FOR_FINE_GRID = 2
const A12_MIN_CONNECTIONS_PER_LAYER_FOR_FINE_GRID = 1
const A12_MIN_SAME_LAYER_CONNECTION_RATIO_FOR_FINE_GRID = 0.75
const A12_FINE_GRID_LAYER_THRESHOLD = 4
const A12_MAX_CONNECTIONS_FOR_CONSTRAINED_ORDERING = 10
const A12_MAX_ROOT_NETS_FOR_DENSE_BRANCH_ROUTING = 4
const A12_MIN_EXTRA_BRANCHES_FOR_UNIFORM_GRID = 6
const A12_MAX_CONNECTIONS_PER_LAYER_FOR_UNIFORM_GRID = 3
const A12_UNIFORM_FINE_GRID_THICKNESS = 4

function getLayerCount(nodeWithPortPoints: NodeWithPortPoints): number {
  return Math.max(
    1,
    nodeWithPortPoints.availableZ?.length ??
      new Set(nodeWithPortPoints.portPoints.map((portPoint) => portPoint.z))
        .size,
  )
}

/**
 * A03's five-region grid with A11's feature-derived fine pitch around the
 * perimeter and a four-times coarser middle region.
 */
export class HighDensitySolverA12 extends HighDensitySolverA03 {
  protected override preserveExactOutputEndpoints = true
  protected override includeRootConnectionNameInOutput = true
  fineGridCellThickness: number
  private physicalConnectionCount: number
  private useExactCopperKeepout: boolean
  private nativeOrdering:
    | "shuffled"
    | "cross-layer-longest-first"
    | "shortest-first"

  override getSolverName(): string {
    return "HighDensitySolverA12"
  }

  computeProgress(): number {
    if (this.physicalConnectionCount === 0) return 0
    let solvedPhysicalConnections = 0
    for (const routes of this.solvedConnectionsMap.values()) {
      solvedPhysicalConnections += routes.length
    }
    return Math.min(1, solvedPhysicalConnections / this.physicalConnectionCount)
  }

  protected override getTraceKeepoutRadius(): number {
    return this.useExactCopperKeepout
      ? this.traceThickness
      : super.getTraceKeepoutRadius()
  }

  protected override getInitialConnectionOrdering():
    | "shuffled"
    | "cross-layer-longest-first"
    | "shortest-first" {
    return this.nativeOrdering
  }

  constructor(props: HighDensitySolverA12Props) {
    const { fineGridCellThickness: requestedFineGridThickness, ...a03Props } =
      props
    const baseFineCellSizeMm = getA11CellSizeMm({
      nodeWithPortPoints: props.nodeWithPortPoints,
      viaDiameter: props.viaDiameter,
      traceThickness: props.traceThickness,
      traceMargin: props.traceMargin,
    })
    const layerCount = getLayerCount(props.nodeWithPortPoints)
    const physicalConnectionCounts = getPhysicalConnectionStats(
      props.nodeWithPortPoints,
    )
    const extraBranches =
      physicalConnectionCounts.total - physicalConnectionCounts.rootNets
    const connectionsPerLayer = physicalConnectionCounts.total / layerCount
    const sameLayerConnectionRatio =
      physicalConnectionCounts.sameLayer / physicalConnectionCounts.total
    const useConstrainedConnectionOrdering =
      physicalConnectionCounts.total <=
      A12_MAX_CONNECTIONS_FOR_CONSTRAINED_ORDERING
    const useDenseBranchOrdering =
      !useConstrainedConnectionOrdering &&
      physicalConnectionCounts.rootNets <=
        A12_MAX_ROOT_NETS_FOR_DENSE_BRANCH_ROUTING
    const useUniformDenseBranchGrid =
      requestedFineGridThickness === undefined &&
      physicalConnectionCounts.rootNets <=
        A12_MAX_ROOT_NETS_FOR_DENSE_BRANCH_ROUTING &&
      extraBranches >= A12_MIN_EXTRA_BRANCHES_FOR_UNIFORM_GRID &&
      connectionsPerLayer <= A12_MAX_CONNECTIONS_PER_LAYER_FOR_UNIFORM_GRID
    // A wide fine perimeter dominates the state count on congested nodes and
    // leaves little useful coarse middle. A one-trace-width perimeter keeps
    // endpoint precision while reserving the interior for coarse routing.
    const useCoarseCongestionGrid =
      requestedFineGridThickness === undefined &&
      !useUniformDenseBranchGrid &&
      connectionsPerLayer > A12_MAX_CONNECTIONS_PER_LAYER_FOR_FINE_GRID
    // Planar-heavy multilayer nodes need extra XY resolution to use narrow
    // same-layer channels. Limit this to low-congestion nodes so the finer
    // pitch cannot recreate A11's large-state failure mode.
    const useFinerMultilayerGrid =
      requestedFineGridThickness === undefined &&
      !useCoarseCongestionGrid &&
      layerCount >= A12_FINE_GRID_LAYER_THRESHOLD &&
      connectionsPerLayer > A12_MIN_CONNECTIONS_PER_LAYER_FOR_FINE_GRID &&
      sameLayerConnectionRatio >=
        A12_MIN_SAME_LAYER_CONNECTION_RATIO_FOR_FINE_GRID
    const fineCellSizeMm = useFinerMultilayerGrid
      ? baseFineCellSizeMm / 2
      : baseFineCellSizeMm
    const fineGridCellThickness =
      requestedFineGridThickness ??
      (useUniformDenseBranchGrid
        ? A12_UNIFORM_FINE_GRID_THICKNESS
        : useCoarseCongestionGrid
          ? Math.ceil((props.traceThickness ?? 0.1) / fineCellSizeMm)
          : A12_FINE_PERIMETER_CELL_THICKNESS)
    const coarseCellScale = useUniformDenseBranchGrid
      ? 1
      : A12_COARSE_CELL_SCALE

    super({
      ...a03Props,
      highResolutionCellSize: fineCellSizeMm,
      highResolutionCellThickness: fineGridCellThickness,
      lowResolutionCellSize: fineCellSizeMm * coarseCellScale,
      enableDiagonalMoves: true,
    })
    this.fineGridCellThickness = fineGridCellThickness
    this.physicalConnectionCount = physicalConnectionCounts.total
    this.useExactCopperKeepout =
      useConstrainedConnectionOrdering || useDenseBranchOrdering
    this.nativeOrdering = useUniformDenseBranchGrid
      ? useConstrainedConnectionOrdering
        ? "shortest-first"
        : "cross-layer-longest-first"
      : useConstrainedConnectionOrdering
        ? "cross-layer-longest-first"
        : useDenseBranchOrdering
          ? "shortest-first"
          : "shuffled"
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
