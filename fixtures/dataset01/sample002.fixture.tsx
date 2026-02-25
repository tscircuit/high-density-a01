import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import sample002 from "../../tests/dataset01/sample002/sample002.json"

const { width, height } = sample002
const borderMargin = 2

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new HighDensitySolverA01({
        nodeWithPortPoints: sample002,
        cellSizeMm: 0.1,
        viaDiameter: 0.3,
      })
      return solver
    }}
  />
)
