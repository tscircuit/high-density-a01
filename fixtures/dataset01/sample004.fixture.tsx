import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample004 from "../../tests/dataset01/sample004/sample004.json"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new HighDensitySolverA01({
        ...defaultParams,
        nodeWithPortPoints: sample004.nodeWithPortPoints,
      })
      return solver
    }}
  />
)
