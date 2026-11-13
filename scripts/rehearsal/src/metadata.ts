// Loopback token-metadata server. The rehearsal collections use
// http://127.0.0.1:<port>/<collection>/ as baseURI so the indexer's
// MetadataFetcher never reaches a public IPFS gateway.

import { createServer, type Server } from "node:http"

export const METADATA_PORT = 18546
export const metadataBase = (slug: string) => `http://127.0.0.1:${METADATA_PORT}/${slug}/`

export function startMetadataServer(): Promise<{ server: Server; requests: () => number; close: () => Promise<void> }> {
  let count = 0
  const server = createServer((req, res) => {
    count++
    const parts = (req.url ?? "/").split("/").filter(Boolean)
    const [slug = "unknown", token = "0"] = parts
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ name: `${slug} #${token}`, description: "Phase 5 rehearsal token", image: `http://127.0.0.1:${METADATA_PORT}/img/${slug}/${token}.png` }))
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(METADATA_PORT, "127.0.0.1", () =>
      resolve({
        server,
        requests: () => count,
        close: () => new Promise<void>((r) => server.close(() => r())),
      }),
    )
  })
}
