import { SolverDebugger } from "../components/SolverDebugger"
import sample007 from "../../tests/dataset01/sample007/sample007.json"

const sample007SolverOverrides = {
  cellSizeMm: sample007.cellSizeMm,
  viaDiameter: sample007.viaDiameter,
  viaMinDistFromBorder: sample007.viaMinDistFromBorder,
  traceMargin: sample007.traceMargin,
  traceThickness: sample007.traceThickness,
  effort: sample007.effort,
  hyperParameters: sample007.hyperParameters,
}

export default () => (
  <SolverDebugger
    nodeWithPortPoints={sample007.nodeWithPortPoints}
    defaultSolverKey="a01"
    solverKeys={["a01", "a08"] as const}
    solverPropOverrides={{
      a01: sample007SolverOverrides,
      a08: sample007SolverOverrides,
    }}
    debugKey="dataset01-sample007"
    maxIterations={100_000_000}
  />
)
