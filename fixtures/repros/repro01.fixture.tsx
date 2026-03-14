import { SolverDebugger } from "../components/SolverDebugger"
import repro01 from "../../tests/repros/repro01/repro01.json"

export default function Repro01Fixture() {
  return (
    <SolverDebugger
      nodeWithPortPoints={repro01.nodeWithPortPoints}
      defaultSolverKey="a02"
      debugKey="repro01"
    />
  )
}
