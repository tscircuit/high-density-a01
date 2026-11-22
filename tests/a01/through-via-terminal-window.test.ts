import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import input from "./fixtures/through-via-terminal-window.json"

test("a captured through via clears the neighboring layer terminal", async (): Promise<void> => {
  // Two connection pairs from an observed regional candidate. Geometry,
  // layers, grid and copper sizes are retained; identities and origin change.
  const solver = new HighDensitySolverA01(input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  const routes = solver.getOutput()
  expect(routes).toHaveLength(2)
  const transition = routes.find((route) => route.connectionName === "layer_transition")!
  expect(transition.vias).toHaveLength(1)
  const requiredDistance = (input.viaDiameter + input.traceThickness) / 2 + input.traceMargin
  const blockedTerminals = input.nodeWithPortPoints.portPoints.filter((port) =>
    port.connectionName !== transition.connectionName &&
    transition.vias.some((via) => Math.hypot(port.x - via.x, port.y - via.y) < requiredDistance),
  )
  expect(blockedTerminals).toHaveLength(1)
  await expect(
    getSvgFromGraphicsObject(solver.visualize({ showViaLandings: true }), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
