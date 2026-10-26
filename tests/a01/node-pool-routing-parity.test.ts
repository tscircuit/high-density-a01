import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { getA01SearchTrace } from "../fixtures/getA01SearchTrace"

// Frozen from unmodified 10cdce5a: exact queued entries, pop order, work, rips and output.
const originalTraces = [
  {
    "shuffleSeed": 0,
    "stepMultiplier": 1,
    "result": {
      "traceHash": "15699570a30e3e45a09fde6e6a792da6371dead5d049f30e336d3416181b63a7",
      "outputHash": "f17f095e7696aba343035efbc778f98a57c2ef49dcd0f49fb006933c7d31ba78",
      "iterations": 1094,
      "queuedNodes": 2852,
      "poppedNodes": 1089,
      "searchCount": 4,
      "ripEvents": 0,
      "solved": true,
      "failed": false,
      "error": null
    }
  },
  {
    "shuffleSeed": 1,
    "stepMultiplier": 1,
    "result": {
      "traceHash": "e38b3857109ad0dd9bf216e36af745c033847710ef5db34fe9dabe6ecfadb7df",
      "outputHash": "e43594e6c44d9dfdb0e70926f3ab0daee777f092e8c06695870ac6238e72ba00",
      "iterations": 4374,
      "queuedNodes": 6619,
      "poppedNodes": 4367,
      "searchCount": 6,
      "ripEvents": 2,
      "solved": true,
      "failed": false,
      "error": null
    }
  },
  {
    "shuffleSeed": 2,
    "stepMultiplier": 1,
    "result": {
      "traceHash": "5d5da401de5a98637e24c500f0853a6d6909e51d4e5e46aa211adb445308c622",
      "outputHash": "c685e27fbb22d71f1123932af14608869c31b35c8e8c96e508c017138fc65412",
      "iterations": 4493,
      "queuedNodes": 6746,
      "poppedNodes": 4486,
      "searchCount": 6,
      "ripEvents": 2,
      "solved": true,
      "failed": false,
      "error": null
    }
  },
  {
    "shuffleSeed": 0,
    "stepMultiplier": 37,
    "result": {
      "traceHash": "9b4c44644e0c1410b178f8a026592db8073357aaf8a53941dd8c72479bc42e24",
      "outputHash": "f17f095e7696aba343035efbc778f98a57c2ef49dcd0f49fb006933c7d31ba78",
      "iterations": 30,
      "queuedNodes": 2852,
      "poppedNodes": 1089,
      "searchCount": 4,
      "ripEvents": 0,
      "solved": true,
      "failed": false,
      "error": null
    }
  },
  {
    "shuffleSeed": 1,
    "stepMultiplier": 37,
    "result": {
      "traceHash": "62b04c96967c186298a57460453676ff18579bd7a3cb07bf9dbdb38396594ece",
      "outputHash": "e43594e6c44d9dfdb0e70926f3ab0daee777f092e8c06695870ac6238e72ba00",
      "iterations": 119,
      "queuedNodes": 6619,
      "poppedNodes": 4367,
      "searchCount": 6,
      "ripEvents": 2,
      "solved": true,
      "failed": false,
      "error": null
    }
  },
  {
    "shuffleSeed": 2,
    "stepMultiplier": 37,
    "result": {
      "traceHash": "b6d74c08d88db6556cfb0a519d30f00ebf9caae49a0e6052da54608210c5e41d",
      "outputHash": "c685e27fbb22d71f1123932af14608869c31b35c8e8c96e508c017138fc65412",
      "iterations": 122,
      "queuedNodes": 6746,
      "poppedNodes": 4486,
      "searchCount": 6,
      "ripEvents": 2,
      "solved": true,
      "failed": false,
      "error": null
    }
  }
]

test("A01 recycled nodes preserve the original routing trace and output", (): void => {
  for (const original of originalTraces) {
    expect(getA01SearchTrace(
      HighDensitySolverA01, original.shuffleSeed, original.stepMultiplier,
    )).toEqual(original.result)
  }
})
