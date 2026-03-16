import { test, expect } from "bun:test";
import { buildGatewayTarget } from "./resolve-alloc.ts";

test("buildGatewayTarget constructs URL from service endpoint", () => {
  const target = buildGatewayTarget({ address: "10.0.1.5", port: 25000 }, "/some/path");
  expect(target).toBe("http://10.0.1.5:25000/some/path");
});

test("buildGatewayTarget handles root path", () => {
  const target = buildGatewayTarget({ address: "10.0.1.5", port: 25000 }, "/");
  expect(target).toBe("http://10.0.1.5:25000/");
});
