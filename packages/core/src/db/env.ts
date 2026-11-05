// Loads the repo-root .env (if present) for CLI scripts run from packages/core.
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../../.env"), quiet: true });
config({ quiet: true });
