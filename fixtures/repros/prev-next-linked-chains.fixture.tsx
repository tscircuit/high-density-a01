import { SolverDebugger } from "../components/SolverDebugger"
import prevNextLinkedChains from "../../tests/prev-next/prev-next.json"

export default () => (
  <SolverDebugger
    nodeWithPortPoints={prevNextLinkedChains}
    defaultSolverKey="a01"
    solverPropOverrides={{
      a01: {
        cellSizeMm: 0.25,
      },
      a02: {
        outerGridCellSize: 0.25,
        innerGridCellSize: 0.5,
      },
      a03: {
        highResolutionCellSize: 0.25,
        lowResolutionCellSize: 0.5,
      },
      a05: {
        highResolutionCellSize: 0.25,
        lowResolutionCellSize: 0.5,
      },
      a08: {
        cellSizeMm: 0.25,
      },
      a09: {
        highResolutionCellSize: 0.25,
        lowResolutionCellSize: 0.5,
      },
    }}
    debugKey="prev-next-linked-chains"
    maxIterations={1_000_000}
  />
)
