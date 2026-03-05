import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample001 from "../../tests/dataset01/sample001/sample001.json"

const { width, height } = sample001
const borderMargin = 2

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new HighDensitySolverA01({
        ...defaultParams,
        nodeWithPortPoints: sample001,
        cellSizeMm: 0.5,
      })
      solver.setup()
      return solver
    }}
  />
)
