import { SolverDebugger } from "../components/SolverDebugger"
import sample008 from "../../tests/dataset01/sample008/sample008.json"

export default () => (
  <SolverDebugger
    nodeWithPortPoints={sample008}
    defaultSolverKey="a08"
    debugKey="dataset01-sample008"
  />
)
