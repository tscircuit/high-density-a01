import { SolverDebugger } from "../components/SolverDebugger"
import type { NodeWithPortPoints } from "../../lib/types"

type Edge = "left" | "right" | "top" | "bottom"

type GridPort = {
  edge: Edge
  index: number
  z: number
}

type GridSegment = {
  connectionName: string
  rootConnectionName: string
  start: GridPort
  end: GridPort
}

type GridNodeSpec = {
  capacityMeshNodeId: string
  cols: number
  rows: number
  cellSize?: number
  center?: { x: number; y: number }
}

/**
 * Creates a grid-snapped port on one side of the node.
 *
 * Parameters:
 * - `edge`: Which border the port sits on.
 * - `index`: Grid intersection index along that border.
 *   For `top`/`bottom`, the index runs from left to right.
 *   For `left`/`right`, the index runs from bottom to top.
 * - `z`: Optional layer index. Defaults to `0`.
 *
 * Returns:
 * A compact port descriptor for use with `segment(...)`.
 *
 * Note:
 * Indices are integer grid positions, not millimeter coordinates. That keeps
 * every step uniform and makes hand-editing much easier.
 */
function port(edge: Edge, index: number, z = 0): GridPort {
  return { edge, index, z }
}

/**
 * Creates one routed segment between two grid-snapped boundary ports.
 *
 * Parameters:
 * - `connectionName`: Connection id used by the solver.
 * - `start`: Start port on the node boundary.
 * - `end`: End port on the node boundary.
 * - `rootConnectionName`: Optional root net name. Defaults to `connectionName`.
 *
 * Returns:
 * A normalized segment definition consumed by `buildGridNode(...)`.
 *
 * Note:
 * Multiple segments may share the same `connectionName`. This fixture uses
 * that on purpose so it can model parallel segments of the same connection.
 */
function segment(
  connectionName: string,
  start: GridPort,
  end: GridPort,
  rootConnectionName = connectionName,
): GridSegment {
  return {
    connectionName,
    rootConnectionName,
    start,
    end,
  }
}

/**
 * Builds a `NodeWithPortPoints` from a simple grid-based description.
 *
 * Parameters:
 * - `spec`: Grid dimensions and node metadata.
 * - `segments`: Ordered list of connection segments to emit.
 *
 * Returns:
 * A complete `NodeWithPortPoints` object with generated `portPointId`s and
 * `portPointPairIds`.
 *
 * Notes:
 * - The node width is `cols * cellSize` and the height is `rows * cellSize`.
 * - Ports are placed on grid intersections along the boundary.
 * - Segment order is preserved in `portPointPairIds`, which is important when
 *   the same connection appears more than once.
 *
 * Caution:
 * `index` must land on the border grid. For example, a `top` port on a
 * `cols = 10` grid must use an index between `0` and `10`.
 */
function buildGridNode(
  spec: GridNodeSpec,
  segments: GridSegment[],
): NodeWithPortPoints {
  const cellSize = spec.cellSize ?? 1
  const center = spec.center ?? { x: 0, y: 0 }
  const width = spec.cols * cellSize
  const height = spec.rows * cellSize
  const minX = center.x - width / 2
  const minY = center.y - height / 2

  const portPoints: NodeWithPortPoints["portPoints"] = []
  const portPointPairIds: [string, string][] = []

  segments.forEach((currentSegment, segmentIndex) => {
    const startPortPointId = `${currentSegment.connectionName}:${segmentIndex}:start`
    const endPortPointId = `${currentSegment.connectionName}:${segmentIndex}:end`

    portPoints.push({
      portPointId: startPortPointId,
      connectionName: currentSegment.connectionName,
      rootConnectionName: currentSegment.rootConnectionName,
      ...resolveGridPort(currentSegment.start, spec, minX, minY, cellSize),
    })
    portPoints.push({
      portPointId: endPortPointId,
      connectionName: currentSegment.connectionName,
      rootConnectionName: currentSegment.rootConnectionName,
      ...resolveGridPort(currentSegment.end, spec, minX, minY, cellSize),
    })
    portPointPairIds.push([startPortPointId, endPortPointId])
  })

  return {
    capacityMeshNodeId: spec.capacityMeshNodeId,
    center,
    width,
    height,
    availableZ: [...new Set(portPoints.map((portPoint) => portPoint.z))].sort(
      (left, right) => left - right,
    ),
    portPoints,
    portPointPairIds,
  }
}

/**
 * Converts a grid port into an absolute solver point.
 *
 * Parameters:
 * - `gridPort`: Port expressed in edge/index form.
 * - `spec`: Grid dimensions used for bounds validation.
 * - `minX`: Left edge of the node in solver coordinates.
 * - `minY`: Bottom edge of the node in solver coordinates.
 * - `cellSize`: Distance between adjacent grid intersections.
 *
 * Returns:
 * An `{ x, y, z }` point on the node boundary.
 */
function resolveGridPort(
  gridPort: GridPort,
  spec: Pick<GridNodeSpec, "cols" | "rows">,
  minX: number,
  minY: number,
  cellSize: number,
) {
  if (!Number.isInteger(gridPort.index)) {
    throw new Error(`Grid port index must be an integer, got ${gridPort.index}`)
  }

  const maxIndex =
    gridPort.edge === "top" || gridPort.edge === "bottom"
      ? spec.cols
      : spec.rows

  if (gridPort.index < 0 || gridPort.index > maxIndex) {
    throw new Error(
      `Grid port ${gridPort.edge}:${gridPort.index} is outside 0..${maxIndex}`,
    )
  }

  switch (gridPort.edge) {
    case "left":
      return {
        x: minX,
        y: minY + gridPort.index * cellSize,
        z: gridPort.z,
      }
    case "right":
      return {
        x: minX + spec.cols * cellSize,
        y: minY + gridPort.index * cellSize,
        z: gridPort.z,
      }
    case "bottom":
      return {
        x: minX + gridPort.index * cellSize,
        y: minY,
        z: gridPort.z,
      }
    case "top":
      return {
        x: minX + gridPort.index * cellSize,
        y: minY + spec.rows * cellSize,
        z: gridPort.z,
      }
  }
}

export const reproParallelSameConnectionSolvingNodeWithPortPoints =
  buildGridNode(
    {
      capacityMeshNodeId: "repro-parallel-same-connection-solving",
      cols: 10,
      rows: 10,
    },
    [
      segment("parallel_conn", port("left", 6), port("top", 7)),
      segment("parallel_conn", port("bottom", 3), port("right", 6)),
    ],
  )

export default function ReproParallelSameConnectionSolvingFixture() {
  return (
    <SolverDebugger
      nodeWithPortPoints={reproParallelSameConnectionSolvingNodeWithPortPoints}
      defaultSolverKey="a03"
      debugKey="repro-parallel-same-connection-solving"
    />
  )
}
