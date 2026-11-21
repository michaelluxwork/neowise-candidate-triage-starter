import assert from "node:assert/strict";
import { once } from "node:events";
import { before, after, test } from "node:test";
import { server } from "./server.mjs";

let base;
before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
}));

async function post(body) {
  const response = await fetch(base + "/api/triage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return { http: response.status, body: await response.json() };
}

for (const [text, topic] of [
  ["Когда доставка?", "delivery"],
  ["Какая стоимость?", "pricing"],
  ["Здравствуйте", "other"],
]) {
  test(`valid request: ${topic}`, async () => {
    assert.deepEqual(await post(JSON.stringify({ text })), {
      http: 200,
      body: { status: "ready", topic, draft: "Спасибо за обращение. Уточним детали заявки." },
    });
  });
}

for (const [name, body] of [
  ["empty text", '{"text":""}'],
  ["whitespace", '{"text":"  \\n\\t "}'],
  ["missing text", "{}"],
  ["number", '{"text":42}'],
  ["null text", '{"text":null}'],
  ["boolean", '{"text":true}'],
  ["array text", '{"text":[]}'],
  ["object text", '{"text":{}}'],
  ["null body", "null"],
  ["array body", "[]"],
  ["string body", '"hello"'],
  ["empty body", ""],
  ["broken JSON", "{"],
]) {
  test(`invalid input: ${name}`, async () => {
    assert.deepEqual(await post(body), { http: 400, body: { status: "invalid_input" } });
  });
}

for (const tag of ["timeout", "error", "bad-json", "bad-topic", "empty-draft"]) {
  test(`model failure: ${tag}`, async () => {
    const start = performance.now();
    assert.deepEqual(await post(JSON.stringify({ text: `[${tag}]` })), {
      http: 200,
      body: { status: "manual_review", topic: null, draft: null },
    });
    if (tag === "timeout") {
      const elapsed = performance.now() - start;
      assert.ok(elapsed >= 250 && elapsed < 1000, `Timeout took ${elapsed.toFixed(0)} ms`);
      console.log(`Model timeout response: ${elapsed.toFixed(0)} ms`);
    }
  });
}

test("successful response after a model failure", async () => {
  await post(JSON.stringify({ text: "[error]" }));
  const result = await post(JSON.stringify({ text: "Когда доставка?" }));
  assert.equal(result.http, 200);
  assert.equal(result.body.status, "ready");
  assert.equal(result.body.topic, "delivery");
});
