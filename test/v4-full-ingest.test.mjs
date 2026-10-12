import { test } from "node:test";
import assert from "node:assert/strict";
import { commentTool } from "../build/v4/tools/extras.js";
import { renderTaskDetail } from "../build/v4/core/format.js";
test("comment reads preserve long multiline bodies and expose pagination", async () => {
  const body = "How to test\n" + "x".repeat(7000) + "\nFINAL AC";
  let url;
  const ctx = {
    http: {
      get: async (p) => {
        url = p;
        return { comments: [{ id: "c1", date: "123", comment_text: body }] };
      },
    },
  };
  const result = await commentTool.handler(
    { task: "t1", start: 456, start_id: "c0" },
    ctx,
  );
  assert.ok(result.includes(body));
  assert.ok(result.includes('start_id: "c1"'));
  assert.ok(url.includes("start=456"));
  assert.ok(url.includes("start_id=c0"));
});
test("task descriptions preserve content beyond 4000 characters", () => {
  const description = "x".repeat(12000) + "\nFINAL AC";
  const result = renderTaskDetail({
    id: "t1",
    name: "Long task",
    assignees: [],
    tags: [],
    description,
  });
  assert.ok(result.includes(description));
});
