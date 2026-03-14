import { SolverDebugger } from "../components/SolverDebugger"
import sample001 from "../../tests/dataset01/sample001/sample001.json"

export default () => (
  <SolverDebugger
    nodeWithPortPoints={sample001}
    defaultSolverKey="a01"
    debugKey="dataset01-sample001"
  />
)
