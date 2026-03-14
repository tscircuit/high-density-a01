import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import type { Dataset02Sample } from "../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"

const dataset02 = dataset02Json as Dataset02Sample[]

type SolverMode = "default" | "repro"

type SampleResult = {
  type: "result"
  sampleIndex: number
  solved: boolean
  failed: boolean
  iterations: number
  durationMs: number
  routes: number
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

type WorkerOptions = {
  solverMode: SolverMode
  maxIterations: number
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
const showStats = args.includes("--stats")
const showHelp = args.includes("--help") || args.includes("-h")

if (showHelp) {
  console.log(`
Usage: bun run scripts/run-dataset02-benchmark-a03.ts [options]

Options:
  --concurrency=N      Number of worker loops (default: 4)
  --limit=N            Only run first N samples
  --mode=default|repro Solver tuning preset (default: default)
  --max-iterations=N   Solver MAX_ITERATIONS (default: 10000000)
  --stats              Print average grid stats
  --help, -h           Show this help message

Examples:
  bun run scripts/run-dataset02-benchmark-a03.ts --concurrency=4
  bun run scripts/run-dataset02-benchmark-a03.ts --limit=100 --mode=repro
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

const samples = Number.isFinite(limit)
  ? dataset02.slice(0, Math.max(0, limit ?? 0))
  : dataset02

if (samples.length === 0) {
  console.log("No samples selected. Use --limit=N with N > 0.")
  process.exit(0)
}

const sampleIndices = samples.map((_, index) => index)
const workerCount = Math.min(concurrency, sampleIndices.length)
const results: Array<SampleResult | undefined> = new Array(samples.length)
const workerOptions: WorkerOptions = {
  solverMode,
  maxIterations,
}

let nextJobPointer = 0
let processedCount = 0
let solvedCountSoFar = 0
let failedCountSoFar = 0

const workerScriptUrl = new URL(
  "./run-dataset02-benchmark-a03.worker.ts",
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

      worker.onmessage = (event: MessageEvent<SampleResult>) => {
        const result = event.data
        results[result.sampleIndex] = result

        processedCount += 1
        if (result.solved) solvedCountSoFar += 1
        if (result.failed) failedCountSoFar += 1

        const successRateSoFar =
          (solvedCountSoFar / Math.max(1, processedCount)) * 100

        const status = result.solved
          ? "solved"
          : result.failed
            ? "failed"
            : "incomplete"
        console.log(
          `[worker ${workerIndex + 1}] sample ${result.sampleIndex + 1}/${samples.length}: ${status} in ${result.durationMs.toFixed(1)}ms (iterations=${result.iterations}, routes=${result.routes}) | success=${solvedCountSoFar}/${processedCount} (${successRateSoFar.toFixed(1)}%)`,
        )
        if (result.error) {
          console.log(`  error: ${result.error}`)
        }

        if (processedCount >= samples.length && !completed) {
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

console.log("Dataset02 benchmark for HighDensitySolverA03")
console.log("=".repeat(72))
console.log(`Samples: ${samples.length}`)
console.log(`Workers: ${workerCount}`)
console.log(`Mode: ${solverMode}`)
console.log(`Max iterations: ${maxIterations}`)
console.log(`Grid stats: ${showStats ? "on" : "off"}`)
console.log()

await runWithWorkers()

const benchmarkMs = performance.now() - benchmarkStart
const completed = results.filter((result): result is SampleResult =>
  Boolean(result),
)
const solvedCount = solvedCountSoFar
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
console.log(`Completed: ${completed.length}/${samples.length}`)
console.log(`Solved: ${solvedCount}`)
console.log(`Failed: ${failedCount}`)
console.log(
  `Success rate: ${((solvedCount / Math.max(1, completed.length)) * 100).toFixed(1)}%`,
)
console.log(`Average sample time: ${avgDurationMs.toFixed(1)}ms`)
console.log(`Average iterations: ${avgIterations.toFixed(0)}`)
console.log(`Total wall time: ${(benchmarkMs / 1000).toFixed(2)}s`)

if (showStats && completed.length > 0) {
  const average = (pick: (result: SampleResult) => number) =>
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
