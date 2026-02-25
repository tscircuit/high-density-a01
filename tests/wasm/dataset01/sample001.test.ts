import { test, expect, setDefaultTimeout } from "bun:test"

setDefaultTimeout(120_000)
import "bun-match-svg"
import "graphics-debug/matcher"
import {
  HighDensitySolverA01WasmEngine,
  initHighDensitySolverWasm,
} from "../../../lib/HighDensitySolverA01WasmEngine/HighDensitySolverA01WasmEngine"
import sample001 from "../../dataset01/sample001/sample001.json"
import {
  findSameLayerIntersections,
  validateNoIntersections,
} from "../../fixtures/validateNoIntersections"

async function createSolver() {
  await initHighDensitySolverWasm()

  const solver = new HighDensitySolverA01WasmEngine({
    nodeWithPortPoints: sample001,
    cellSizeMm: 0.5,
    viaDiameter: 0.3,
  })
  solver.MAX_ITERATIONS = 1_000_000
  solver.solve()
  return solver
}

test("wasm sample001 solve", async () => {
  const solver = await createSolver()

  console.log(
    `solved=${solver.solved} failed=${solver.failed} iterations=${solver.iterations} error=${solver.error}`,
  )

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const routes = solver.getOutput()
  expect(routes.length).toBeGreaterThan(0)

  console.log(`routes=${routes.length}`)

  const graphics = solver.visualize()

  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
})

test(
  "wasm sample001 no same-layer intersections",
  async () => {
    const solver = await createSolver()
    const routes = solver.getOutput()

    const intersections = findSameLayerIntersections(routes)
    if (intersections.length > 0) {
      console.log("Found intersections:")
      for (const ix of intersections) {
        console.log(
          `  ${ix.trace1} x ${ix.trace2} on z=${ix.z} at (${ix.point.x.toFixed(3)}, ${ix.point.y.toFixed(3)})`,
        )
      }
    }

    validateNoIntersections(routes)
  },
)
