// Frozen C37 binary heap is the independent full-storage oracle.
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

fn same(reference: &LegacyHeap, candidate: &Heap) {
    assert_eq!(reference.entries.len(), candidate.entries.len());
    assert_eq!(reference.entries.capacity(), candidate.entries.capacity());
    for (a, b) in reference.entries.iter().zip(&candidate.entries) {
        assert_eq!(a.f.to_bits(), b.f.to_bits());
        assert_eq!(a.id, b.id);
    }
}
fn push(reference: &mut LegacyHeap, candidate: &mut Heap, f: f64, id: u32) {
    reference.push(f, id);
    candidate.push(f, id);
    same(reference, candidate);
}
fn pop(reference: &mut LegacyHeap, candidate: &mut Heap) {
    assert_eq!(reference.pop(), candidate.pop());
    same(reference, candidate);
}
fn clear(reference: &mut LegacyHeap, candidate: &mut Heap) {
    reference.clear();
    candidate.clear();
    assert!(!candidate.legacy_priority_order);
    same(reference, candidate);
}

#[test]
fn priority_domain_and_mid_heap_transitions_preserve_every_entry() {
    let positives = [
        0.0,
        f64::from_bits(1),
        f64::from_bits(0x000f_ffff_ffff_ffff),
        f64::MIN_POSITIVE,
        1.0,
        f64::from_bits(1.0f64.to_bits() + 1),
        f64::MAX,
        f64::INFINITY,
    ];
    let exceptional = [
        -0.0,
        -f64::from_bits(1),
        -1.0,
        f64::NEG_INFINITY,
        f64::from_bits(0x7ff0_0000_0000_0001),
        f64::from_bits(0x7ff8_0000_0000_0001),
        f64::from_bits(0xfff0_0000_0000_0001),
        f64::from_bits(0xfff8_0000_0000_1234),
    ];
    let mut old = LegacyHeap::default();
    let mut heap = Heap::default();
    assert!(!heap.legacy_priority_order);
    for bad in exceptional {
        for &initial_pops in &[0, 1, 7, 16] {
            clear(&mut old, &mut heap);
            for (i, f) in positives.into_iter().chain(positives).enumerate() {
                push(&mut old, &mut heap, f, (i % 3) as u32);
                assert!(!heap.legacy_priority_order);
            }
            for _ in 0..initial_pops {
                pop(&mut old, &mut heap);
            }
            push(&mut old, &mut heap, bad, u32::MAX);
            assert!(heap.legacy_priority_order);
            for (i, f) in [0.0, -0.0, 0.0, -0.0, 1.0, 1.0].into_iter().enumerate() {
                push(&mut old, &mut heap, f, (i % 2) as u32);
            }
            while !old.entries.is_empty() {
                pop(&mut old, &mut heap);
            }
            assert!(heap.legacy_priority_order, "empty is not a search reset");
            push(&mut old, &mut heap, 0.0, 0);
            push(&mut old, &mut heap, 0.0, 0);
            assert!(heap.legacy_priority_order);
            pop(&mut old, &mut heap);
            pop(&mut old, &mut heap);
        }
    }
    clear(&mut old, &mut heap);
    for id in 0..4097 {
        push(&mut old, &mut heap, (id % 101) as f64, id);
    }
    assert!(!heap.legacy_priority_order);
    while !old.entries.is_empty() {
        pop(&mut old, &mut heap);
    }
    assert!(!heap.legacy_priority_order);
}

#[test]
fn randomized_positive_and_ieee_searches_match_frozen_storage_and_capacity() {
    fn next(seed: &mut u64) -> u64 {
        *seed ^= *seed << 13;
        *seed ^= *seed >> 7;
        *seed ^= *seed << 17;
        *seed
    }
    let mut seed = 0x3ae5_61c2_b402_d719;
    let mut old = LegacyHeap::default();
    let mut heap = Heap::default();
    let mut positive_operations = 0;
    let mut legacy_operations = 0;
    for epoch in 0..600 {
        clear(&mut old, &mut heap);
        let mut expected_legacy = false;
        for op in 0..600 {
            let bits = next(&mut seed);
            if old.entries.len() > 256 || (!old.entries.is_empty() && bits % 7 < 3) {
                pop(&mut old, &mut heap);
            } else {
                let bits = if epoch % 3 != 0 || op < 180 {
                    bits % (f64::INFINITY.to_bits() + 1)
                } else {
                    bits
                };
                let f = if op % 29 == 0 {
                    0.0
                } else {
                    f64::from_bits(bits)
                };
                let id = if op % 11 == 0 {
                    4
                } else {
                    next(&mut seed) as u32
                };
                expected_legacy |= f.is_sign_negative() || f.is_nan();
                push(&mut old, &mut heap, f, id);
            }
            assert_eq!(heap.legacy_priority_order, expected_legacy);
            if expected_legacy {
                legacy_operations += 1;
            } else {
                positive_operations += 1;
            }
        }
        while !old.entries.is_empty() {
            pop(&mut old, &mut heap);
        }
    }
    assert!(positive_operations > 200_000);
    assert!(legacy_operations > 70_000);
}
