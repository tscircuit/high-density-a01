import { SolverDebugger } from "../components/SolverDebugger"
import sample002 from "../../tests/dataset01/sample002/sample002.json"

export default () => (
  <SolverDebugger
    nodeWithPortPoints={sample002}
    defaultSolverKey="a01"
    debugKey="dataset01-sample002"
  />
)
