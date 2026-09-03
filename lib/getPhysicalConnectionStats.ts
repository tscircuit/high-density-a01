import { getConnectionPortPointPairs } from "./getConnectionPortPointPairs"
import type { NodeWithPortPoints, PortPoint } from "./types"

export interface PhysicalConnectionStats {
  total: number
  sameLayer: number
  rootNets: number
}

export function getPhysicalConnectionStats(
  nodeWithPortPoints: NodeWithPortPoints,
): PhysicalConnectionStats {
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

  const rootNets = new Set(
    nodeWithPortPoints.portPoints.map(
      (portPoint) => portPoint.rootConnectionName ?? portPoint.connectionName,
    ),
  ).size

  return { total, sameLayer, rootNets }
}
