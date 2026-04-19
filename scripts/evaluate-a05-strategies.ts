import { basename, resolve } from "node:path"
import { defaultA05Params } from "../lib/default-params"
import {
  HighDensitySolverA05,
  type HighDensitySolverA05Props,
} from "../lib/HighDensitySolverA05/HighDensitySolverA05"

type FailedHighDensityNodeEntry = {
  capacityMeshNodeId: string
  error?: string
  nodeWithPortPoints: HighDensitySolverA05Props["nodeWithPortPoints"]
}

type FailedHighDensityNodeCollection = {
  source?: string
  failedHighDensityNodes: FailedHighDensityNodeEntry[]
}

type StrategyDefinition = {
  name: string
  description: string
  createProps: (
    node: FailedHighDensityNodeEntry,
  ) => Partial<HighDensitySolverA05Props>
}

const args = process.argv.slice(2)
const fixtureArg = args.find((arg) => arg.startsWith("--fixture="))
const includeBaseline = args.includes("--baseline")

const fixturePath = resolve(
  fixtureArg?.split("=")[1] ??
    "fixtures/bugreport46-ac4337-arduino-uno/bugreport46-ac4337-arduino-uno.json",
)

const fixture =
  (await Bun.file(fixturePath).json()) as FailedHighDensityNodeCollection

const strategies: StrategyDefinition[] = [
  {
    name: "more-rips",
    description:
      "Raise the global rip budget so late nets are allowed to displace more existing routes.",
    createProps: () => ({
      maxRips: 600,
    }),
  },
  {
    name: "shortest-first",
    description:
      "Route short local segments first to preserve narrow choke points before long perimeter routes occupy them.",
    createProps: () => ({
      connectionOrderingStrategy: "shortest-first",
    }),
  },
  {
    name: "rip-buckets",
    description:
      "Track search states in multiple rip-count buckets so low-rip alternatives are not pruned by higher-rip arrivals.",
    createProps: () => ({
      ripStateBuckets: 4,
    }),
  },
  {
    name: "dead-end-rip-up",
    description:
      "When the open set empties, rip nearby blocking routes, decay penalties, and retry instead of failing immediately.",
    createProps: () => ({
      noPathRetryLimit: 8,
      noPathPenaltyDecay: 0.65,
      deadEndRipUpCount: 2,
    }),
  },
  {
    name: "adaptive-combo",
    description:
      "Combine extra rip budget, shortest-first ordering, rip buckets, cheaper rerips, and targeted dead-end rip-ups.",
    createProps: () => ({
      maxRips: 600,
      connectionOrderingStrategy: "shortest-first",
      ripStateBuckets: 4,
      noPathRetryLimit: 8,
      noPathPenaltyDecay: 0.65,
      deadEndRipUpCount: 2,
      hyperParameters: {
        ripCost: 6,
        greedyMultiplier: 1.35,
      },
    }),
  },
]

const baselineStrategy: StrategyDefinition = {
  name: "baseline",
  description: "Current default solver behavior.",
  createProps: () => ({}),
}

const selectedStrategies = includeBaseline
  ? [baselineStrategy, ...strategies]
  : strategies

const results = []

for (const strategy of selectedStrategies) {
  const nodeResults = []

  for (const node of fixture.failedHighDensityNodes) {
    const solver = new HighDensitySolverA05({
      ...defaultA05Params,
      nodeWithPortPoints: node.nodeWithPortPoints,
      ...strategy.createProps(node),
    })
    solver.MAX_ITERATIONS = 10_000_000

    const start = performance.now()
    solver.solve()
    const durationMs = performance.now() - start

    nodeResults.push({
      nodeId: node.capacityMeshNodeId,
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
      iterations: solver.iterations,
      durationMs: Number(durationMs.toFixed(1)),
      routes: solver.getOutput().length,
    })
  }

  results.push({
    strategy: strategy.name,
    description: strategy.description,
    solvedCount: nodeResults.filter((result) => result.solved).length,
    failedCount: nodeResults.filter((result) => result.failed).length,
    nodeResults,
  })
}

console.log(
  JSON.stringify(
    {
      fixture: basename(fixturePath),
      source: fixture.source ?? null,
      strategies: results,
    },
    null,
    2,
  ),
)
