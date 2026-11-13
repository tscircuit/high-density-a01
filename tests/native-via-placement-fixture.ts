import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints, ViaPlacementValidator } from "../lib/types"

export const nativeViaFamilies = ["A01", "A03"] as const
export type NativeViaFamily = (typeof nativeViaFamilies)[number]
export const activeConnectionName = "signal_mst17"
export const physicalViaDiameter = 0.38

export const makeNativeViaNode = (): NodeWithPortPoints => ({
  capacityMeshNodeId: "synthetic-native-via-guidance",
  center: { x: 10, y: -20 },
  width: 4,
  height: 3,
  availableZ: [2, 5],
  portPoints: [
    {
      connectionName: activeConnectionName,
      rootConnectionName: "different-root-name",
      x: 8,
      y: -20,
      z: 2,
    },
    {
      connectionName: activeConnectionName,
      rootConnectionName: "different-root-name",
      x: 12,
      y: -20,
      z: 5,
    },
    { connectionName: "inactive-singleton", x: 8, y: -21.5, z: 2 },
  ],
})

export const makeNativeViaSolver = (
  family: NativeViaFamily,
  viaPlacementValidator?: ViaPlacementValidator,
): HighDensitySolverA01 | HighDensitySolverA03 => {
  const props = {
    nodeWithPortPoints: makeNativeViaNode(),
    viaDiameter: physicalViaDiameter,
    viaMinDistFromBorder: 0.125,
    traceThickness: 0.1,
    traceMargin: 0.05,
    stepMultiplier: 1,
    hyperParameters: { shuffleSeed: 0 },
    viaPlacementValidator,
  }
  return family === "A01"
    ? new HighDensitySolverA01({ ...props, cellSizeMm: 0.25 })
    : new HighDensitySolverA03({
        ...props,
        highResolutionCellSize: 0.25,
        lowResolutionCellSize: 0.5,
        highResolutionCellThickness: 2,
      })
}
