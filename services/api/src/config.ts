import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../../../.env"), quiet: true });
export const development = () =>
  process.env.NODE_ENV !== "production" && process.env.DEV_AUTH === "true";
export function assertConfig() {
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.DEV_AUTH === "true" || process.env.AI_MODE === "fixture")
  )
    throw new Error("Development modes are prohibited in production");
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.AI_SERVICE_TOKEN ||
      process.env.AI_SERVICE_TOKEN === "local-development-only")
  )
    throw new Error("Configure a private AI service token");
}
