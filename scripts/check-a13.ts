import { parseArgs } from "node:util"
import { HighDensitySolverA13 } from "../lib"
import node from "../fixtures/srj18/cmn_4__sub_2_0.json"

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    seed: { type: "string", default: "0" },
    budget: { type: "string", default: "50000000" },
    rounds: { type: "string", default: "200" },
    greedy: { type: "string" },
    output: { type: "string" },
  },
})
const solver = new HighDensitySolverA13({
  nodeWithPortPoints: node,
  cellSizeMm: 0.1,
  viaDiameter: 0.3,
  traceThickness: 0.1,
  traceMargin: 0.1,
  viaMinDistFromBorder: 0.15,
  stepMultiplier: 1000,
  maxRounds: Number(values.rounds),
  maxSearchIterations: Number(values.budget),
  hyperParameters: {
    shuffleSeed: Number(values.seed),
    ...(values.greedy === undefined
      ? {}
      : { greedyMultiplier: Number(values.greedy) }),
  },
})
const start = performance.now()
solver.setup()
solver.MAX_ITERATIONS = Number(values.budget)
let peakRoutes = 0
while (!solver.solved && !solver.failed) {
  solver.step()
  peakRoutes = Math.max(peakRoutes, solver.routedCount)
}
const report = {
  node: node.capacityMeshNodeId,
  growth: 1,
  greedyMultiplier: solver.hyperParameters.greedyMultiplier,
  solved: solver.solved,
  error: solver.error,
  routingIterations: solver.routingIterations,
  debuggerSteps: solver.iterations,
  routes: solver.getOutput().length,
  peakRoutes,
  requiredRoutes: node.portPointsInPairs.length,
  rounds: solver.round,
  conflictedRoutes: solver.conflictCount,
  bestConflictCount: solver.bestConflictCount,
  violations: solver.violations.length,
  ms: performance.now() - start,
}
console.log(JSON.stringify(report, null, 2))
if (values.output)
  await Bun.write(
    values.output,
    JSON.stringify({ ...report, routes: solver.getOutput() }, null, 2),
  )
