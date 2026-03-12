import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultParams } from "../lib/default-params"
import { HighDensitySolverA02 } from "../lib/HighDensitySolverA02/HighDensitySolverA02"

const dataset02 = dataset02Json as Dataset02Sample[]

type RunRequest = {
  type: "run"
  sampleIndex: number
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
}

const runSingleSample = (sampleIndex: number): SampleResult => {
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

  const solver = new HighDensitySolverA02({
    ...defaultParams,
    nodeWithPortPoints,
    outerGridCellSize: 0.1,
    outerGridCellThickness: 1,
    innerGridCellSize: 0.4,
  })
  solver.MAX_ITERATIONS = 10_000_000

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
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data

  if (message.type === "shutdown") {
    return
  }

  const result = runSingleSample(message.sampleIndex)
  self.postMessage(result)
}
