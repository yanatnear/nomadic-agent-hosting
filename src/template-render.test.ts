import { test, expect } from "bun:test";
import { renderTemplate } from "./template-render.ts";

test("renderTemplate substitutes all variables", () => {
  const template = 'job "agent-${INSTANCE_NAME}" { mem = ${MEM_MB} }';
  const vars = { INSTANCE_NAME: "test-agent", MEM_MB: "4096" };
  const result = renderTemplate(template, vars);
  expect(result).toBe('job "agent-test-agent" { mem = 4096 }');
});

test("renderTemplate preserves Nomad runtime variables", () => {
  const template = 'port = "${NOMAD_PORT_gateway}" alloc = "${NOMAD_ALLOC_ID}"';
  const vars = { INSTANCE_NAME: "x" };
  const result = renderTemplate(template, vars);
  // NOMAD_* variables must NOT be substituted — Nomad resolves them at runtime
  expect(result).toContain("${NOMAD_PORT_gateway}");
  expect(result).toContain("${NOMAD_ALLOC_ID}");
});

test("renderTemplate throws on missing required variable", () => {
  const template = 'job "agent-${INSTANCE_NAME}" { key = "${NEARAI_API_KEY}" }';
  const vars = { INSTANCE_NAME: "test" };
  // NEARAI_API_KEY is not provided and not a NOMAD_* var
  expect(() => renderTemplate(template, vars)).toThrow(/NEARAI_API_KEY/);
});

test("renderJobTemplate loads file and renders", async () => {
  // This test uses the actual template files
  const { renderJobTemplate } = await import("./template-render.ts");
  const vars = {
    INSTANCE_NAME: "my-agent",
    IMAGE: "ironclaw-dind:latest",
    MEM_MB: "4096",
    CPU_MHZ: "1000",
    NEARAI_API_KEY: "key-123",
    NEARAI_API_URL: "https://api.near.ai",
    SSH_PUBKEY: "ssh-ed25519 AAAA...",
    INSTANCE_TOKEN: "tok-abc",
  };
  const result = await renderJobTemplate("ironclaw-dind", vars);
  expect(result).toContain('job "agent-my-agent"');
  expect(result).toContain("memory = 4096");
  expect(result).toContain('image   = "ironclaw-dind:latest"');
  // Nomad vars should be preserved
  expect(result).toContain("${NOMAD_ALLOC_ID}");
});
