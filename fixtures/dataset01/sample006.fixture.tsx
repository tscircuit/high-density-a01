import { SolverDebugger } from "../components/SolverDebugger"
import sample006 from "../../tests/dataset01/sample006/sample006.json"

export default () => (
  <SolverDebugger
    nodeWithPortPoints={sample006.nodeWithPortPoints}
    defaultSolverKey="a08"
    debugKey="dataset01-sample006"
  />
)
