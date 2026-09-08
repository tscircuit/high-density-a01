import { expect, test } from "bun:test"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import type { NativeA01SearchKernel } from "../../lib/native-search/NativeA01SearchKernel"
import sample003 from "../dataset01/sample003/sample003.json"

type Internals = { nativeSearchKernel: NativeA01SearchKernel | null }
const kernelOf = (solver: HighDensitySolverA01): NativeA01SearchKernel | null =>
  (solver as unknown as Internals).nativeSearchKernel
const snapshot = (solver: HighDensitySolverA01): object => ({
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  iterations: solver.iterations,
  openSet: solver.openSet,
  active: solver.activeConnection,
  unsolved: solver.unsolvedConnections,
  output: solver.getOutput(),
  visualize: solver.visualize(),
})

test("native pool release preserves completed, failed, MAX and explicit setup-reset solver state", () => {
  for (const mode of ["solved", "max", "empty", "reset"] as const) {
    const node =
      mode === "empty"
        ? {
            capacityMeshNodeId: "one-cell-no-via-zone",
            center: { x: 0, y: 0 },
            width: 0.1,
            height: 0.1,
            availableZ: [0, 1],
            portPoints: [
              { x: 0, y: 0, z: 0, connectionName: "a" },
              { x: 0, y: 0, z: 1, connectionName: "a" },
            ],
          }
        : sample003
    const js = new HighDensitySolverA01({
      ...defaultParams,
      nodeWithPortPoints: structuredClone(node),
    })
    const native = new HighDensitySolverA01({
      ...defaultParams,
      nodeWithPortPoints: structuredClone(node),
      useNativeSearch: true,
    })
    js.step()
    native.step()
    const old = kernelOf(native)!
    expect(old).not.toBeNull()
    if (mode === "max") {
      js.MAX_ITERATIONS = js.iterations + 1
      native.MAX_ITERATIONS = native.iterations + 1
    }
    if (mode === "reset") {
      js._setup()
      native._setup()
      expect(() => old.clear()).toThrow("has been released")
      expect(kernelOf(native)).toBeNull()
    }
    while (!js.solved && !js.failed) {
      js.step()
      native.step()
      expect(snapshot(native)).toEqual(snapshot(js))
    }
    expect(kernelOf(native)).toBeNull()
    expect(() => old.clear()).toThrow("has been released")
    expect(native.nativeSearchActive).toBe(false)
    const final = snapshot(native)
    native.step()
    expect(snapshot(native)).toEqual(final)
  }
})
