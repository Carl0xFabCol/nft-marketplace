import "dotenv/config";
import { run } from "./indexer";

console.log("🚀 Indexer starting...");

async function main() {
  await run();

  // loop cada 15s
  setInterval(async () => {
    try {
      await run();
    } catch (err) {
      console.error("Loop error:", err);
    }
  }, 15_000);
}

main().catch(console.error);
