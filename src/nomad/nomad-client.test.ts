import { test, expect } from "bun:test";
import { buildJobSubmitUrl, buildJobStopUrl, parseAllocPorts } from "./nomad-client.ts";

test("buildJobSubmitUrl appends v1/jobs", () => {
  expect(buildJobSubmitUrl("http://127.0.0.1:4646")).toBe("http://127.0.0.1:4646/v1/jobs");
});

test("buildJobStopUrl includes purge=true", () => {
  const url = buildJobStopUrl("http://127.0.0.1:4646", "my-job");
  expect(url).toBe("http://127.0.0.1:4646/v1/job/my-job?purge=true");
});

test("parseAllocPorts extracts gateway and ssh ports", () => {
  const alloc = {
    Resources: {
      Networks: [
        {
          IP: "10.0.0.5",
          DynamicPorts: [
            { Label: "gateway", Value: 20001 },
            { Label: "ssh", Value: 20002 },
          ],
        },
      ],
    },
  };
  const ports = parseAllocPorts(alloc);
  expect(ports.gatewayPort).toBe(20001);
  expect(ports.sshPort).toBe(20002);
  expect(ports.nodeIp).toBe("10.0.0.5");
});

test("parseAllocPorts throws when no networks", () => {
  expect(() => parseAllocPorts({ Resources: { Networks: [] } })).toThrow("No networks");
});

test("parseAllocPorts throws when gateway port missing", () => {
  const alloc = {
    Resources: {
      Networks: [
        { IP: "10.0.0.1", DynamicPorts: [{ Label: "ssh", Value: 20002 }] },
      ],
    },
  };
  expect(() => parseAllocPorts(alloc)).toThrow("No gateway port");
});

test("parseAllocPorts throws when ssh port missing", () => {
  const alloc = {
    Resources: {
      Networks: [
        { IP: "10.0.0.1", DynamicPorts: [{ Label: "gateway", Value: 20001 }] },
      ],
    },
  };
  expect(() => parseAllocPorts(alloc)).toThrow("No ssh port");
});
