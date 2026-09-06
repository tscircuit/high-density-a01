import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { NodeWithPortPoints, PortPoint } from "../lib/types"

test("exact terminal coordinates preserve physical via anchors on both layers", (): void => {
  for (const Solver of [HighDensitySolverA01, HighDensitySolverA03]) {
    for (const reverse of [false, true]) {
      for (const samePosition of [false, true]) {
        for (const endLayer of [1, 0]) {
          const terminals: PortPoint[] = [
            {
              x: 0.03,
              y: 0.04,
              z: 0,
              connectionName: "signal",
              portPointId: "start",
            },
            {
              x: samePosition ? 0.03 : 0.07,
              y: 0.04,
              z: endLayer,
              connectionName: "signal",
              portPointId: "end",
            },
          ]
          if (reverse) terminals.reverse()
          const nodeWithPortPoints: NodeWithPortPoints = {
            capacityMeshNodeId: "exact-terminal-via-anchors",
            center: { x: 0, y: 0 },
            width: 3,
            height: 3,
            availableZ: [0, 1],
            portPoints: terminals,
          }
          const original: NodeWithPortPoints =
            structuredClone(nodeWithPortPoints)
          const solver = new Solver({
            nodeWithPortPoints,
            cellSizeMm: 0.1,
            viaDiameter: 0.3,
          })
          solver.solve()
          expect(solver.solved).toBeTrue()
          expect(solver.failed).toBeFalse()
          const output = solver.getOutput()
          expect(output).toHaveLength(1)
          const route = output[0]!
          expect(route.route[0]).toEqual(terminals[0])
          expect(route.route.at(-1)).toEqual(terminals[1])
          expect(route.vias).toHaveLength(endLayer === 0 ? 0 : 1)
          expect(route.viaDiameter).toBe(0.3)
          let transitionCount: number = 0
          for (let index: number = 1; index < route.route.length; index++) {
            const previous = route.route[index - 1]!
            const current = route.route[index]!
            if (previous.z === current.z) continue
            transitionCount++
            expect({ x: previous.x, y: previous.y }).toEqual({
              x: current.x,
              y: current.y,
            })
            expect(route.vias).toContainEqual({
              x: current.x,
              y: current.y,
            })
          }
          expect(transitionCount).toBe(endLayer === 0 ? 0 : 1)
          for (const via of route.vias) {
            expect(
              route.route.filter(
                (point): boolean => point.x === via.x && point.y === via.y,
              ),
            ).toHaveLength(2)
          }
          expect(solver.getOutput()).toEqual(output)
          expect(nodeWithPortPoints).toEqual(original)
        }
      }
    }
  }
})
