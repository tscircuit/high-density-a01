import type { NodeWithPortPoints } from "../../lib/types"

export const viaOccupantCacheNode: NodeWithPortPoints = {
  capacityMeshNodeId: "via-occupant-cache",
  center: { x: 0, y: 0 },
  width: 3,
  height: 3,
  availableZ: [0, 1],
  portPoints: Array.from({ length: 4 }, (_, connectionIndex) => [
    {
      connectionName: `trace${connectionIndex}`,
      rootConnectionName:
        connectionIndex < 2 ? "shared" : `net${connectionIndex}`,
      x: -1.5,
      y: -0.9 + connectionIndex * 0.6,
      z: connectionIndex % 2,
    },
    {
      connectionName: `trace${connectionIndex}`,
      rootConnectionName:
        connectionIndex < 2 ? "shared" : `net${connectionIndex}`,
      x: 1.5,
      y: 0.9 - connectionIndex * 0.6,
      z: (connectionIndex + 1) % 2,
    },
  ]).flat(),
}
