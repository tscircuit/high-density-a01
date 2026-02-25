import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
// import {
//   HighDensitySolverA01WasmEngine,
//   initHighDensitySolverWasm,
// } from "../lib/HighDensitySolverA01WasmEngine/HighDensitySolverA01WasmEngine"
import sample001 from "../tests/dataset01/sample001/sample001.json"

type ProfileSample = {
  name: string
  nodeWithPortPoints: typeof sample001
  cellSizeMm: number
  viaDiameter: number
  maxIterations: number
}

const profileSamples: ProfileSample[] = [
  {
    name: "sample001",
    nodeWithPortPoints: sample001,
    cellSizeMm: 0.5,
    viaDiameter: 0.3,
    maxIterations: 100_000_000,
  },
]

// --- TypeScript solver ---
for (const sample of profileSamples) {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: sample.nodeWithPortPoints,
    cellSizeMm: sample.cellSizeMm,
    viaDiameter: sample.viaDiameter,
  })

  solver.MAX_ITERATIONS = sample.maxIterations

  const start = performance.now()
  solver.solve()
  const elapsedMs = performance.now() - start

  console.log(
    `[TS]   ${sample.name}: solve=${elapsedMs.toFixed(2)}ms solved=${solver.solved} failed=${solver.failed} iterations=${solver.iterations}`,
  )
}

// --- WASM solver ---
// await initHighDensitySolverWasm()

// for (const sample of profileSamples) {
//   const solver = new HighDensitySolverA01WasmEngine({
//     nodeWithPortPoints: sample.nodeWithPortPoints,
//     cellSizeMm: sample.cellSizeMm,
//     viaDiameter: sample.viaDiameter,
//   })

//   solver.MAX_ITERATIONS = sample.maxIterations

//   const start = performance.now()
//   solver.solve()
//   const elapsedMs = performance.now() - start

//   console.log(
//     `[WASM] ${sample.name}: solve=${elapsedMs.toFixed(2)}ms solved=${solver.solved} failed=${solver.failed} iterations=${solver.iterations}`,
//   )
// }
