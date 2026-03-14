import { SolverDebugger } from "../components/SolverDebugger"
import sample005 from "../../tests/dataset01/sample005/sample005.json"

export default () => (
  <SolverDebugger
    nodeWithPortPoints={sample005.nodeWithPortPoints}
    defaultSolverKey="a01"
    debugKey="dataset01-sample005"
  />
)
