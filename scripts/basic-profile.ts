import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
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
    maxIterations: 1_000_000,
  },
]

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
    `${sample.name}: solve=${elapsedMs.toFixed(2)}ms solved=${solver.solved} failed=${solver.failed} iterations=${solver.iterations}`,
  )
}
