import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { HighDensitySolverA01 } from "../../../lib/HighDensitySolverA01/HighDensitySolverA01"
import input from "./orangecrab-terminal-via.json"

// Captured from OrangeCrab-local's native-copper regional routing on
// tscircuit 0.0.3257 / core 0.0.2436 / capacity-autorouter 0.0.1139.
test("A01 routes the OrangeCrab shared terminal sample", async (): Promise<void> => {
  const solver = new HighDensitySolverA01(input)
  solver.solve()
  // Reject the unroutable sample instead of emitting a transition without copper.
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  for (const route of solver.getOutput()) {
    for (let index = 1; index < route.route.length; index++) {
      const start = route.route[index - 1]!
      const end = route.route[index]!
      if (start.z === end.z) continue
      expect(
        route.vias.some((via) =>
          [start, end].some(
            (point) => Math.hypot(via.x - point.x, via.y - point.y) < 1e-6,
          ),
        ),
      ).toBeTrue()
    }
  }
  const graphics = solver.visualize()
  // Show the routed sample without the expanded search box or visited cells.
  await expect(
    getSvgFromGraphicsObject({
      ...graphics,
      rects: [],
      points: graphics.points.filter((point) => point.label),
    }, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
