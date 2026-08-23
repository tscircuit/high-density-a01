import { expect, test } from "bun:test"
import { defaultA03Params } from "../../../lib/default-params"
import { HighDensitySolverA03 } from "../../../lib/HighDensitySolverA03/HighDensitySolverA03"
import nodeWithPortPoints from "./repro06.json"

const POSITION_EPSILON = 1e-6

test("A03 preserves terminal layers when trimming shared port cells", () => {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    traceMargin: 0.1,
    nodeWithPortPoints,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const route = solver
    .getOutput()
    .find(
      (candidate) => candidate.connectionName === "pipeline9_preloaded_drc_8",
    )
  expect(route).toBeDefined()
  expect(route!.route[0]?.z).toBe(0)
  expect(route!.route.at(-1)?.z).toBe(0)

  for (let index = 1; index < route!.route.length; index++) {
    const previousPoint = route!.route[index - 1]!
    const routePoint = route!.route[index]!
    if (previousPoint.z === routePoint.z) continue

    expect(Math.abs(previousPoint.x - routePoint.x)).toBeLessThanOrEqual(
      POSITION_EPSILON,
    )
    expect(Math.abs(previousPoint.y - routePoint.y)).toBeLessThanOrEqual(
      POSITION_EPSILON,
    )
    expect(
      route!.vias.some(
        (via) =>
          Math.abs(via.x - routePoint.x) <= POSITION_EPSILON &&
          Math.abs(via.y - routePoint.y) <= POSITION_EPSILON,
      ),
    ).toBeTrue()
  }
})
