import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultA02Params } from "../lib/default-params"
import { HighDensitySolverA02 } from "../lib/HighDensitySolverA02/HighDensitySolverA02"

const dataset02 = dataset02Json as Dataset02Sample[]

type SolverMode = "fast" | "strict"

type WorkerOptions = {
  enableProfiling: boolean
  solverMode: SolverMode
  maxIterations: number
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

type SampleResult = {
  type: "result"
  sampleIndex: number
  solved: boolean
  failed: boolean
  iterations: number
  durationMs: number
  routes: number
  error: string | null
  profiling?: {
    setupMs: number
    buildGridMs: number
    keepoutMs: number
    searchMs: number
    fallbackMs: number
    repairMs: number
    repairs: number
  }
  gridStats?: {
    cells: number
    layers: number
    states: number
    neighborEdges: number
    traceKeepoutEntries: number
    viaFootprintEntries: number
  }
}

const runSingleSample = (
  sampleIndex: number,
  options: WorkerOptions,
): SampleResult => {
  const sample = dataset02[sampleIndex]
  if (!sample) {
    return {
      type: "result",
      sampleIndex,
      solved: false,
      failed: true,
      iterations: 0,
      durationMs: 0,
      routes: 0,
      error: `Sample ${sampleIndex} not found`,
    }
  }

  const nodeWithPortPoints = convertDataset02SampleToNodeWithPortPoints(
    sample,
    {
      capacityMeshNodeId: `dataset02-${sampleIndex + 1}`,
      availableZ: [0, 1],
    },
  )

  const strictMode = options.solverMode === "strict"
  const solver = new HighDensitySolverA02({
    ...defaultA02Params,
    nodeWithPortPoints,
    enableProfiling: options.enableProfiling,
    enableDeferredConflictRepair: strictMode,
    maxDeferredRepairPasses: strictMode ? 48 : 0,
    edgePenaltyStrength: strictMode ? 0.2 : undefined,
    hyperParameters: strictMode
      ? {
          ripCost: 1,
          greedyMultiplier: 1.2,
        }
      : undefined,
  })
  solver.MAX_ITERATIONS = options.maxIterations

  const start = performance.now()
  solver.solve()
  const durationMs = performance.now() - start

  return {
    type: "result",
    sampleIndex,
    solved: solver.solved,
    failed: solver.failed,
    iterations: solver.iterations,
    durationMs,
    routes: solver.getOutput().length,
    error: solver.error,
    profiling: options.enableProfiling ? solver.profiling : undefined,
    gridStats: options.enableProfiling ? solver.gridStats : undefined,
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
