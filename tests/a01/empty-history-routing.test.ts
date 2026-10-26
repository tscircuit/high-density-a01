import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { findRouteGeometryViolations } from "../../lib/routeGeometryValidation"
import { viaOccupantCacheNode } from "../fixtures/via-occupant-cache-node"

test("A01 screening preserves completed fixture geometry and terminal coverage", (): void => {
  let savedSteps = 0
  for (const node of [
    {
      capacityMeshNodeId: "empty-history-single-route",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "trace", x: -2, y: -1.6, z: 0 },
        { connectionName: "trace", x: 2, y: 1.4, z: 1 },
      ],
    },
    viaOccupantCacheNode,
  ]) {
    for (const shuffleSeed of [0, 1, 2]) {
      const props = {
        nodeWithPortPoints: structuredClone(node),
        cellSizeMm: 0.1,
        traceThickness: 0.1,
        traceMargin: 0.1,
        viaDiameter: 0.3,
        viaMinDistFromBorder: 0.15,
        hyperParameters: { shuffleSeed },
      }
      const screened = new HighDensitySolverA01({
        ...structuredClone(props),
        enableEmptyHistoryOpenPruning: true,
      })
      const original = new HighDensitySolverA01(structuredClone(props))
      screened.solve()
      original.solve()
      expect(original.enableEmptyHistoryOpenPruning).toBeFalse()
      expect(original["emptyHistoryBestPriority"]).toBeUndefined()
      expect(screened.solved).toBeTrue()
      expect(original.solved).toBeTrue()
      expect(screened.getOutput()).toEqual(original.getOutput())
      expect(findRouteGeometryViolations(screened.getOutput())).toEqual(
        findRouteGeometryViolations(original.getOutput()),
      )
      expect(screened.iterations).toBeLessThanOrEqual(original.iterations)
      savedSteps += original.iterations - screened.iterations
      for (const route of screened.getOutput()) {
        for (const point of route.route) {
          expect(
            Number.isFinite(point.x) && Number.isFinite(point.y),
          ).toBeTrue()
          expect(Math.abs(point.x)).toBeLessThanOrEqual(node.width / 2 + 1e-9)
          expect(Math.abs(point.y)).toBeLessThanOrEqual(node.height / 2 + 1e-9)
          expect(node.availableZ!.includes(point.z)).toBeTrue()
        }
      }
    }
  }
  expect(savedSteps).toBeGreaterThan(0)
})
