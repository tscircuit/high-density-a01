import { resolve } from "node:path"
import { tmpdir } from "node:os"
import { mkdtempSync, rmSync } from "node:fs"

// Only kernel development needs LLVM; normal library/browser builds use the
// checked-in generated module and have no compiler or runtime dependency.
const root = resolve(import.meta.dir, "..")
const temporary = mkdtempSync(resolve(tmpdir(), "a13-kernel-"))
try {
  const output = resolve(temporary, "kernel.wasm")
  const result = Bun.spawnSync(
    [
      process.env.A13_CLANG ?? "clang",
      "--target=wasm32",
      "-O3",
      "-msimd128",
      "-ffp-contract=off",
      "-nostdlib",
      ...(process.env.A13_WASM_LD
        ? [`-fuse-ld=${process.env.A13_WASM_LD}`]
        : []),
      "-Wl,--no-entry",
      "-Wl,--export=configure",
      "-Wl,--export=begin_search",
      "-Wl,--export=run",
      "-Wl,--export=get_expansions",
      "-Wl,--export=get_pops",
      "-Wl,--export=set_heap_capacity",
      "-Wl,--export=__heap_base",
      resolve(root, "lib/HighDensitySolverA13/search/kernel.c"),
      "-o",
      output,
    ],
    { stdout: "inherit", stderr: "inherit" },
  )
  if (result.exitCode !== 0)
    throw new Error(
      "A13 kernel compilation failed; use LLVM clang with the wasm32 target and wasm-ld",
    )
  const base64 = Buffer.from(await Bun.file(output).arrayBuffer()).toString(
    "base64",
  )
  await Bun.write(
    resolve(root, "lib/HighDensitySolverA13/search/kernel.generated.ts"),
    `// Generated from kernel.c by scripts/build-a13-kernel.ts. Do not edit.\nexport const kernelBase64 =\n  "${base64}"\n`,
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
