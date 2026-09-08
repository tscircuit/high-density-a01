// The frozen pre-Floyd implementation is intentionally duplicated here as
// an independent oracle, including its exact floating comparison order.
use super::{Heap, HeapEntry};

#[derive(Default)]
struct LegacyHeap {
    entries: Vec<HeapEntry>,
}
impl LegacyHeap {
    fn clear(&mut self) {
        self.entries.clear();
    }
    fn push(&mut self, f: f64, id: u32) {
        let entry = HeapEntry { f, id };
        let mut i = self.entries.len();
        self.entries.push(entry);
        while i > 0 {
            let p = (i - 1) >> 1;
            let parent = self.entries[p];
            if if parent.f != f {
                parent.f < f
            } else {
                parent.id < id
            } {
                break;
            }
            self.entries[i] = parent;
            i = p;
        }
        self.entries[i] = entry;
    }
    fn pop(&mut self) -> u32 {
        let out = self.entries[0].id;
        let entry = self.entries.pop().unwrap();
        let n = self.entries.len();
        if n > 0 {
            let mut i = 0;
            loop {
                let left = i * 2 + 1;
                if left >= n {
                    break;
                }
                let right = left + 1;
                let mut child = left;
                if right < n {
                    let left_entry = self.entries[left];
                    let right_entry = self.entries[right];
                    if !(if left_entry.f != right_entry.f {
                        left_entry.f < right_entry.f
                    } else {
                        left_entry.id < right_entry.id
                    }) {
                        child = right;
                    }
                }
                let child_entry = self.entries[child];
                if if entry.f != child_entry.f {
                    entry.f < child_entry.f
                } else {
                    entry.id < child_entry.id
                } {
                    break;
                }
                self.entries[i] = child_entry;
                i = child;
            }
            self.entries[i] = entry;
        }
        out
    }
}

fn compare(a: &LegacyHeap, b: &Heap) {
    assert_eq!(a.entries.len(), b.entries.len());
    for (a, b) in a.entries.iter().zip(&b.entries) {
        assert_eq!(a.id, b.id);
        assert_eq!(a.f.to_bits(), b.f.to_bits());
    }
}
#[test]
fn floyd_preserves_every_heap_entry_and_legacy_nan_searches() {
    let mut old = LegacyHeap::default();
    let mut heap = Heap::default();
    // Exercise the transition after ordered pops, not merely a search that
    // starts with NaN. Distinct NaN payloads stay byte-identical in the heap.
    for (id, f) in [4.0, -0.0, 0.0, 2.0, f64::INFINITY].into_iter().enumerate() {
        old.push(f, id as u32);
        heap.push(f, id as u32);
        compare(&old, &heap);
    }
    assert_eq!(old.pop(), heap.pop());
    compare(&old, &heap);
    for (id, f) in [
        (u32::MAX, f64::from_bits(0x7ff0000000000001)),
        (0x80000000, f64::from_bits(0xfff8000000001234)),
        (8, f64::NEG_INFINITY),
    ] {
        old.push(f, id);
        heap.push(f, id);
        compare(&old, &heap);
    }
    while !old.entries.is_empty() {
        assert_eq!(old.pop(), heap.pop());
        compare(&old, &heap);
    }
    assert!(heap.has_nan_priority);
    old.push(1.0, 0);
    heap.push(1.0, 0);
    compare(&old, &heap);
    assert!(heap.has_nan_priority);
    old.clear();
    heap.clear();
    compare(&old, &heap);
    assert!(!heap.has_nan_priority);
    heap.push(-0.0, 0);
    assert!(!heap.has_nan_priority);
    assert_eq!(heap.pop(), 0);
    let mut seed = 87236874u64;
    let mut operations = 0usize;
    for round in 0..160 {
        let mut legacy = LegacyHeap::default();
        let mut candidate = Heap::default();
        let mut id = 0;
        for i in 0..4096 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            if i > 0 && i % 997 == 0 {
                legacy.clear();
                candidate.clear();
                id = 0;
            } else if legacy.entries.is_empty() || seed % 5 < 3 {
                let special = [
                    -0.0,
                    0.0,
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                    -1.0,
                    1.0,
                    f64::MAX,
                    -f64::MAX,
                    f64::MIN_POSITIVE,
                    f64::from_bits(1),
                ];
                let f = if round % 3 == 0 {
                    special[(seed >> 32) as usize % special.len()]
                } else if round % 3 == 1 {
                    ((seed >> 32) % 1000) as f64 - 500.0
                } else {
                    f64::from_bits(seed)
                };
                legacy.push(f, id);
                candidate.push(f, id);
                id += 1;
            } else {
                assert_eq!(legacy.pop(), candidate.pop());
            }
            compare(&legacy, &candidate);
            operations += 1;
        }
        while !legacy.entries.is_empty() {
            assert_eq!(legacy.pop(), candidate.pop());
            compare(&legacy, &candidate);
            operations += 1;
        }
    }
    println!("Exact heap shape after {} operations", operations);
}
