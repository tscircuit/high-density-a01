interface Entry {
  f: number
  seq: number
  id: number
  child: Entry | null
  next: Entry | null
}

/** Two-pass pairing queue for immutable, ordered (f, seq) priorities. */
export class PairingHeap {
  private root: Entry | null = null
  private n = 0

  private meld(a: Entry | null, b: Entry | null): Entry | null {
    if (!a) return b
    if (!b) return a
    const aLess = a.f !== b.f ? a.f < b.f : a.seq < b.seq
    if (!aLess) {
      const swap = a
      a = b
      b = swap
    }
    b.next = a.child
    a.child = b
    return a
  }

  push(f: number, seq: number, id: number) {
    // A NaN makes the original comparator non-total. Rebuilding a differently
    // shaped queue cannot recover its old behavior, so reject this opt-in input.
    if (Number.isNaN(f)) {
      throw new RangeError(
        "The pairing priority queue requires non-NaN priorities",
      )
    }
    this.root = this.meld(this.root, { f, seq, id, child: null, next: null })
    this.n++
  }

  pop(): number {
    const out = this.root?.id
    this.n--
    if (this.n > 0) {
      let remaining = this.root!.child
      let paired: Entry | null = null
      // Pair adjacent children left to right, linking results in reverse order.
      while (remaining) {
        const first = remaining
        const second = first.next
        remaining = second ? second.next : null
        first.next = null
        if (second) second.next = null
        const tree = this.meld(first, second)!
        tree.next = paired
        paired = tree
      }
      let root: Entry | null = null
      // Meld the paired trees right to left without allocating a scratch list.
      while (paired) {
        const tree = paired
        paired = tree.next
        tree.next = null
        root = this.meld(tree, root)
      }
      this.root = root
    } else {
      this.root = null
    }
    return out!
  }

  get size() {
    return this.n
  }

  clear() {
    this.root = null
    this.n = 0
  }
}
