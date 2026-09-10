import type { NodeWithPortPoints } from "./types"

const BOUNDS_TOLERANCE_MM = 1e-9

/** Exact native routing cannot preserve a port outside the supplied bounds. */
export function getNativeNodeBoundsError(
  node: NodeWithPortPoints,
): string | null {
  if (
    !Number.isFinite(node.center.x) ||
    !Number.isFinite(node.center.y) ||
    !Number.isFinite(node.width) ||
    !Number.isFinite(node.height) ||
    node.width <= 0 ||
    node.height <= 0
  ) {
    return "Native routing requires finite positive node bounds"
  }
  for (const point of node.portPoints) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return `Native routing requires finite port coordinates for ${point.connectionName}`
    }
    if (
      Math.abs(point.x - node.center.x) >
        node.width / 2 + BOUNDS_TOLERANCE_MM ||
      Math.abs(point.y - node.center.y) > node.height / 2 + BOUNDS_TOLERANCE_MM
    ) {
      return `Port ${point.portPointId ?? point.connectionName} is outside original node bounds in ${node.capacityMeshNodeId}`
    }
  }
  return null
}
