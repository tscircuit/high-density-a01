import { datasetFails03Entries } from "../fixtures/dataset-fails03/dataset-fails03"
import { defaultA05Params } from "../lib/default-params"
import { HighDensitySolverA05 } from "../lib/HighDensitySolverA05/HighDensitySolverA05"
import { findRouteGeometryViolations } from "../tests/fixtures/validateNoIntersections"

type SolverMode = "default" | "repro"

type WorkerOptions = {
  solverMode: SolverMode
  maxIterations: number
  collectStats: boolean
  ripCost?: number
  greedyMultiplier?: number
  borderPenaltyStrength?: number
  borderPenaltyFalloff?: number
}

type RunRequest = {
  type: "run"
  sampleIndex: number
  options: WorkerOptions
}

type ShutdownRequest = {
  type: "shutdown"
}

type WorkerRequest = RunRequest | ShutdownRequest

export type DatasetFails03SampleResult = {
  type: "result"
  sampleIndex: number
  scenarioName: string
  capacityMeshNodeId: string
  solved: boolean
  valid: boolean
  failed: boolean
  iterations: number
  durationMs: number
  routes: number
  violationCount: number
  portCount: number
  rootNetCount: number
  error: string | null
  gridStats?: {
    cells: number
    layers: number
    states: number
    ripStateBuckets: number
    neighborEdges: number
    regionCounts: Record<string, number>
  }
}

const runSingleSample = (
  sampleIndex: number,
  options: WorkerOptions,
): DatasetFails03SampleResult => {
  const entry = datasetFails03Entries[sampleIndex]
  if (!entry) {
    return {
      type: "result",
      sampleIndex,
      scenarioName: "unknown",
      capacityMeshNodeId: "unknown",
      solved: false,
      valid: false,
      failed: true,
      iterations: 0,
      durationMs: 0,
      routes: 0,
      violationCount: 0,
      portCount: 0,
      rootNetCount: 0,
      error: `Sample ${sampleIndex} not found`,
    }
  }

  const hyperParameters = {
    ...(options.solverMode === "repro"
      ? {
          ripCost: 1,
          greedyMultiplier: 1.2,
        }
      : {}),
    ...(options.ripCost === undefined ? {} : { ripCost: options.ripCost }),
    ...(options.greedyMultiplier === undefined
      ? {}
      : { greedyMultiplier: options.greedyMultiplier }),
  }

  const solver = new HighDensitySolverA05({
    ...defaultA05Params,
    nodeWithPortPoints: entry.nodeWithPortPoints,
    ...(options.borderPenaltyStrength === undefined
      ? {}
      : { borderPenaltyStrength: options.borderPenaltyStrength }),
    ...(options.borderPenaltyFalloff === undefined
      ? {}
      : { borderPenaltyFalloff: options.borderPenaltyFalloff }),
    hyperParameters:
      Object.keys(hyperParameters).length > 0 ? hyperParameters : undefined,
  })
  solver.MAX_ITERATIONS = options.maxIterations

  const start = performance.now()
  solver.solve()
  const durationMs = performance.now() - start
  const routes = solver.getOutput()
  const violationCount = findRouteGeometryViolations(routes).length
  const valid = solver.solved && violationCount === 0
  const portCount = entry.nodeWithPortPoints.portPoints.length
  const rootNetCount = new Set(
    entry.nodeWithPortPoints.portPoints.map(
      (portPoint) => portPoint.rootConnectionName ?? portPoint.connectionName,
    ),
  ).size

  return {
    type: "result",
    sampleIndex,
    scenarioName: entry.scenarioName,
    capacityMeshNodeId: entry.capacityMeshNodeId,
    solved: solver.solved,
    valid,
    failed: solver.failed,
    iterations: solver.iterations,
    durationMs,
    routes: routes.length,
    violationCount,
    portCount,
    rootNetCount,
    error: solver.error,
    gridStats: options.collectStats ? solver.gridStats : undefined,
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data

  if (message.type === "shutdown") {
    return
  }

  const result = runSingleSample(message.sampleIndex, message.options)
  self.postMessage(result)
}
