import type { NodeWithPortPoints } from "../../lib/types"
import datasetFails03Json from "./dataset-fails03.json"

export type DatasetFails03Entry = {
  scenarioName: string
  solverName: string
  capacityMeshNodeId: string
  solverType: string
  iterations: number
  routeCount: number
  nodePf: number
  error: string
  nodeWithPortPoints: NodeWithPortPoints
}

export type DatasetFails03 = {
  generatedAt: string
  benchmarkResultPath: string
  datasetName: string
  failedScenarioCount: number
  extractedFailedHighDensityNodeCount: number
  failedHighDensityNodes: DatasetFails03Entry[]
}

export const datasetFails03 = datasetFails03Json as DatasetFails03

export const datasetFails03Entries = datasetFails03.failedHighDensityNodes
