import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import repro01 from "../../tests/repros/repro01/repro01.json"

export default function Repro01Fixture() {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        const solver = new HighDensitySolverA01({
          ...defaultParams,
          nodeWithPortPoints: repro01.nodeWithPortPoints,
        })
        solver.MAX_ITERATIONS = 10_000_000
        solver.setup()
        return solver
      }}
    />
  )
}
