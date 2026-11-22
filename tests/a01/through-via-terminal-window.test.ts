import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import input from "./fixtures/through-via-terminal-window.json"

test("the complete captured region exposes through vias covering foreign terminals", async (): Promise<void> => {
  // Unreduced 52-terminal candidate captured from a physical regional repair.
  const solver = new HighDensitySolverA01(input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  const routes = solver.getOutput()
  expect(routes).toHaveLength(26)
  const requiredDistance = (input.viaDiameter + input.traceThickness) / 2 + input.traceMargin
  const blockedTerminals = routes.flatMap((route) =>
    input.nodeWithPortPoints.portPoints.filter(
      (port) =>
        port.rootConnectionName !== route.rootConnectionName &&
        route.vias.some(
          (via) => Math.hypot(port.x - via.x, port.y - via.y) < requiredDistance,
        ),
    ),
  )
  expect(blockedTerminals).toHaveLength(4)
  await expect(
    getSvgFromGraphicsObject(solver.visualize({ showViaLandings: true }), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
