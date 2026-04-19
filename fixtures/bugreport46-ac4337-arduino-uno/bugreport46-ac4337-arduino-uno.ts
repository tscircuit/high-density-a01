import type { NodeWithPortPoints } from "../../lib/types"
import bugreport46ArduinoUnoJson from "./bugreport46-ac4337-arduino-uno.json"

export type FailedHighDensityNodeEntry = {
  capacityMeshNodeId: string
  solverType: string
  iterations: number
  routeCount: number
  nodePf: number
  error: string
  nodeWithPortPoints: NodeWithPortPoints
}

export type FailedHighDensityNodeCollection = {
  generatedAt: string
  source: string
  effort: number
  solved: boolean
  failed: boolean
  error: string
  failedHighDensityNodeCount: number
  failedHighDensityNodes: FailedHighDensityNodeEntry[]
}

export const bugreport46ArduinoUno =
  bugreport46ArduinoUnoJson as FailedHighDensityNodeCollection

export const bugreport46ArduinoUnoEntries =
  bugreport46ArduinoUno.failedHighDensityNodes
