import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import type {
  HighDensityObstacle,
  ObstacleConnectivityMap,
} from "../../lib/ObstacleChecker"
import type { NodeWithPortPoints } from "../../lib/types"

export const createObstacleSolvers = (
  nodeWithPortPoints: NodeWithPortPoints,
  obstacles?: HighDensityObstacle[],
  connMap?: ObstacleConnectivityMap,
): Array<HighDensitySolverA01 | HighDensitySolverA03> => {
  const params = {
    nodeWithPortPoints,
    obstacles,
    connMap,
    cellSizeMm: 0.1,
    highResolutionCellSize: 0.1,
    highResolutionCellThickness: 8,
    lowResolutionCellSize: 0.4,
    viaDiameter: 0.3,
    traceThickness: 0.1,
    traceMargin: 0.1,
  }
  return [new HighDensitySolverA01(params), new HighDensitySolverA03(params)]
}
