import { mkdir, readdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { defaultA05Params } from "../lib/default-params"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { HighDensitySolverA05 } from "../lib/HighDensitySolverA05/HighDensitySolverA05"
import { findSameLayerIntersections } from "../tests/fixtures/validateNoIntersections"

const dataset02 = dataset02Json as Dataset02Sample[]

type SolverMode = "default" | "repro"

type BenchmarkOptions = {
  limit?: number
  sample?: number
  mode: SolverMode
  maxIterations: number
  ripCost?: number
  greedyMultiplier?: number
  borderPenaltyStrength?: number
  borderPenaltyFalloff?: number
}

type SampleMetrics = {
  sampleNumber: number
  status: "success" | "failed"
  completionRate: number
  drcIssues: number
  durationMs: number
  iterations: number
  routes: number
  expectedRoutes: number
  solved: boolean
  failed: boolean
  error: string | null
  sampleDir?: string
  artifacts: string[]
}

const HELP_TEXT = `
Usage: ./benchmark.sh [options]

Runs the dataset02 benchmark for HighDensitySolverA05 and writes artifacts under
./results/runNNN/.

Options:
  --help, -h                    Show this help message
  --limit N                     Run the first N samples from dataset02
  --sample NUM                  Run a specific 1-based sample number
  --mode default|repro          Solver tuning preset (default: default)
  --max-iterations N            Solver MAX_ITERATIONS (default: 10000000)
  --rip-cost N                  Override hyperParameters.ripCost
  --greedy-multiplier N         Override hyperParameters.greedyMultiplier
  --border-penalty-strength N   Override A05 border penalty strength
  --border-penalty-falloff N    Override A05 border penalty falloff

Examples:
  ./benchmark.sh
  ./benchmark.sh --limit 20
  ./benchmark.sh --sample 17
  ./benchmark.sh --limit 20 --mode repro
  ./benchmark.sh --rip-cost 8 --greedy-multiplier 1.5
`.trim()

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseArgs(argv: string[]): BenchmarkOptions | null {
  let limit: number | undefined
  let sample: number | undefined
  let mode: SolverMode = "default"
  let maxIterations = 10_000_000
  let ripCost: number | undefined
  let greedyMultiplier: number | undefined
  let borderPenaltyStrength: number | undefined
  let borderPenaltyFalloff: number | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    const takeValue = () => {
      const next = argv[index + 1]
      if (next === undefined) {
        throw new Error(`Missing value for ${arg}`)
      }
      index += 1
      return next
    }

    if (arg === "--help" || arg === "-h") {
      console.log(HELP_TEXT)
      return null
    }

    if (arg === "--limit") {
      const parsed = Number.parseInt(takeValue(), 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--limit must be a positive integer")
      }
      limit = parsed
      continue
    }

    if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(arg.slice("--limit=".length), 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--limit must be a positive integer")
      }
      limit = parsed
      continue
    }

    if (arg === "--sample") {
      const parsed = Number.parseInt(takeValue(), 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--sample must be a positive integer")
      }
      sample = parsed
      continue
    }

    if (arg.startsWith("--sample=")) {
      const parsed = Number.parseInt(arg.slice("--sample=".length), 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--sample must be a positive integer")
      }
      sample = parsed
      continue
    }

    if (arg === "--mode") {
      const value = takeValue()
      mode = value === "repro" ? "repro" : "default"
      continue
    }

    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length)
      mode = value === "repro" ? "repro" : "default"
      continue
    }

    if (arg === "--max-iterations") {
      const parsed = Number.parseInt(takeValue(), 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--max-iterations must be a positive integer")
      }
      maxIterations = parsed
      continue
    }

    if (arg.startsWith("--max-iterations=")) {
      const parsed = Number.parseInt(arg.slice("--max-iterations=".length), 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--max-iterations must be a positive integer")
      }
      maxIterations = parsed
      continue
    }

    if (arg === "--rip-cost") {
      ripCost = parseOptionalNumber(takeValue())
      continue
    }

    if (arg.startsWith("--rip-cost=")) {
      ripCost = parseOptionalNumber(arg.slice("--rip-cost=".length))
      continue
    }

    if (arg === "--greedy-multiplier") {
      greedyMultiplier = parseOptionalNumber(takeValue())
      continue
    }

    if (arg.startsWith("--greedy-multiplier=")) {
      greedyMultiplier = parseOptionalNumber(
        arg.slice("--greedy-multiplier=".length),
      )
      continue
    }

    if (arg === "--border-penalty-strength") {
      borderPenaltyStrength = parseOptionalNumber(takeValue())
      continue
    }

    if (arg.startsWith("--border-penalty-strength=")) {
      borderPenaltyStrength = parseOptionalNumber(
        arg.slice("--border-penalty-strength=".length),
      )
      continue
    }

    if (arg === "--border-penalty-falloff") {
      borderPenaltyFalloff = parseOptionalNumber(takeValue())
      continue
    }

    if (arg.startsWith("--border-penalty-falloff=")) {
      borderPenaltyFalloff = parseOptionalNumber(
        arg.slice("--border-penalty-falloff=".length),
      )
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return {
    limit,
    sample,
    mode,
    maxIterations,
    ripCost,
    greedyMultiplier,
    borderPenaltyStrength,
    borderPenaltyFalloff,
  }
}

function toSampleLabel(sampleNumber: number) {
  return `sample${sampleNumber.toString().padStart(3, "0")}`
}

async function createRunDirectory() {
  const resultsDir = resolve("results")
  await mkdir(resultsDir, { recursive: true })

  const entries = await readdir(resultsDir, { withFileTypes: true })
  let highestRunNumber = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const match = /^run(\d+)$/.exec(entry.name)
    if (!match) continue
    const parsed = Number.parseInt(match[1]!, 10)
    if (Number.isFinite(parsed)) {
      highestRunNumber = Math.max(highestRunNumber, parsed)
    }
  }

  const runNumber = highestRunNumber + 1
  const runLabel = `run${runNumber.toString().padStart(3, "0")}`
  const runDir = join(resultsDir, runLabel)
  await mkdir(runDir, { recursive: true })

  return { runNumber, runLabel, runDir }
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  )
  return sorted[index]!
}

async function tryWritePngFromSvg(svgPath: string, pngPath: string) {
  const outputDir = dirname(svgPath)
  const proc = Bun.spawnSync(
    ["qlmanage", "-t", "-s", "2048", "-o", outputDir, svgPath],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  if (proc.exitCode !== 0) {
    return null
  }

  const renderedPngPath = `${svgPath}.png`
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const pngFile = Bun.file(renderedPngPath)
      if ((await pngFile.exists()) === true) {
        const pngBuffer = await pngFile.arrayBuffer()
        await Bun.write(pngPath, pngBuffer)
        return pngPath
      }
    } catch {
      // Keep polling briefly; qlmanage can report success before the file is readable.
    }

    await Bun.sleep(50)
  }

  return null
}

async function runSample(
  sample: Dataset02Sample,
  sampleNumber: number,
  options: BenchmarkOptions,
  runDir: string,
) {
  const sampleLabel = toSampleLabel(sampleNumber)

  const nodeWithPortPoints = convertDataset02SampleToNodeWithPortPoints(
    sample,
    {
      capacityMeshNodeId: `dataset02-${sampleNumber}`,
      availableZ: [0, 1],
    },
  )

  const hyperParameters = {
    ...(options.mode === "repro"
      ? {
          ripCost: 1,
          greedyMultiplier: 1.2,
        }
      : {}),
    ...(options.ripCost === undefined ? {} : { ripCost: options.ripCost }),
    ...(options.greedyMultiplier === undefined
      ? {}
      : { greedyMultiplier: options.greedyMultiplier }),
  }

  const solver = new HighDensitySolverA05({
    ...defaultA05Params,
    nodeWithPortPoints,
    ...(options.borderPenaltyStrength === undefined
      ? {}
      : { borderPenaltyStrength: options.borderPenaltyStrength }),
    ...(options.borderPenaltyFalloff === undefined
      ? {}
      : { borderPenaltyFalloff: options.borderPenaltyFalloff }),
    hyperParameters:
      Object.keys(hyperParameters).length > 0 ? hyperParameters : undefined,
  })
  solver.MAX_ITERATIONS = options.maxIterations

  const start = performance.now()
  solver.solve()
  const durationMs = performance.now() - start

  const routes = solver.getOutput()
  const drcIssues = findSameLayerIntersections(routes).length
  const expectedRoutes = sample.connections.length
  const completionRate =
    expectedRoutes > 0 ? (routes.length / expectedRoutes) * 100 : 100

  let sampleDir: string | undefined
  const artifacts: string[] = []
  const shouldWriteArtifacts = solver.failed || drcIssues > 0

  if (shouldWriteArtifacts) {
    sampleDir = join(runDir, sampleLabel)
    await mkdir(sampleDir, { recursive: true })

    const graphics = solver.visualize()
    const svgPath = join(sampleDir, "pcb.svg")
    await Bun.write(svgPath, getSvgFromGraphicsObject(graphics))

    const pngPath = join(sampleDir, "pcb.png")
    const writtenPngPath = await tryWritePngFromSvg(svgPath, pngPath)

    const sampleLog = [
      `sample=${sampleLabel}`,
      `status=${solver.solved && !solver.failed ? "success" : "failed"}`,
      `solved=${solver.solved}`,
      `failed=${solver.failed}`,
      `error=${solver.error ?? ""}`,
      `routes=${routes.length}`,
      `expectedRoutes=${expectedRoutes}`,
      `completionRate=${completionRate.toFixed(1)}%`,
      `drcIssues=${drcIssues}`,
      `iterations=${solver.iterations}`,
      `duration=${(durationMs / 1000).toFixed(3)}s`,
    ].join("\n")
    const logsPath = join(sampleDir, "logs.txt")
    await Bun.write(logsPath, `${sampleLog}\n`)

    const metrics = {
      sample: sampleLabel,
      sampleNumber,
      status: solver.solved && !solver.failed ? "success" : "failed",
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
      routes: routes.length,
      expectedRoutes,
      completionRate,
      drcIssues,
      iterations: solver.iterations,
      durationMs,
      sampleConfig: sample.config,
    }
    const metricsPath = join(sampleDir, "metrics.json")
    await Bun.write(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`)

    artifacts.push(logsPath)
    if (writtenPngPath) {
      artifacts.push(writtenPngPath)
    } else {
      artifacts.push(svgPath)
    }
  }

  return {
    sampleNumber,
    status: solver.solved && !solver.failed ? "success" : "failed",
    completionRate,
    drcIssues,
    durationMs,
    iterations: solver.iterations,
    routes: routes.length,
    expectedRoutes,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    sampleDir,
    artifacts,
  } satisfies SampleMetrics
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options === null) return

  const requestedSamples =
    options.sample !== undefined
      ? [
          {
            sample: dataset02[options.sample - 1],
            sampleNumber: options.sample,
          },
        ]
      : dataset02
          .slice(0, options.limit ?? dataset02.length)
          .map((sample, index) => ({ sample, sampleNumber: index + 1 }))

  if (requestedSamples.length === 0) {
    throw new Error("No samples selected.")
  }

  const missingSample = requestedSamples.find(({ sample }) => !sample)
  if (missingSample) {
    throw new Error(
      `Sample ${missingSample.sampleNumber} not found in dataset02`,
    )
  }

  const { runLabel, runDir } = await createRunDirectory()
  const startedAt = new Date().toISOString()

  console.log(`benchmark run: ${runLabel}`)
  console.log(`results dir: ${runDir}`)
  console.log(`samples: ${requestedSamples.length}`)
  console.log(`mode: ${options.mode}`)
  console.log(`maxIterations: ${options.maxIterations}`)
  console.log()

  const runStart = performance.now()
  const sampleLines: string[] = []
  const results: SampleMetrics[] = []

  for (const entry of requestedSamples) {
    const result = await runSample(
      entry.sample!,
      entry.sampleNumber,
      options,
      runDir,
    )
    results.push(result)

    const line =
      `${toSampleLabel(result.sampleNumber).padEnd(9)} ` +
      `${result.status.padEnd(7)} ` +
      `cm=${result.completionRate.toFixed(1).padStart(6)}% ` +
      `drcIssues=${String(result.drcIssues).padStart(2, "0")} ` +
      `duration=${(result.durationMs / 1000).toFixed(3).padStart(7)}s`

    console.log(line)
    if (result.artifacts.length > 0) {
      console.log(`# wrote ${result.artifacts.join(" ")}`)
    }
    sampleLines.push(line)
  }

  const totalDurationMs = performance.now() - runStart
  const durations = results.map((result) => result.durationMs / 1000)
  const successCount = results.filter(
    (result) => result.status === "success",
  ).length
  const drcValues = results.map((result) => result.drcIssues)
  const zeroDrcCount = drcValues.filter((value) => value === 0).length
  const avgDrcIssues =
    drcValues.reduce((sum, value) => sum + value, 0) /
    Math.max(1, drcValues.length)
  const avgDuration =
    durations.reduce((sum, value) => sum + value, 0) /
    Math.max(1, durations.length)
  const p50Duration = percentile(durations, 0.5)
  const p95Duration = percentile(durations, 0.95)

  const summaryLines = [
    `success rate: ${((successCount / Math.max(1, results.length)) * 100).toFixed(1)}%`,
    `avg DRC issues: ${avgDrcIssues.toFixed(2)}`,
    `zero-DRC rate: ${((zeroDrcCount / Math.max(1, results.length)) * 100).toFixed(1)}%`,
    `avg duration: ${avgDuration.toFixed(3)}s`,
    `P50 duration: ${p50Duration.toFixed(3)}s`,
    `P95 duration: ${p95Duration.toFixed(3)}s`,
    `total duration: ${(totalDurationMs / 1000).toFixed(3)}s`,
  ]

  const runLog = [
    `run=${runLabel}`,
    `startedAt=${startedAt}`,
    `dataset=dataset02`,
    `solver=HighDensitySolverA05`,
    `sampleCount=${requestedSamples.length}`,
    `mode=${options.mode}`,
    `maxIterations=${options.maxIterations}`,
    ...(options.limit === undefined ? [] : [`limit=${options.limit}`]),
    ...(options.sample === undefined ? [] : [`sample=${options.sample}`]),
    ...(options.ripCost === undefined ? [] : [`ripCost=${options.ripCost}`]),
    ...(options.greedyMultiplier === undefined
      ? []
      : [`greedyMultiplier=${options.greedyMultiplier}`]),
    ...(options.borderPenaltyStrength === undefined
      ? []
      : [`borderPenaltyStrength=${options.borderPenaltyStrength}`]),
    ...(options.borderPenaltyFalloff === undefined
      ? []
      : [`borderPenaltyFalloff=${options.borderPenaltyFalloff}`]),
    "",
    ...sampleLines,
    "",
    ...summaryLines,
  ].join("\n")

  await Bun.write(join(runDir, "logs.txt"), `${runLog}\n`)
  await Bun.write(
    join(runDir, "summary.json"),
    `${JSON.stringify(
      {
        run: runLabel,
        dataset: "dataset02",
        solver: "HighDensitySolverA05",
        sampleCount: requestedSamples.length,
        startedAt,
        options,
        summary: {
          successRate: successCount / Math.max(1, results.length),
          avgDrcIssues,
          zeroDrcRate: zeroDrcCount / Math.max(1, results.length),
          avgDurationSeconds: avgDuration,
          p50DurationSeconds: p50Duration,
          p95DurationSeconds: p95Duration,
          totalDurationSeconds: totalDurationMs / 1000,
        },
      },
      null,
      2,
    )}\n`,
  )

  console.log()
  for (const line of summaryLines) {
    console.log(line)
  }
}

await main()
