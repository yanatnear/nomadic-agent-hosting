import { test, expect } from "bun:test";
import { formatAllocEvent } from "./deploy-stream.ts";

test("formatAllocEvent maps pending state", () => {
  const event = formatAllocEvent({ ClientStatus: "pending", TaskStates: {} });
  expect(event.status).toBe("pending");
  expect(event.message).toContain("Waiting");
});

test("formatAllocEvent maps running state", () => {
  const event = formatAllocEvent({
    ClientStatus: "running",
    TaskStates: { agent: { State: "running" } },
  });
  expect(event.status).toBe("running");
});

test("formatAllocEvent maps failed state with error message", () => {
  const event = formatAllocEvent({
    ClientStatus: "failed",
    TaskStates: {
      agent: { State: "dead", Events: [{ DisplayMessage: "OOM killed" }] },
    },
  });
  expect(event.status).toBe("error");
  expect(event.message).toContain("OOM");
});

test("formatAllocEvent handles unknown status", () => {
  const event = formatAllocEvent({ ClientStatus: "lost", TaskStates: null });
  expect(event.status).toBe("lost");
});
