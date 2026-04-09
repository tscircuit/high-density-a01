import { datasetFails03Entries } from "../fixtures/dataset-fails03/dataset-fails03"
import type { DatasetFails03SampleResult } from "./run-dataset-fails03-benchmark-a05.worker"

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

type WorkerRequest =
  | {
      type: "run"
      sampleIndex: number
      options: WorkerOptions
    }
  | {
      type: "shutdown"
    }

const args = process.argv.slice(2)
const concurrencyArg = args.find((arg) => arg.startsWith("--concurrency="))
const limitArg = args.find((arg) => arg.startsWith("--limit="))
const modeArg = args.find((arg) => arg.startsWith("--mode="))
const iterationsArg = args.find((arg) => arg.startsWith("--max-iterations="))
const ripCostArg = args.find((arg) => arg.startsWith("--rip-cost="))
const greedyMultiplierArg = args.find((arg) =>
  arg.startsWith("--greedy-multiplier="),
)
const borderPenaltyStrengthArg = args.find((arg) =>
  arg.startsWith("--border-penalty-strength="),
)
const borderPenaltyFalloffArg = args.find((arg) =>
  arg.startsWith("--border-penalty-falloff="),
)
const showStats = args.includes("--stats")
const showHelp = args.includes("--help") || args.includes("-h")

if (showHelp) {
  console.log(`
Usage: bun run scripts/run-dataset-fails03-benchmark-a05.ts [options]

Options:
  --concurrency=N      Number of worker loops (default: 4)
  --limit=N            Only run first N samples
  --mode=default|repro Solver tuning preset (default: default)
  --max-iterations=N   Solver MAX_ITERATIONS (default: 10000000)
  --rip-cost=N         Override hyperParameters.ripCost
  --greedy-multiplier=N
                       Override hyperParameters.greedyMultiplier
  --border-penalty-strength=N
                       Override A05 default border penalty strength
  --border-penalty-falloff=N
                       Override A05 default border penalty falloff
  --stats              Print average grid stats
  --help, -h           Show this help message

Examples:
  bun run scripts/run-dataset-fails03-benchmark-a05.ts --concurrency=4
  bun run scripts/run-dataset-fails03-benchmark-a05.ts --limit=10 --mode=repro
  bun run scripts/run-dataset-fails03-benchmark-a05.ts --rip-cost=4 --greedy-multiplier=1.4
  bun run scripts/run-dataset-fails03-benchmark-a05.ts --border-penalty-strength=0.1 --border-penalty-falloff=0.08
`)
  process.exit(0)
}

const parsedConcurrency = concurrencyArg
  ? Number.parseInt(concurrencyArg.split("=")[1] ?? "4", 10)
  : 4
const concurrency = Number.isFinite(parsedConcurrency)
  ? Math.max(1, parsedConcurrency)
  : 4
const limit = limitArg
  ? Number.parseInt(limitArg.split("=")[1] ?? "0", 10)
  : undefined
const solverMode = (() => {
  const value = modeArg?.split("=")[1]
  return value === "repro" ? "repro" : "default"
})()
const parsedMaxIterations = iterationsArg
  ? Number.parseInt(iterationsArg.split("=")[1] ?? "10000000", 10)
  : 10_000_000
const maxIterations = Number.isFinite(parsedMaxIterations)
  ? Math.max(1, parsedMaxIterations)
  : 10_000_000
const parsedRipCost = ripCostArg
  ? Number.parseFloat(ripCostArg.split("=")[1] ?? "")
  : Number.NaN
const ripCost = Number.isFinite(parsedRipCost) ? parsedRipCost : undefined
const parsedGreedyMultiplier = greedyMultiplierArg
  ? Number.parseFloat(greedyMultiplierArg.split("=")[1] ?? "")
  : Number.NaN
const greedyMultiplier = Number.isFinite(parsedGreedyMultiplier)
  ? parsedGreedyMultiplier
  : undefined
const parsedBorderPenaltyStrength = borderPenaltyStrengthArg
  ? Number.parseFloat(borderPenaltyStrengthArg.split("=")[1] ?? "")
  : Number.NaN
const borderPenaltyStrength = Number.isFinite(parsedBorderPenaltyStrength)
  ? parsedBorderPenaltyStrength
  : undefined
const parsedBorderPenaltyFalloff = borderPenaltyFalloffArg
  ? Number.parseFloat(borderPenaltyFalloffArg.split("=")[1] ?? "")
  : Number.NaN
const borderPenaltyFalloff = Number.isFinite(parsedBorderPenaltyFalloff)
  ? parsedBorderPenaltyFalloff
  : undefined

const sampleCount = Number.isFinite(limit)
  ? Math.max(0, Math.min(datasetFails03Entries.length, limit ?? 0))
  : datasetFails03Entries.length

if (sampleCount === 0) {
  console.log("No samples selected. Use --limit=N with N > 0.")
  process.exit(0)
}

const sampleIndices = Array.from({ length: sampleCount }, (_, index) => index)
const workerCount = Math.min(concurrency, sampleIndices.length)
const results: Array<DatasetFails03SampleResult | undefined> = new Array(
  sampleCount,
)
const workerOptions: WorkerOptions = {
  solverMode,
  maxIterations,
  collectStats: showStats,
  ripCost,
  greedyMultiplier,
  borderPenaltyStrength,
  borderPenaltyFalloff,
}

let nextJobPointer = 0
let processedCount = 0
let solvedCountSoFar = 0
let validCountSoFar = 0
let failedCountSoFar = 0

const workerScriptUrl = new URL(
  "./run-dataset-fails03-benchmark-a05.worker.ts",
  import.meta.url,
)

const runWithWorkers = async () => {
  const workers = Array.from(
    { length: workerCount },
    () => new Worker(workerScriptUrl.href, { type: "module" }),
  )

  const assignJob = (worker: Worker) => {
    const sampleIndex = sampleIndices[nextJobPointer]
    if (sampleIndex === undefined) {
      worker.postMessage({ type: "shutdown" } satisfies WorkerRequest)
      return
    }
    nextJobPointer += 1
    worker.postMessage({
      type: "run",
      sampleIndex,
      options: workerOptions,
    } satisfies WorkerRequest)
  }

  await new Promise<void>((resolve, reject) => {
    let completed = false

    for (let workerIndex = 0; workerIndex < workers.length; workerIndex++) {
      const worker = workers[workerIndex]!

      worker.onmessage = (event: MessageEvent<DatasetFails03SampleResult>) => {
        const result = event.data
        results[result.sampleIndex] = result

        processedCount += 1
        if (result.solved) solvedCountSoFar += 1
        if (result.valid) validCountSoFar += 1
        if (result.failed) failedCountSoFar += 1

        const solvedRateSoFar =
          (solvedCountSoFar / Math.max(1, processedCount)) * 100
        const validRateSoFar =
          (validCountSoFar / Math.max(1, processedCount)) * 100

        const status = result.valid
          ? "valid"
          : result.solved
            ? "invalid"
            : result.failed
              ? "failed"
              : "incomplete"
        console.log(
          `[worker ${workerIndex + 1}] sample ${result.sampleIndex + 1}/${sampleCount} ${result.scenarioName}/${result.capacityMeshNodeId}: ${status} in ${result.durationMs.toFixed(1)}ms (iterations=${result.iterations}, routes=${result.routes}, violations=${result.violationCount}, ports=${result.portCount}, roots=${result.rootNetCount}) | solved=${solvedCountSoFar}/${processedCount} (${solvedRateSoFar.toFixed(1)}%), valid=${validCountSoFar}/${processedCount} (${validRateSoFar.toFixed(1)}%)`,
        )
        if (result.error) {
          console.log(`  error: ${result.error}`)
        }

        if (processedCount >= sampleCount && !completed) {
          completed = true
          for (const w of workers) w.terminate()
          resolve()
          return
        }

        assignJob(worker)
      }

      worker.onerror = (error) => {
        if (completed) return
        completed = true
        for (const w of workers) w.terminate()
        reject(error)
      }

      assignJob(worker)
    }
  })
}

const benchmarkStart = performance.now()

console.log("Dataset fails03 benchmark for HighDensitySolverA05")
console.log("=".repeat(72))
console.log(`Samples: ${sampleCount}/${datasetFails03Entries.length}`)
console.log(`Workers: ${workerCount}`)
console.log(`Mode: ${solverMode}`)
console.log(`Max iterations: ${maxIterations}`)
if (ripCost !== undefined) console.log(`ripCost override: ${ripCost}`)
if (greedyMultiplier !== undefined) {
  console.log(`greedyMultiplier override: ${greedyMultiplier}`)
}
if (borderPenaltyStrength !== undefined) {
  console.log(`borderPenaltyStrength override: ${borderPenaltyStrength}`)
}
if (borderPenaltyFalloff !== undefined) {
  console.log(`borderPenaltyFalloff override: ${borderPenaltyFalloff}`)
}
console.log(`Grid stats: ${showStats ? "on" : "off"}`)
console.log()

await runWithWorkers()

const benchmarkMs = performance.now() - benchmarkStart
const completed = results.filter(
  (result): result is DatasetFails03SampleResult => Boolean(result),
)
const solvedCount = solvedCountSoFar
const validCount = validCountSoFar
const failedCount = failedCountSoFar
const avgDurationMs =
  completed.length > 0
    ? completed.reduce((sum, r) => sum + r.durationMs, 0) / completed.length
    : 0
const avgIterations =
  completed.length > 0
    ? completed.reduce((sum, r) => sum + r.iterations, 0) / completed.length
    : 0

console.log()
console.log("=".repeat(72))
console.log(`Completed: ${completed.length}/${sampleCount}`)
console.log(`Solved: ${solvedCount}`)
console.log(`Valid: ${validCount}`)
console.log(`Failed: ${failedCount}`)
console.log(
  `Solved rate: ${((solvedCount / Math.max(1, completed.length)) * 100).toFixed(1)}%`,
)
console.log(
  `Valid rate: ${((validCount / Math.max(1, completed.length)) * 100).toFixed(1)}%`,
)
console.log(`Average sample time: ${avgDurationMs.toFixed(1)}ms`)
console.log(`Average iterations: ${avgIterations.toFixed(0)}`)
console.log(`Total wall time: ${(benchmarkMs / 1000).toFixed(2)}s`)

const errorCounts = new Map<string, number>()
for (const result of completed) {
  if (result.valid) continue
  const errorKey = result.error ?? "No error reported"
  errorCounts.set(errorKey, (errorCounts.get(errorKey) ?? 0) + 1)
}

if (errorCounts.size > 0) {
  console.log()
  console.log("Failure summary:")
  for (const [error, count] of [...errorCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${count}x ${error}`)
  }
}

if (showStats && completed.length > 0) {
  const average = (pick: (result: DatasetFails03SampleResult) => number) =>
    completed.reduce((sum, result) => sum + pick(result), 0) /
    Math.max(1, completed.length)

  console.log()
  console.log("Average grid stats:")
  console.log(`  cells=${average((r) => r.gridStats?.cells ?? 0).toFixed(0)}`)
  console.log(`  layers=${average((r) => r.gridStats?.layers ?? 0).toFixed(1)}`)
  console.log(`  states=${average((r) => r.gridStats?.states ?? 0).toFixed(0)}`)
  console.log(
    `  ripStateBuckets=${average((r) => r.gridStats?.ripStateBuckets ?? 0).toFixed(1)}`,
  )
  console.log(
    `  neighborEdges=${average((r) => r.gridStats?.neighborEdges ?? 0).toFixed(0)}`,
  )
}
