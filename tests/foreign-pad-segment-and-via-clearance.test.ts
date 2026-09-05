import { expect, test } from "bun:test"
import { ObstacleChecker } from "../lib/ObstacleChecker"

test("obstacle checks cover full segments, via radius, and intermediate layers", (): void => {
  const checker = new ObstacleChecker(
    [
      {
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        zLayers: [1],
        connectedTo: ["ground-pad"],
      },
    ],
    {
      areIdsConnected: (a, b): boolean => a === "ground" && b === "ground-pad",
    },
  )
  expect(
    checker.isBlocked(
      { x: -1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      "signal",
      "signal",
      0.1,
    ),
  ).toBeTrue()
  expect(
    checker.isBlocked(
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      "signal",
      "signal",
      0.1,
    ),
  ).toBeFalse()
  expect(
    checker.isBlocked(
      { x: 0.7, y: 0, z: 0 },
      { x: 0.7, y: 0, z: 3 },
      "signal",
      "signal",
      0.25,
    ),
  ).toBeTrue()
  expect(
    checker.isBlocked(
      { x: 0.8, y: 0, z: 0 },
      { x: 0.8, y: 0, z: 3 },
      "signal",
      "signal",
      0.25,
    ),
  ).toBeFalse()
  expect(
    checker.isBlocked(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 3 },
      "branch",
      "ground",
      0.25,
    ),
  ).toBeFalse()
})
