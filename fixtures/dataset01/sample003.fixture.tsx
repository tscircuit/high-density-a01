import { SolverDebugger } from "../components/SolverDebugger"
import sample003 from "../../tests/dataset01/sample003/sample003.json"

export default () => (
  <SolverDebugger
    nodeWithPortPoints={sample003}
    defaultSolverKey="a01"
    debugKey="dataset01-sample003"
  />
)
