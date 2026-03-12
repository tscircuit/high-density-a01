import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import type { Dataset02Sample } from "../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"

const dataset02 = dataset02Json as Dataset02Sample[]

const args = process.argv.slice(2)
const concurrencyArg = args.find((arg) => arg.startsWith("--concurrency="))
const limitArg = args.find((arg) => arg.startsWith("--limit="))
const showHelp = args.includes("--help") || args.includes("-h")

if (showHelp) {
  console.log(`
Usage: bun run scripts/run-dataset02-benchmark-a02.ts [options]

Options:
  --concurrency=N   Number of worker loops (default: 4)
  --limit=N         Only run first N samples
  --help, -h        Show this help message
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

const samples = Number.isFinite(limit)
  ? dataset02.slice(0, Math.max(0, limit ?? 0))
  : dataset02

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

type WorkerRequest = { type: "run"; sampleIndex: number } | { type: "shutdown" }

if (samples.length === 0) {
  console.log("No samples selected. Use --limit=N with N > 0.")
  process.exit(0)
}

const sampleIndices = samples.map((_, index) => index)
const workerCount = Math.min(concurrency, sampleIndices.length)
const results: Array<SampleResult | undefined> = new Array(samples.length)
let nextJobPointer = 0
let processedCount = 0
let solvedCountSoFar = 0
let failedCountSoFar = 0

const workerScriptUrl = new URL(
  "./run-dataset02-benchmark-a02.worker.ts",
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
    worker.postMessage({ type: "run", sampleIndex } satisfies WorkerRequest)
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

        const status = result.solved
          ? "solved"
          : result.failed
            ? "failed"
            : "incomplete"
        const successRateSoFar =
          (solvedCountSoFar / Math.max(1, processedCount)) * 100

        console.log(
          `[worker ${workerIndex + 1}] sample ${result.sampleIndex + 1}/${samples.length}: ${status} in ${result.durationMs.toFixed(1)}ms (iterations=${result.iterations}, routes=${result.routes}) | success=${solvedCountSoFar}/${processedCount} (${successRateSoFar.toFixed(1)}%)`,
        )
        if (result.error) console.log(`  error: ${result.error}`)

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
console.log("Dataset02 benchmark for HighDensitySolverA02")
console.log("=".repeat(72))
console.log(`Samples: ${samples.length}`)
console.log(`Workers: ${workerCount}`)
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
