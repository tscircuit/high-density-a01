import { SolverDebugger } from "../components/SolverDebugger"
import sample009 from "../../tests/repros/cmn_39/cmn_39.json"

export default function Sample009Fixture() {
  return (
    <SolverDebugger
      nodeWithPortPoints={sample009}
      defaultSolverKey="a08"
      debugKey="dataset01-sample009"
    />
  )
}
