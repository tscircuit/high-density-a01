import { expect, setDefaultTimeout, test } from "bun:test"
import { defaultA07Params } from "../../lib/default-params"
import { HighDensitySolverA07 } from "../../lib/HighDensitySolverA07/HighDensitySolverA07"
import { validateRouteGeometry } from "../../lib/routeGeometry"
import { bugreport46ArduinoUnoEntries } from "../../fixtures/bugreport46-ac4337-arduino-uno/bugreport46-ac4337-arduino-uno"

setDefaultTimeout(120_000)

test("A07 solves the cmn_8 Arduino Uno failure case", () => {
  const entry = bugreport46ArduinoUnoEntries.find(
    (candidate) => candidate.capacityMeshNodeId === "cmn_8",
  )
  if (!entry) {
    throw new Error("cmn_8 fixture is missing")
  }

  const solver = new HighDensitySolverA07({
    ...defaultA07Params,
    nodeWithPortPoints: entry.nodeWithPortPoints,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.error).toBeNull()

  const routes = solver.getOutput()
  expect(routes).toHaveLength(13)
  validateRouteGeometry(routes)
})

