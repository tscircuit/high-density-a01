import { defineConfig } from "vite"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  define: {
    "import.meta.env.VITE_TSCIRCUIT_HIGH_DENSITY_A01_WASM_URL": JSON.stringify(
      "/wasm/highdensity_solver_a01_wasm_bg.wasm",
    ),
  },
  plugins: [
    {
      name: "serve-wasm",
      configureServer(server) {
        server.middlewares.use("/wasm", (req, res, next) => {
          const filePath = path.resolve(
            __dirname,
            "wasm/pkg",
            req.url!.slice(1),
          )
          if (!fs.existsSync(filePath)) return next()
          res.setHeader("Content-Type", "application/wasm")
          fs.createReadStream(filePath).pipe(res)
        })
      },
    },
  ],
})
