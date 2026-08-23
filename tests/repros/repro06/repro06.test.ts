import { expect, test } from "bun:test"
import "bun-match-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { defaultA03Params } from "../../../lib/default-params"
import { HighDensitySolverA03 } from "../../../lib/HighDensitySolverA03/HighDensitySolverA03"
import nodeWithPortPoints from "./repro06.json"

test("repro06 original A03 output", async () => {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    traceMargin: 0.1,
    nodeWithPortPoints,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()

  const svg = getSvgFromGraphicsObject(solver.visualize())
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
