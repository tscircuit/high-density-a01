import { defaultA08Params, defaultParams } from "../lib/default-params"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA08 } from "../lib/HighDensitySolverA08/HighDensitySolverA08"
import cmn39 from "../tests/repros/cmn_39/cmn_39.json"

type SampleSummary = {
  durationMs: number
  solved: boolean
  failed: boolean
  iterations: number
  routes: number
  error: string | null
}

const runsArg = process.argv.find((arg) => arg.startsWith("--runs="))
const maxIterationsArg = process.argv.find((arg) =>
  arg.startsWith("--max-iterations="),
)
const effortArg = process.argv.find((arg) => arg.startsWith("--effort="))

const runCount = runsArg
  ? Math.max(1, Number.parseInt(runsArg.split("=")[1] ?? "10", 10))
  : 10
const maxIterations = maxIterationsArg
  ? Math.max(
      1,
      Number.parseInt(maxIterationsArg.split("=")[1] ?? "100000000", 10),
    )
  : 100_000_000
const effort = effortArg
  ? Math.max(1, Number.parseInt(effortArg.split("=")[1] ?? "10", 10))
  : 10

function runA01Once(): SampleSummary {
  const solver = new HighDensitySolverA01({
    ...defaultParams,
    nodeWithPortPoints: cmn39,
    effort,
  })
  solver.MAX_ITERATIONS = maxIterations

  const start = performance.now()
  solver.solve()
  const durationMs = performance.now() - start

  return {
    durationMs,
    solved: solver.solved,
    failed: solver.failed,
    iterations: solver.iterations,
    routes: solver.getOutput().length,
    error: solver.error,
  }
}

function runA08Once(): SampleSummary {
  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints: cmn39,
    effort,
  })
  solver.MAX_ITERATIONS = maxIterations

  const start = performance.now()
  solver.solve()
  const durationMs = performance.now() - start

  return {
    durationMs,
    solved: solver.solved,
    failed: solver.failed,
    iterations: solver.iterations,
    routes: solver.getOutput().length,
    error: solver.error,
  }
}

function computeMean(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function computeMedian(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middleIndex = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middleIndex]!
  return (sorted[middleIndex - 1]! + sorted[middleIndex]!) / 2
}

function printSummary(label: string, samples: SampleSummary[]) {
  const durations = samples.map((sample) => sample.durationMs)
  const iterations = samples.map((sample) => sample.iterations)
  const solvedCount = samples.filter((sample) => sample.solved).length
  const failedCount = samples.filter((sample) => sample.failed).length
  const first = samples[0]

  console.log(`${label}:`)
  console.log(`  solved=${solvedCount}/${samples.length}`)
  console.log(`  failed=${failedCount}/${samples.length}`)
  console.log(`  meanMs=${computeMean(durations).toFixed(2)}`)
  console.log(`  medianMs=${computeMedian(durations).toFixed(2)}`)
  console.log(`  minMs=${Math.min(...durations).toFixed(2)}`)
  console.log(`  maxMs=${Math.max(...durations).toFixed(2)}`)
  console.log(`  meanIterations=${computeMean(iterations).toFixed(0)}`)
  console.log(`  routes=${first?.routes ?? 0}`)
  if (first?.error) {
    console.log(`  firstError=${first.error}`)
  }
}

console.log("cmn_39 comparison")
console.log("=".repeat(48))
console.log(`runs=${runCount}`)
console.log(`maxIterations=${maxIterations}`)
console.log(`effort=${effort}`)

console.log("\nWarmup")
runA01Once()
runA08Once()

const a01Samples: SampleSummary[] = []
const a08Samples: SampleSummary[] = []

for (let index = 0; index < runCount; index++) {
  a01Samples.push(runA01Once())
  a08Samples.push(runA08Once())
}

console.log("")
printSummary("A01", a01Samples)
console.log("")
printSummary("A08", a08Samples)

const a01Median = computeMedian(a01Samples.map((sample) => sample.durationMs))
const a08Median = computeMedian(a08Samples.map((sample) => sample.durationMs))
if (a08Median > 0) {
  console.log("")
  console.log(
    `Median speedup (A01/A08): ${(a01Median / a08Median).toFixed(2)}x`,
  )
}
