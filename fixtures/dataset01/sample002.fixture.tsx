import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample002 from "../../tests/dataset01/sample002/sample002.json"

const { width, height } = sample002
const borderMargin = 2

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new HighDensitySolverA01({
        ...defaultParams,
        nodeWithPortPoints: sample002,
      })
      solver.setup()
      return solver
    }}
  />
)
