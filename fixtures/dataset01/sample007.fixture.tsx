import { SolverDebugger } from "../components/SolverDebugger"
import sample007 from "../../tests/dataset01/sample007/sample007.json"

export default () => (
  <SolverDebugger
    nodeWithPortPoints={sample007}
    defaultSolverKey="a08"
    debugKey="dataset01-sample007"
  />
)
