import { readFileSync } from "node:fs";
import path from "node:path";
import { managedCapabilityHistorySchema } from "@harnesshub/capability-schema/browser";
import { buildSuperskillIndex, mergeSuperskillHistory } from "./build-superskill-catalog.js";

const root = path.resolve(import.meta.dirname, "..");
const indexPath = path.join(root, "data/superskill/index.json");
const historyPath = path.join(root, "data/superskill/history.json");
const actual = JSON.parse(readFileSync(indexPath, "utf8"));
const expected = buildSuperskillIndex();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error("data/superskill/index.json is stale; run npm run build:superskill-catalog");
  process.exit(1);
}
const history = managedCapabilityHistorySchema.parse(JSON.parse(readFileSync(historyPath, "utf8")));
if (JSON.stringify(history) !== JSON.stringify(mergeSuperskillHistory(expected, history))) {
  console.error("data/superskill/history.json is stale; run npm run build:superskill-catalog");
  process.exit(1);
}
console.log(`superskill catalog: ok (${expected.capabilities.length} current, ${history.capabilities.length} historical releases)`);
