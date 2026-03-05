import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample005 from "../../tests/dataset01/sample005/sample005.json"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new HighDensitySolverA01({
        ...defaultParams,
        nodeWithPortPoints: sample005.nodeWithPortPoints,
      })
      solver.setup()
      return solver
    }}
  />
)
