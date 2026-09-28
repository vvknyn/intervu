import { readFileSync } from "node:fs";
import { parseCatalog, summarizeCatalog } from "./lib/journey-catalog.mjs";

console.log(summarizeCatalog(parseCatalog(readFileSync("tests/journeys/CATALOG.md", "utf8"))));
