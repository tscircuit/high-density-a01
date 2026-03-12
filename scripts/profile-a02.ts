import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultA02Params } from "../lib/default-params"
import { HighDensitySolverA02 } from "../lib/HighDensitySolverA02/HighDensitySolverA02"
import repro01 from "../tests/repros/repro01/repro01.json"

const dataset02 = dataset02Json as Dataset02Sample[]
const args = process.argv.slice(2)

const datasetArg = args.find((arg) => arg.startsWith("--dataset02-index="))
const iterationsArg = args.find((arg) => arg.startsWith("--max-iterations="))
const modeArg = args.find((arg) => arg.startsWith("--mode="))
const useRepro = args.includes("--repro01")
const showHelp = args.includes("--help") || args.includes("-h")

if (showHelp) {
  console.log(`
Usage: bun run scripts/profile-a02.ts [options]

Options:
  --dataset02-index=N  Run dataset02 sample N (1-based, default: 1)
  --repro01            Run tests/repros/repro01 instead of dataset02
  --mode=fast|strict   Strict matches repro tuning, fast is benchmark mode
  --max-iterations=N   Solver MAX_ITERATIONS
  --help, -h           Show this help message

Examples:
  bun run scripts/profile-a02.ts
  bun run scripts/profile-a02.ts --dataset02-index=20 --mode=fast
  bun run scripts/profile-a02.ts --repro01 --mode=strict --max-iterations=20000000
`)
  process.exit(0)
}

const sampleIndex = datasetArg
  ? Math.max(0, Number.parseInt(datasetArg.split("=")[1] ?? "1", 10) - 1)
  : 0
const mode = modeArg?.split("=")[1] === "strict" ? "strict" : "fast"
const maxIterations = iterationsArg
  ? Math.max(1, Number.parseInt(iterationsArg.split("=")[1] ?? "10000000", 10))
  : useRepro
    ? 20_000_000
    : 10_000_000

const nodeWithPortPoints = useRepro
  ? repro01.nodeWithPortPoints
  : (() => {
      const sample = dataset02[sampleIndex]
      if (!sample) {
        throw new Error(`dataset02 sample ${sampleIndex + 1} not found`)
      }
      return convertDataset02SampleToNodeWithPortPoints(sample, {
        capacityMeshNodeId: `profile-${sampleIndex + 1}`,
        availableZ: [0, 1],
      })
    })()

const strictMode = mode === "strict"
const solver = new HighDensitySolverA02({
  ...defaultA02Params,
  nodeWithPortPoints,
  enableProfiling: true,
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
solver.MAX_ITERATIONS = maxIterations

const start = performance.now()
solver.solve()
const totalMs = performance.now() - start

const label = useRepro ? "repro01" : `dataset02 sample ${sampleIndex + 1}`

console.log(`Profile: ${label}`)
console.log(`Mode: ${mode}`)
console.log(`Solved: ${solver.solved}`)
console.log(`Failed: ${solver.failed}`)
console.log(`Iterations: ${solver.iterations}`)
console.log(`Routes: ${solver.getOutput().length}`)
console.log(`Total time: ${totalMs.toFixed(1)}ms`)
if (solver.error) {
  console.log(`Error: ${solver.error}`)
}
console.log()
console.log("Grid stats:")
console.log(JSON.stringify(solver.gridStats, null, 2))
console.log()
console.log("Profiling:")
console.log(JSON.stringify(solver.profiling, null, 2))
