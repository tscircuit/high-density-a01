import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { defaultA02Params } from "../../lib/default-params"
import { HighDensitySolverA02 } from "../../lib/HighDensitySolverA02/HighDensitySolverA02"
import repro01 from "../../tests/repros/repro01/repro01.json"

export default function Repro01Fixture() {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        const solver = new HighDensitySolverA02({
          ...defaultA02Params,
          nodeWithPortPoints: repro01.nodeWithPortPoints,
        })
        solver.MAX_ITERATIONS = 10_000_000
        solver.setup()
        return solver
      }}
    />
  )
}
