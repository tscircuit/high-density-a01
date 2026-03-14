import { SolverDebugger } from "../components/SolverDebugger"
import sample004 from "../../tests/dataset01/sample004/sample004.json"

export default () => (
  <SolverDebugger
    nodeWithPortPoints={sample004.nodeWithPortPoints}
    defaultSolverKey="a01"
    debugKey="dataset01-sample004"
  />
)
