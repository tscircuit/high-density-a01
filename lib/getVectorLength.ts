const float64View = new DataView(new ArrayBuffer(8))

const getSquareRoundingError = (value: number, square: number): number => {
  // Split the significand so the rounding error of its square is retained.
  const split = (2 ** 27 + 1) * value
  const leading = split - (split - value)
  const trailing = value - leading
  const leadingSquareError = leading * leading - square
  return leadingSquareError + 2 * leading * trailing + trailing * trailing
}

/** A platform-stable 2D vector length for routing decisions. */
export const getVectorLength = (x: number, y: number): number => {
  const absoluteX = Math.abs(x)
  const absoluteY = Math.abs(y)
  if (absoluteX === Infinity || absoluteY === Infinity) return Infinity
  let maximum = Math.max(absoluteX, absoluteY)
  let minimum = Math.min(absoluteX, absoluteY)
  if (maximum === 0 || !Number.isFinite(maximum)) return maximum
  if (minimum / maximum < 2 ** -27) return maximum

  // Power-of-two scaling is exact, including for subnormal inputs.
  let resultScale = 1
  if (maximum < 2 ** -500) {
    maximum *= 2 ** 600
    minimum *= 2 ** 600
    resultScale = 2 ** -600
  }
  float64View.setFloat64(0, maximum, false)
  const exponent = ((float64View.getUint32(0, false) >>> 20) & 0x7ff) - 1023
  const scale = 2 ** exponent
  const scaledMaximum = maximum / scale
  const scaledMinimum = minimum / scale
  const maximumSquare = scaledMaximum * scaledMaximum
  const minimumSquare = scaledMinimum * scaledMinimum
  const sum = maximumSquare + minimumSquare
  const sumError = maximumSquare - sum + minimumSquare
  const productError =
    getSquareRoundingError(scaledMaximum, maximumSquare) +
    getSquareRoundingError(scaledMinimum, minimumSquare)

  // Correct the rounded square root using the low parts of both products.
  const root = Math.sqrt(sum)
  const rootSquare = root * root
  const rootError = getSquareRoundingError(root, rootSquare)
  const residual = sum - rootSquare - rootError + (productError + sumError)
  return (root + residual / (2 * root)) * scale * resultScale
}
