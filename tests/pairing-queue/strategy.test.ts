import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { PairingHeap } from "../../lib/HighDensitySolverA01/PairingHeap"
import { defaultParams } from "../../lib/default-params"
import sample from "../dataset01/sample003/sample003.json"

test("binary remains default and pairing is explicit with generated NaN rejection", () => {
  const params = { ...defaultParams, nodeWithPortPoints: sample }
  const binary: any = new HighDensitySolverA01(params)
  const pairing: any = new HighDensitySolverA01({
    ...params,
    priorityQueue: "pairing",
  })
  binary.setup()
  pairing.setup()
  expect(binary.getConstructorParams()[0].priorityQueue).toBe("binary")
  expect(pairing.getConstructorParams()[0].priorityQueue).toBe("pairing")
  expect(binary.heap instanceof PairingHeap).toBe(false)
  expect(pairing.heap instanceof PairingHeap).toBe(true)
  while (!binary.solved && !binary.failed) binary.step()
  while (!pairing.solved && !pairing.failed) pairing.step()
  expect(pairing.solved).toBe(binary.solved)
  expect(pairing.failed).toBe(binary.failed)
  expect(pairing.error).toBe(binary.error)
  expect(pairing.iterations).toBe(binary.iterations)
  expect(pairing.getOutput()).toEqual(binary.getOutput())
  const unsupported: any = new HighDensitySolverA01({
    ...params,
    priorityQueue: "pairing",
    hyperParameters: { greedyMultiplier: NaN },
  })
  unsupported.setup()
  expect(() => unsupported._step()).toThrow("requires non-NaN priorities")
  expect(unsupported.heap.size).toBe(0)
  const legacy: any = new HighDensitySolverA01({
    ...params,
    hyperParameters: { greedyMultiplier: NaN },
  })
  legacy.setup()
  expect(() => legacy._step()).not.toThrow()
})
