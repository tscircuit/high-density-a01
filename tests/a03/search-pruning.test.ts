import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { defaultA03Params } from "../../lib/default-params"
import cases from "./search-pruning-cases.json"

test("A03 pruning preserves routes and completion across ordinary and unusual costs", () => {
  // Captured from unoptimized 9b1a206 with the original iteration and rip limits.
  // Include negative and nonfinite costs, where a nonnegative lower bound
  // cannot justify discarding an OPEN destination.
  for (const entry of cases) {
    const layers = entry.layers
    const hyperParameters = Object.fromEntries(
      Object.entries(entry.hyperParameters).map(([key, value]) => [
        key,
        Number(value),
      ]),
    )
    const solver = new HighDensitySolverA03({
      ...defaultA03Params,
      hyperParameters,
      nodeWithPortPoints: {
        capacityMeshNodeId: "numeric-domain",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: Array.from({ length: layers }, (_, i) => i),
        portPoints: [
          { connectionName: "a", x: -1, y: -0.5, z: 0 },
          { connectionName: "a", x: 1, y: 0.5, z: layers - 1 },
          { connectionName: "b", x: -1, y: 0.5, z: 0 },
          { connectionName: "b", x: 1, y: -0.5, z: 0 },
          { connectionName: "c", x: 0, y: -1, z: layers - 1 },
          { connectionName: "c", x: 0, y: 1, z: 0 },
        ],
      },
    })
    solver.solve()
    expect({
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error ?? null,
      iterations: solver.iterations,
      outputSha256: createHash("sha256")
        .update(JSON.stringify(solver.getOutput()))
        .digest("hex"),
    }).toEqual({
      solved: entry.solved,
      failed: entry.failed,
      error: entry.error,
      iterations: entry.iterations,
      outputSha256: entry.outputSha256,
    })
  }
})
