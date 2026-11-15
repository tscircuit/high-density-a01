import { expect, test } from "bun:test"
import { defaultA03Params } from "../../lib/default-params"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import node from "../dataset01/sample003/sample003.json"

test("owner-run mode is opt-in and rebuilds after route commits and setup", () => {
  const dense: any = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: node,
  })
  expect(dense.viaOccupantQuery).toBe("dense")
  dense.setup()
  dense.step()
  expect(dense.orderedOwnerRows).toBe(null)
  const indexed: any = new HighDensitySolverA03({
    ...defaultA03Params,
    nodeWithPortPoints: node,
    viaOccupantQuery: "owner-runs",
  })
  expect(indexed.getConstructorParams()[0].viaOccupantQuery).toBe("owner-runs")
  indexed.setup()
  expect(indexed.orderedOwnerRows).toBe(null)
  indexed.step()
  const first = indexed.orderedOwnerRows
  expect(first).not.toBe(null)
  while (indexed.activeConnSeg && !indexed.failed) indexed.step()
  expect(indexed.failed).toBe(false)
  expect(indexed.orderedOwnerRows).toBe(null)
  indexed.step()
  expect(indexed.orderedOwnerRows).not.toBe(null)
  expect(indexed.orderedOwnerRows).not.toBe(first)
  indexed.viaOccupantQuery = "dense"
  indexed._setup()
  expect(indexed.orderedOwnerRows).toBe(null)
  indexed.step()
  expect(indexed.orderedOwnerRows).toBe(null)
})
