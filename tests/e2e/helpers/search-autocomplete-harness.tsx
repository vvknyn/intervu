/**
 * Entry for a server-less page that mounts the REAL SearchAutocomplete, so its
 * keyboard model can be driven in a browser without Meilisearch or a dev
 * server. Bundled by search-combobox-keys.spec.ts; logs what the caller would
 * have run into window.__log.
 */
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SearchAutocomplete, type SearchAutocompleteHandle } from "@/components/search/SearchAutocomplete";

declare global {
    interface Window {
        __log: string[];
        __close: () => void;
    }
}

const TITLES = ["Accountant", "Account Manager", "Senior Accountant"];

function App() {
    const [value, setValue] = useState("");
    const latest = useRef(value);
    latest.current = value;
    const handle = useRef<SearchAutocompleteHandle>(null);
    window.__close = () => handle.current?.close();
    return (
        <div style={{ padding: 40, width: 480 }}>
            <button id="before">before</button>
            <form onSubmit={() => window.__log.push("form-submit")}>
                <SearchAutocomplete
                    ref={handle}
                    value={value}
                    onChange={setValue}
                    onSearch={() => window.__log.push(`search:${latest.current}`)}
                    onClear={() => {
                        setValue("");
                        window.__log.push("clear");
                    }}
                    suggest={async (q) => {
                        await new Promise((r) => setTimeout(r, 100));
                        const roles = TITLES.filter((t) => t.toLowerCase().includes(q.toLowerCase()));
                        return [...roles.map((text) => ({ text, type: "role" as const })), { text: `${q} Inc`, type: "company" as const }];
                    }}
                    seeds={["Nurse", "Engineer"]}
                    name="q"
                    placeholder="Job title"
                />
            </form>
            <button id="after">after</button>
        </div>
    );
}

window.__log = [];
createRoot(document.getElementById("root")!).render(<App />);
