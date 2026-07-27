import { config } from "dotenv";
config({ path: ".env.local" });
const host = process.env.MEILISEARCH_HOST;
const key = process.env.MEILISEARCH_SEARCH_KEY || process.env.MEILISEARCH_API_KEY;
const r = await fetch(`${host}/indexes/jobs/search`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify({ q: "growthloop", limit: 5, attributesToRetrieve: ["id","title","vacancy_status","updated_at"] }),
});
const b = await r.json();
(b.hits ?? []).filter(h => h.id?.startsWith("f857") || /growthloop/i.test(h.title) || true).slice(0,4).forEach(h => console.log(JSON.stringify(h)));
