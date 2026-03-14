import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA02 } from "../lib/HighDensitySolverA02/HighDensitySolverA02"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import {
  defaultA02Params,
  defaultA03Params,
  defaultParams,
} from "../lib/default-params"
// @ts-ignore
import { hgProblems } from "../../high-density-dataset-z04/hg-problem/index.ts"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../lib/types"
import { findRouteGeometryViolations } from "../tests/fixtures/validateNoIntersections"
import type {
  Z04SampleResult,
  Z04SolverMode,
  Z04WorkerOptions,
} from "./run-dataset-z04-benchmark-common"

type SolverLike = {
  MAX_ITERATIONS: number
  solved: boolean
  failed: boolean
  iterations: number
  error: string | null
  solve(): void
  getOutput(): HighDensityIntraNodeRoute[]
  gridStats?: Z04SampleResult["gridStats"]
}

type RunRequest = {
  type: "run"
  sampleIndex: number
  options: Z04WorkerOptions
}

type ShutdownRequest = {
  type: "shutdown"
}

type WorkerRequest = RunRequest | ShutdownRequest

type HgProblemEntry = {
  id: number
  data: NodeWithPortPoints
}

const datasetZ04 = hgProblems as readonly HgProblemEntry[]

export const datasetZ04ProblemCount = datasetZ04.length

const createSolver = (
  nodeWithPortPoints: NodeWithPortPoints,
  options: Z04WorkerOptions,
): SolverLike => {
  switch (options.solverKey) {
    case "a01":
      return new HighDensitySolverA01({
        ...defaultParams,
        nodeWithPortPoints,
      })
    case "a02": {
      const strictMode = options.solverMode === "strict"
      return new HighDensitySolverA02({
        ...defaultA02Params,
        nodeWithPortPoints,
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
    }
    case "a03":
      return new HighDensitySolverA03({
        ...defaultA03Params,
        nodeWithPortPoints,
        hyperParameters:
          options.solverMode === "repro"
            ? {
                ripCost: 1,
                greedyMultiplier: 1.2,
              }
            : undefined,
      })
  }
}

const normalizeGridStats = (stats: unknown): Z04SampleResult["gridStats"] => {
  if (!stats || typeof stats !== "object") return undefined
  const value = stats as Record<string, unknown>
  return {
    cells: Number(value.cells ?? 0),
    layers: Number(value.layers ?? 0),
    states: Number(value.states ?? 0),
    neighborEdges:
      value.neighborEdges === undefined
        ? undefined
        : Number(value.neighborEdges),
    ripStateBuckets:
      value.ripStateBuckets === undefined
        ? undefined
        : Number(value.ripStateBuckets),
    traceKeepoutEntries:
      value.traceKeepoutEntries === undefined
        ? undefined
        : Number(value.traceKeepoutEntries),
    viaFootprintEntries:
      value.viaFootprintEntries === undefined
        ? undefined
        : Number(value.viaFootprintEntries),
    regionCounts:
      value.regionCounts &&
      typeof value.regionCounts === "object" &&
      !Array.isArray(value.regionCounts)
        ? Object.fromEntries(
            Object.entries(value.regionCounts).map(([key, count]) => [
              key,
              Number(count),
            ]),
          )
        : undefined,
  }
}

const runSingleSample = (
  sampleIndex: number,
  options: Z04WorkerOptions,
): Z04SampleResult => {
  const entry = datasetZ04[sampleIndex]
  if (!entry) {
    return {
      type: "result",
      sampleIndex,
      problemId: -1,
      solved: false,
      valid: false,
      failed: true,
      iterations: 0,
      durationMs: 0,
      routes: 0,
      violationCount: 0,
      error: `Problem ${sampleIndex} not found`,
    }
  }

  const solver = createSolver(entry.data, options)
  solver.MAX_ITERATIONS = options.maxIterations

  const start = performance.now()
  solver.solve()
  const durationMs = performance.now() - start
  const routes = solver.getOutput()
  const violations = findRouteGeometryViolations(routes)
  const violationCount = violations.length
  const valid = solver.solved && violationCount === 0

  return {
    type: "result",
    sampleIndex,
    problemId: entry.id,
    solved: solver.solved,
    valid,
    failed: solver.failed,
    iterations: solver.iterations,
    durationMs,
    routes: routes.length,
    violationCount,
    error: solver.error,
    gridStats: options.collectStats
      ? normalizeGridStats(solver.gridStats)
      : undefined,
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
