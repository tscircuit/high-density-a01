import { SolverDebugger } from "../components/SolverDebugger"
import floatingPortpoints from "./floating-portpoints.json"

export default function FloatingPortpointsFixture() {
  return (
    <SolverDebugger
      nodeWithPortPoints={floatingPortpoints}
      defaultSolverKey="a01"
      debugKey="floating-portpoints"
    />
  )
}
