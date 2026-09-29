import test from "node:test";
import assert from "node:assert/strict";
import {
    ETA_MIN_MEASURE_MS,
    IDLE_MODEL_LOAD,
    describeModelLoad,
    downloadSizeLine,
    formatBytes,
    modelLoadView,
    reduceModelLoad,
    type ModelLoadEvent,
    type ModelLoadState,
} from "@/lib/local-ai/model-load";

const MB = 1_000_000;
const fold = (events: Array<[number, ModelLoadEvent]>): ModelLoadState =>
    events.reduce<ModelLoadState>((s, [t, e]) => reduceModelLoad(s, e, t), IDLE_MODEL_LOAD);

test("byte progress (transformers.js): per-file bytes sum against the measured total, ETA from the measured rate", () => {
    // 100 MB total; 10 MB at t=1 s (first movement), 30 MB at t=3 s → 10 MB/s over 2 s → 70 MB left ≈ 7 s.
    const s = fold([
        [0, { kind: "begin", engine: "transformers", cached: false, expectedBytes: 100 * MB }],
        [1_000, { kind: "file", file: "tokenizer.json", loaded: 10 * MB }],
        [3_000, { kind: "file", file: "model.onnx", loaded: 20 * MB }],
    ]);
    const view = modelLoadView(s, 3_000)!;
    assert.equal(view.loadedBytes, 30 * MB);
    assert.equal(view.totalBytes, 100 * MB);
    assert.equal(view.fraction, 0.3);
    assert.ok(Math.abs(view.etaSeconds! - 7) < 1e-9, String(view.etaSeconds));
    assert.equal(describeModelLoad(view), "30 MB of 100 MB (30%) · about 5 s left");
});

test("no ETA before 2 s of measured movement — an early rate is noise", () => {
    const s = fold([
        [0, { kind: "begin", engine: "transformers", cached: false, expectedBytes: 100 * MB }],
        [500, { kind: "file", file: "model.onnx", loaded: 5 * MB }],
        [2_000, { kind: "file", file: "model.onnx", loaded: 10 * MB }],
    ]);
    assert.equal(modelLoadView(s, 500 + ETA_MIN_MEASURE_MS - 1)!.etaSeconds, null);
    assert.notEqual(modelLoadView(s, 500 + ETA_MIN_MEASURE_MS)!.etaSeconds, null);
});

test("fraction-only engines (WebLLM, Nano): percent of the known size, or bare percent when Chrome owns the size", () => {
    const webllm = fold([
        [0, { kind: "begin", engine: "webllm", cached: false, expectedBytes: 1_816_811_105 }],
        [1_000, { kind: "fraction", fraction: 0.25 }],
    ]);
    assert.equal(describeModelLoad(modelLoadView(webllm, 1_000)!), "25% of 1.82 GB");
    const nano = fold([
        [0, { kind: "begin", engine: "nano", cached: false, expectedBytes: null }],
        [1_000, { kind: "fraction", fraction: 0.5 }],
    ]);
    assert.equal(describeModelLoad(modelLoadView(nano, 1_000)!), "50%");
});

test("unknown total: indeterminate bar with bytes so far, and says the total is unknown", () => {
    const s = fold([
        [0, { kind: "begin", engine: "transformers", cached: false, expectedBytes: null }],
        [1_000, { kind: "file", file: "model.onnx", loaded: 12 * MB }],
    ]);
    const view = modelLoadView(s, 5_000)!;
    assert.equal(view.fraction, null);
    assert.equal(view.etaSeconds, null);
    assert.equal(describeModelLoad(view), "12 MB downloaded (total size unknown)");
});

test("cached load: flagged cached and never given an ETA", () => {
    const s = fold([
        [0, { kind: "begin", engine: "transformers", cached: true, expectedBytes: 100 * MB }],
        [1_000, { kind: "file", file: "model.onnx", loaded: 50 * MB }],
    ]);
    const view = modelLoadView(s, 10_000)!;
    assert.equal(view.cached, true);
    assert.equal(view.etaSeconds, null);
});

test("end: the view disappears on ready and on failure; late progress after end is ignored", () => {
    const begin: [number, ModelLoadEvent] = [0, { kind: "begin", engine: "webllm", cached: false, expectedBytes: null }];
    assert.equal(modelLoadView(fold([begin, [1, { kind: "end", ok: true }]]), 2), null);
    const failed = fold([begin, [1, { kind: "end", ok: false }], [2, { kind: "fraction", fraction: 0.9 }]]);
    assert.deepEqual(failed, { phase: "failed" });
});

test("formatBytes is decimal (matches Hugging Face / OS dialogs)", () => {
    assert.equal(formatBytes(493_804_872), "494 MB");
    assert.equal(formatBytes(1_816_811_105), "1.82 GB");
});

test("downloadSizeLine: the measured size, Chrome-managed when unknown, nothing for rules-only", () => {
    assert.equal(
        downloadSizeLine({ id: "transformers", bytes: 493_804_872 }),
        "The model is about 494 MB. It's a one-time download, cached for next time.",
    );
    assert.match(downloadSizeLine({ id: "nano", bytes: null }), /^Chrome manages this model's download/);
    assert.equal(downloadSizeLine({ id: "heuristic", bytes: null }), "");
});
