import { expect, test } from "bun:test"
import { HighDensitySolverA13 } from "../../lib/HighDensitySolverA13/HighDensitySolverA13"
import hardNode from "../../fixtures/srj18/cmn_4__sub_2_0.json"
import otherNode from "../dataset01/sample008/sample008.json"
import { FrozenVersionedSearchKernel } from "../fixtures/FrozenVersionedSearchKernel"

test("A13 frontier positions preserve complete routing and debugger iterations against the original kernel", (): void => {
  for (const node of [hardNode, otherNode]) {
    for (const shuffleSeed of [0, 1, 4]) {
      const props = {
        nodeWithPortPoints: node,
        hyperParameters: { shuffleSeed },
      }
      const actual = new HighDensitySolverA13(props)
      const reference = new HighDensitySolverA13(props)
      actual.setup()
      reference.setup()
      reference["searchKernel"] = new FrozenVersionedSearchKernel(
        reference.cols,
        reference.rows,
        reference["layers"].length,
        reference["pitchX"],
        reference["pitchY"],
      )
      let previousReroutes = -1
      let previousRoutedCount = -1
      while (!reference.solved && !reference.failed) {
        actual.step()
        reference.step()
        for (const field of [
          "solved",
          "failed",
          "error",
          "phase",
          "round",
          "iterations",
          "routingIterations",
          "routedCount",
          "rerouteCount",
          "activeConnectionIndex",
          "conflictCount",
          "bestConflictCount",
          "broadNegotiations",
        ] as const)
          expect(actual[field]).toEqual(reference[field])
        if (
          reference.rerouteCount !== previousReroutes ||
          reference.routedCount !== previousRoutedCount
        ) {
          previousReroutes = reference.rerouteCount
          previousRoutedCount = reference.routedCount
          expect(actual.getOutput()).toEqual(reference.getOutput())
          expect(actual.violations).toEqual(reference.violations)
        }
      }
      expect(actual.solved).toBe(true)
      expect(actual.getOutput()).toEqual(reference.getOutput())
      expect(actual.violations).toEqual(reference.violations)
      expect(actual.stats).toEqual(reference.stats)
    }
  }
}, 60_000)
