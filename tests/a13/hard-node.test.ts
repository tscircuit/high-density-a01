import { expect, test } from "bun:test"
import { HighDensitySolverA13, findRouteGeometryViolations } from "../../lib"
import node from "../../fixtures/srj18/cmn_4__sub_2_0.json"

test("routes the unchanged SRJ18 hard node at 1x across five ordering seeds", () => {
  const original = structuredClone(node)
  for (const shuffleSeed of [0, 1, 2, 3, 4]) {
    const solver = new HighDensitySolverA13({
      nodeWithPortPoints: node,
      hyperParameters: { shuffleSeed },
    })
    solver.solve()
    expect(solver.solved, `seed ${shuffleSeed}: ${solver.error}`).toBe(true)
    expect(solver.failed).toBe(false)
    const routes = solver.getOutput()
    expect(routes).toHaveLength(26)
    expect(
      findRouteGeometryViolations(
        routes.map((r) => ({
          ...r,
          traceThickness: r.traceThickness + 0.1,
          viaDiameter: r.viaDiameter + 0.1,
        })),
      ),
    ).toEqual([])
    for (const route of routes) {
      const terminals = node.portPoints.filter(
        (p) => p.connectionName === route.connectionName,
      )
      expect(route.route[0]).toMatchObject(terminals[0]!)
      expect(route.route.at(-1)).toMatchObject(terminals[1]!)
      let viaIndex = 0
      for (let i = 0; i < route.route.length; i++) {
        const p = route.route[i]!,
          prev = route.route[i - 1]
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
        expect(Math.abs(p.x - node.center.x)).toBeLessThanOrEqual(
          node.width / 2 + 1e-8,
        )
        expect(Math.abs(p.y - node.center.y)).toBeLessThanOrEqual(
          node.height / 2 + 1e-8,
        )
        if (prev && prev.z !== p.z) {
          expect({ x: p.x, y: p.y }).toEqual({ x: prev.x, y: prev.y })
          expect(route.vias[viaIndex++]).toEqual({ x: p.x, y: p.y })
        }
      }
      expect(viaIndex).toBe(route.vias.length)
    }
    expect(solver.rerouteCount).toBeGreaterThan(0)
  }
  expect(node).toEqual(original)
}, 60_000)
