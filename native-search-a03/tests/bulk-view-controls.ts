// Additive view ABI controls against the unchanged complete word oracles.
import { strict as assert } from "node:assert"

export function assertBulkMaterialization(e: any, expected: readonly bigint[]) {
  e.a03_export_materialization()
  const buffer = e.memory.buffer
  const m = new Uint32Array(buffer, e.a03_pointer(42), e.a03_length(42))
  assert.equal(m.length, 50)
  assert.equal(m[0], 1)
  assert.equal(m[5], 0)
  const span = (index: number, width = 4) => {
    const pointer = m[10 + index * 2]!,
      length = m[11 + index * 2]!
    assert.equal(pointer % width, 0)
    assert.ok(pointer + length * width <= buffer.byteLength)
    return width === 8
      ? new BigUint64Array(buffer, pointer, length)
      : new Uint32Array(buffer, pointer, length)
  }
  const word = (value: number | bigint) => BigInt(value)
  let cursor = 0
  const next = () => expected[cursor++]!
  const count = () => Number(next())
  assert.equal(next(), 1n)
  for (const [logical, fields] of [
    [m[1], [0, 1]],
    [m[2], [2, 3, 4, 5, 6, 7]],
    [m[3], [8, 9]],
  ] as Array<[number, number[]]>) {
    assert.equal(next(), BigInt(logical))
    const length = count()
    const arrays = fields.map((i) => span(i, i === 0 || i === 4 ? 8 : 4))
    for (const values of arrays) assert.equal(values.length, length)
    for (let i = 0; i < length; i++)
      for (const values of arrays) assert.equal(word(values[i]!), next())
  }
  for (let i = 10; i <= 13; i++) {
    const values = span(i, i === 13 ? 8 : 4)
    assert.equal(values.length, count())
    for (const value of values) assert.equal(word(value), next())
  }
  assert.equal(BigInt(m[6]!) | (BigInt(m[7]!) << 32n), next())
  assert.equal(BigInt(m[4]!), next())
  assert.equal(BigInt(m[8]!) | (BigInt(m[9]!) << 32n), next())
  for (let i = 14; i <= 16; i++) {
    const values = span(i)
    assert.equal(values.length, count())
    for (const value of values) assert.equal(word(value), next())
  }
  const via = span(18)
  const viaCount = count()
  assert.equal(via.length, viaCount * 3)
  for (let i = 0; i < via.length; i += 3) {
    assert.equal(word(via[i]!), next())
    const length = count()
    assert.equal(via[i + 2], length)
    const values = new Uint32Array(buffer, Number(via[i + 1]), length)
    for (const value of values) assert.equal(word(value), next())
  }
  // Kind40 retains native footprint copies as an oracle. Kind42 intentionally
  // omits them because the original TS footprint Map is already authoritative.
  const footprintCount = count()
  for (let i = 0; i < footprintCount; i++) {
    next()
    const length = count()
    cursor += length
  }
  const stamps = span(17),
    layers = span(19)
  assert.equal(stamps.length, count())
  let layerCursor = 0
  for (let i = 0; i < stamps.length; i++) {
    assert.equal(word(stamps[i]!), next())
    const present = count()
    assert.ok(present === 0 || present === 1)
    if (present) {
      assert.equal(layers[layerCursor++], i)
      const pointer = Number(layers[layerCursor++]),
        length = count()
      assert.equal(layers[layerCursor++], length)
      for (const value of new Uint32Array(buffer, pointer, length))
        assert.equal(word(value), next())
    }
  }
  assert.equal(layerCursor, layers.length)
  assert.equal(cursor, expected.length)
  e.a03_export_snapshot()
  const unchanged = new BigUint64Array(
    e.memory.buffer,
    e.a03_pointer(40),
    e.a03_length(40),
  )
  assert.equal(unchanged.length, expected.length)
  for (let i = 0; i < unchanged.length; i++)
    assert.equal(unchanged[i], expected[i])
}

export function assertDistanceViews(e: any, expected?: readonly bigint[]) {
  if (!expected) {
    e.a03_export_distance_cache()
    expected = Array.from(
      new BigUint64Array(e.memory.buffer, e.a03_pointer(41), e.a03_length(41)),
    )
  }
  e.a03_export_distance_views()
  const buffer = e.memory.buffer
  const m = new Uint32Array(buffer, e.a03_pointer(43), e.a03_length(43))
  assert.equal(m.length, 4 + 6 * m[3]!)
  for (let i = 0; i < 4; i++) assert.equal(BigInt(m[i]!), expected[i])
  let cursor = 4
  for (let i = 4; i < m.length; i += 6) {
    const length = m[i + 1]!
    assert.equal(BigInt(m[i]!), expected[cursor++])
    assert.equal(BigInt(length), expected[cursor++])
    for (let j = 2; j <= 4; j++) {
      const pointer = m[i + j]!
      assert.equal(pointer % 8, 0)
      assert.ok(pointer + length * 8 <= buffer.byteLength)
      for (const value of new BigUint64Array(buffer, pointer, length))
        assert.equal(value, expected[cursor++])
    }
    for (const value of new Uint8Array(buffer, m[i + 5]!, length))
      assert.equal(BigInt(value), expected[cursor++])
  }
  assert.equal(cursor, expected.length)
}
