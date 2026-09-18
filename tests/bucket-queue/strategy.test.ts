import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { BucketHeap } from "../../lib/HighDensitySolverA01/BucketHeap"
import { defaultParams } from "../../lib/default-params"
import sample from "../dataset01/sample003/sample003.json"

test("binary remains default and bucketed is explicit with generated NaN rejection", () => {
  const params = { ...defaultParams, nodeWithPortPoints: sample }
  const binary: any = new HighDensitySolverA01(params)
  const bucketed: any = new HighDensitySolverA01({
    ...params,
    priorityQueue: "bucketed",
  })
  binary.setup()
  bucketed.setup()
  expect(binary.getConstructorParams()[0].priorityQueue).toBe("binary")
  expect(bucketed.getConstructorParams()[0].priorityQueue).toBe("bucketed")
  expect(binary.heap instanceof BucketHeap).toBe(false)
  expect(bucketed.heap instanceof BucketHeap).toBe(true)
  while (!binary.solved && !binary.failed) binary.step()
  while (!bucketed.solved && !bucketed.failed) bucketed.step()
  expect(bucketed.solved).toBe(binary.solved)
  expect(bucketed.failed).toBe(binary.failed)
  expect(bucketed.error).toBe(binary.error)
  expect(bucketed.iterations).toBe(binary.iterations)
  expect(bucketed.getOutput()).toEqual(binary.getOutput())
  const unsupported: any = new HighDensitySolverA01({
    ...params,
    priorityQueue: "bucketed",
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
