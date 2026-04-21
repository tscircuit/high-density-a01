import { SolverDebugger } from "../components/SolverDebugger"
import sample009 from "../../tests/dataset01/sample009/sample009.json"

export default function Sample009Fixture() {
  return (
    <SolverDebugger
      nodeWithPortPoints={sample009.nodeWithPortPoints}
      defaultSolverKey="a08"
      debugKey="dataset01-sample009"
    />
  )
}
