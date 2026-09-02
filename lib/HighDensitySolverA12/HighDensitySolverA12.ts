import {
  HighDensitySolverA03,
  type HighDensitySolverA03Props,
} from "../HighDensitySolverA03/HighDensitySolverA03"
import { getConnectionPortPointPairs } from "../getConnectionPortPointPairs"
import { getA11CellSizeMm } from "../HighDensitySolverA11/HighDensitySolverA11"
import { getRouteGeometryViolationError } from "../routeGeometryValidation"
import type { NodeWithPortPoints, PortPoint } from "../types"

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

function getLayerCount(nodeWithPortPoints: NodeWithPortPoints): number {
  return Math.max(
    1,
    nodeWithPortPoints.availableZ?.length ??
      new Set(nodeWithPortPoints.portPoints.map((portPoint) => portPoint.z))
        .size,
  )
}

function getPhysicalConnectionCounts(nodeWithPortPoints: NodeWithPortPoints): {
  total: number
  sameLayer: number
} {
  const portPointsByConnection = new Map<string, PortPoint[]>()
  for (const portPoint of nodeWithPortPoints.portPoints) {
    const portPoints =
      portPointsByConnection.get(portPoint.connectionName) ?? []
    portPoints.push(portPoint)
    portPointsByConnection.set(portPoint.connectionName, portPoints)
  }
  let total = 0
  let sameLayer = 0
  for (const portPoints of portPointsByConnection.values()) {
    const pairs = getConnectionPortPointPairs(portPoints)
    total += pairs.length
    sameLayer += pairs.filter(([start, end]) => start.z === end.z).length
  }
  return { total, sameLayer }
}

/**
 * A03's five-region grid with A11's feature-derived fine pitch around the
 * perimeter and a four-times coarser middle region.
 */
export class HighDensitySolverA12 extends HighDensitySolverA03 {
  fineGridCellThickness: number

  override getSolverName(): string {
    return "HighDensitySolverA12"
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
    const physicalConnectionCounts = getPhysicalConnectionCounts(
      props.nodeWithPortPoints,
    )
    const connectionsPerLayer = physicalConnectionCounts.total / layerCount
    const sameLayerConnectionRatio =
      physicalConnectionCounts.sameLayer / physicalConnectionCounts.total
    // A wide fine perimeter dominates the state count on congested nodes and
    // leaves little useful coarse middle. A one-trace-width perimeter keeps
    // endpoint precision while reserving the interior for coarse routing.
    const useCoarseCongestionGrid =
      requestedFineGridThickness === undefined &&
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
      (useCoarseCongestionGrid
        ? Math.ceil((props.traceThickness ?? 0.1) / fineCellSizeMm)
        : A12_FINE_PERIMETER_CELL_THICKNESS)

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
