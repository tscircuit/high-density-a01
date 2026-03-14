// @ts-ignore
import { hgProblems } from "../../high-density-dataset-z04/hg-problem/index.ts"

const datasetZ04ProblemCount = hgProblems.length

export type Z04SolverKey = "a01" | "a02" | "a03"

export type Z04SolverMode = "fast" | "strict" | "default" | "repro"

export type Z04SampleResult = {
  type: "result"
  sampleIndex: number
  problemId: number
  solved: boolean
  valid: boolean
  failed: boolean
  iterations: number
  durationMs: number
  routes: number
  violationCount: number
  error: string | null
  gridStats?: {
    cells: number
    layers: number
    states: number
    neighborEdges?: number
    ripStateBuckets?: number
    traceKeepoutEntries?: number
    viaFootprintEntries?: number
    regionCounts?: Record<string, number>
  }
}

export type Z04WorkerOptions = {
  solverKey: Z04SolverKey
  solverMode?: Z04SolverMode
  maxIterations: number
  collectStats: boolean
}

type WorkerRequest =
  | {
      type: "run"
      sampleIndex: number
      options: Z04WorkerOptions
    }
  | {
      type: "shutdown"
    }

type BenchmarkConfig = {
  solverKey: Z04SolverKey
  solverLabel: string
  helpModeText?: string
  modeParser?: (value: string | undefined) => Z04SolverMode | undefined
  defaultMode?: Z04SolverMode
}

export const runDatasetZ04Benchmark = async (config: BenchmarkConfig) => {
  const args = process.argv.slice(2)
  const concurrencyArg = args.find((arg) => arg.startsWith("--concurrency="))
  const limitArg = args.find((arg) => arg.startsWith("--limit="))
  const modeArg = args.find((arg) => arg.startsWith("--mode="))
  const iterationsArg = args.find((arg) => arg.startsWith("--max-iterations="))
  const showStats = args.includes("--stats")
  const showHelp = args.includes("--help") || args.includes("-h")

  if (showHelp) {
    const modeLines = config.helpModeText
      ? `  --mode=${config.helpModeText}\n`
      : ""
    const modeExample = config.helpModeText
      ? `\n  bun run scripts/run-dataset-z04-benchmark-${config.solverKey}.ts --limit=100 --mode=${config.defaultMode ?? "default"}`
      : ""

    console.log(`
Usage: bun run scripts/run-dataset-z04-benchmark-${config.solverKey}.ts [options]

Options:
  --concurrency=N      Number of worker loops (default: 4)
  --limit=N            Only run first N problems
${modeLines}  --max-iterations=N   Solver MAX_ITERATIONS (default: 1000000)
  --stats              Print average grid stats
  --help, -h           Show this help message

Examples:
  bun run scripts/run-dataset-z04-benchmark-${config.solverKey}.ts --concurrency=4${modeExample}
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
  const solverMode = config.modeParser
    ? config.modeParser(modeArg?.split("=")[1])
    : undefined
  const parsedMaxIterations = iterationsArg
    ? Number.parseInt(iterationsArg.split("=")[1] ?? "1000000", 10)
    : 1_000_000
  const maxIterations = Number.isFinite(parsedMaxIterations)
    ? Math.max(1, parsedMaxIterations)
    : 1_000_000

  const sampleCount = Number.isFinite(limit)
    ? Math.max(0, Math.min(datasetZ04ProblemCount, limit ?? 0))
    : datasetZ04ProblemCount

  if (sampleCount === 0) {
    console.log("No problems selected. Use --limit=N with N > 0.")
    process.exit(0)
  }

  const sampleIndices = Array.from({ length: sampleCount }, (_, index) => index)
  const workerCount = Math.min(concurrency, sampleIndices.length)
  const results: Array<Z04SampleResult | undefined> = new Array(sampleCount)
  const workerOptions: Z04WorkerOptions = {
    solverKey: config.solverKey,
    solverMode,
    maxIterations,
    collectStats: showStats,
  }

  let nextJobPointer = 0
  let processedCount = 0
  let completedCountSoFar = 0
  let validCountSoFar = 0
  let failedCountSoFar = 0

  const workerScriptUrl = new URL(
    "./run-dataset-z04-benchmark.worker.ts",
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

        worker.onmessage = (event: MessageEvent<Z04SampleResult>) => {
          const result = event.data
          results[result.sampleIndex] = result

          processedCount += 1
          if (result.solved) completedCountSoFar += 1
          if (result.valid) validCountSoFar += 1
          if (result.failed) failedCountSoFar += 1

          const completionRateSoFar =
            (completedCountSoFar / Math.max(1, processedCount)) * 100
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
            `[worker ${workerIndex + 1}] problem ${result.problemId} (${result.sampleIndex + 1}/${sampleCount}): ${status} in ${result.durationMs.toFixed(1)}ms (iterations=${result.iterations}, routes=${result.routes}, violations=${result.violationCount}) | completed=${completedCountSoFar}/${processedCount} (${completionRateSoFar.toFixed(1)}%), valid=${validCountSoFar}/${processedCount} (${validRateSoFar.toFixed(1)}%)`,
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

  console.log(`Dataset Z04 benchmark for ${config.solverLabel}`)
  console.log("=".repeat(72))
  console.log(`Problems: ${sampleCount}/${datasetZ04ProblemCount}`)
  console.log(`Workers: ${workerCount}`)
  if (solverMode) console.log(`Mode: ${solverMode}`)
  console.log(`Max iterations: ${maxIterations}`)
  console.log(`Grid stats: ${showStats ? "on" : "off"}`)
  console.log()

  await runWithWorkers()

  const benchmarkMs = performance.now() - benchmarkStart
  const completed = results.filter((result): result is Z04SampleResult =>
    Boolean(result),
  )
  const completedCount = completedCountSoFar
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
  console.log(`Processed: ${completed.length}/${sampleCount}`)
  console.log(`Completion count: ${completedCount}`)
  console.log(`Valid count: ${validCount}`)
  console.log(`Failed: ${failedCount}`)
  console.log(
    `Completion rate: ${((completedCount / Math.max(1, completed.length)) * 100).toFixed(1)}%`,
  )
  console.log(
    `Valid rate: ${((validCount / Math.max(1, completed.length)) * 100).toFixed(1)}%`,
  )
  console.log(`Average problem time: ${avgDurationMs.toFixed(1)}ms`)
  console.log(`Average iterations: ${avgIterations.toFixed(0)}`)
  console.log(`Total wall time: ${(benchmarkMs / 1000).toFixed(2)}s`)
  if (completedCount > 0) {
    console.log(
      `Validity among completed: ${((validCount / completedCount) * 100).toFixed(1)}%`,
    )
  }

  if (showStats && completed.length > 0) {
    const average = (pick: (result: Z04SampleResult) => number) =>
      completed.reduce((sum, result) => sum + pick(result), 0) /
      Math.max(1, completed.length)

    console.log()
    console.log("Average grid stats:")
    console.log(`  cells=${average((r) => r.gridStats?.cells ?? 0).toFixed(0)}`)
    console.log(
      `  layers=${average((r) => r.gridStats?.layers ?? 0).toFixed(1)}`,
    )
    console.log(
      `  states=${average((r) => r.gridStats?.states ?? 0).toFixed(0)}`,
    )
    console.log(
      `  neighborEdges=${average((r) => r.gridStats?.neighborEdges ?? 0).toFixed(0)}`,
    )
    console.log(
      `  ripStateBuckets=${average((r) => r.gridStats?.ripStateBuckets ?? 0).toFixed(1)}`,
    )
  }
}
