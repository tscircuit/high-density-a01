export default () =>
  "Temporarily Removed because WASM may be deprecated (uncomment file to enable)"
// import { useState, useEffect } from "react"
// import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
// import {
//   HighDensitySolverA01WasmEngine,
//   initHighDensitySolverWasm,
// } from "../../lib/HighDensitySolverA01WasmEngine/HighDensitySolverA01WasmEngine"
// import sample001 from "../../tests/dataset01/sample001/sample001.json"

// export default () => {
//   const [wasmReady, setWasmReady] = useState(false)

//   useEffect(() => {
//     initHighDensitySolverWasm().then(() => setWasmReady(true))
//   }, [])

//   if (!wasmReady) return <div>Loading WASM solver...</div>

//   return (
//     <GenericSolverDebugger
//       createSolver={() => {
//         const solver = new HighDensitySolverA01WasmEngine({
//           nodeWithPortPoints: sample001,
//           cellSizeMm: 0.5,
//           viaDiameter: 0.3,
//         })
//         return solver
//       }}
//     />
//   )
// }
