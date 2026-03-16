import { test, expect } from "bun:test";
import { buildServiceUrl, parseServiceEndpoint } from "./consul-client.ts";

test("buildServiceUrl constructs catalog URL", () => {
  const url = buildServiceUrl("http://127.0.0.1:8500", "agent-test");
  expect(url).toBe("http://127.0.0.1:8500/v1/catalog/service/agent-test");
});

test("parseServiceEndpoint prefers ServiceAddress", () => {
  const ep = parseServiceEndpoint({
    ServiceAddress: "10.0.0.5",
    Address: "10.0.0.1",
    ServicePort: 8080,
  });
  expect(ep).toEqual({ address: "10.0.0.5", port: 8080 });
});

test("parseServiceEndpoint falls back to Address", () => {
  const ep = parseServiceEndpoint({
    ServiceAddress: "",
    Address: "10.0.0.1",
    ServicePort: 9090,
  });
  expect(ep).toEqual({ address: "10.0.0.1", port: 9090 });
});
