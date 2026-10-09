import { getConnectionPortPointPairs } from "../getConnectionPortPointPairs"
import type { NodeWithPortPoints, PortPoint } from "../types"

type ConnectionName = PortPoint["connectionName"]

/** Exact endpoints outside the native domain cannot be reached by an in-bounds route. */
export function getNativeEndpointBoundsError(
  node: NodeWithPortPoints,
): string | null {
  const pointsByConnection = new Map<ConnectionName, PortPoint[]>()
  for (const point of node.portPoints) {
    const points = pointsByConnection.get(point.connectionName)
    if (points) points.push(point)
    else pointsByConnection.set(point.connectionName, [point])
  }
  const pairs = [...pointsByConnection.values()].flatMap(
    getConnectionPortPointPairs,
  )
  const minX = node.center.x - node.width / 2
  const maxX = node.center.x + node.width / 2
  const minY = node.center.y - node.height / 2
  const maxY = node.center.y + node.height / 2
  // Match the existing native geometry validation's numerical tolerance.
  const tolerance = 1e-9
  for (const [start, end] of pairs) {
    if (start.x === end.x && start.y === end.y && start.z === end.z) continue
    for (const point of [start, end]) {
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < minX - tolerance ||
        point.x > maxX + tolerance ||
        point.y < minY - tolerance ||
        point.y > maxY + tolerance
      ) {
        return `Required endpoint for ${point.connectionName} is outside native bounds or non-finite`
      }
    }
  }
  return null
}
