# Nomad Job Templates

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create Nomad HCL job templates for the three service types (openclaw, ironclaw, ironclaw-dind) that replace the current Docker Compose templates.

**Architecture:** Each service type gets a parameterized HCL template. A small Bun.js script renders templates with instance-specific variables (name, ports, memory, image, env vars). Templates include health checks, egress lifecycle hooks (poststart/poststop), and Consul service registration.

**Tech Stack:** Nomad HCL, Bun.js (template renderer), bash (egress scripts)

**Depends on:** Plan 01 (working Nomad + Consul cluster with Sysbox)

---

## File Structure

```
agent-hosting-v2/
  nomad/
    templates/
      openclaw.nomad.hcl        # Single container: gateway + SSH
      ironclaw.nomad.hcl        # Worker + openssh sidecar
      ironclaw-dind.nomad.hcl   # Sysbox DinD container
    scripts/
      apply-egress.sh           # Poststart: apply iptables rules
      remove-egress.sh          # Poststop: remove iptables rules
  src/
    template-render.ts          # Renders HCL templates with variables
    template-render.test.ts     # Tests for template rendering
```

---

## Chunk 1: Egress Scripts

### Task 1: Egress apply script (poststart hook)

**Files:**
- Create: `nomad/scripts/apply-egress.sh`

- [ ] **Step 1: Write the egress apply script**

This script is called by the Nomad poststart lifecycle hook. It receives the Nomad allocation ID, finds the container's IP via Docker, and applies iptables rules.

Create `nomad/scripts/apply-egress.sh`:

```bash
#!/usr/bin/env bash
# Poststart hook: apply iptables egress filtering for an agent container.
# Usage: apply-egress.sh <alloc-id>
# Finds the container IP from Docker and applies DROP-all + allow-list rules.
set -euo pipefail

ALLOC_ID="$1"

# Find the Docker container ID for this allocation.
# Nomad labels containers with the allocation ID.
CONTAINER_ID=$(docker ps --filter "label=com.hashicorp.nomad.alloc_id=${ALLOC_ID}" --format '{{.ID}}' | head -1)
if [ -z "$CONTAINER_ID" ]; then
  echo "ERROR: No container found for alloc ${ALLOC_ID}" >&2
  exit 1
fi

# Get the container's IP address
CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER_ID")
if [ -z "$CONTAINER_IP" ]; then
  echo "ERROR: No IP found for container ${CONTAINER_ID}" >&2
  exit 1
fi

CHAIN="CRABSHACK-${ALLOC_ID:0:8}"

# Create a dedicated iptables chain for this container
iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"

# Allow established connections (responses to outbound requests)
iptables -A "$CHAIN" -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS (UDP 53)
iptables -A "$CHAIN" -p udp --dport 53 -j ACCEPT

# Allow HTTPS (TCP 443) — needed for API calls
iptables -A "$CHAIN" -p tcp --dport 443 -j ACCEPT

# Allow HTTP (TCP 80) — needed for package managers
iptables -A "$CHAIN" -p tcp --dport 80 -j ACCEPT

# Drop everything else from this container
iptables -A "$CHAIN" -j DROP

# Insert the chain into FORWARD for traffic from this container
iptables -I FORWARD -s "$CONTAINER_IP" -j "$CHAIN"

echo "Egress rules applied for ${CONTAINER_IP} (alloc ${ALLOC_ID:0:8})"
```

- [ ] **Step 2: Commit**

```bash
git add nomad/scripts/apply-egress.sh
git commit -m "feat: iptables egress apply script for Nomad poststart hook"
```

---

### Task 2: Egress remove script (poststop hook)

**Files:**
- Create: `nomad/scripts/remove-egress.sh`

- [ ] **Step 1: Write the egress remove script**

Create `nomad/scripts/remove-egress.sh`:

```bash
#!/usr/bin/env bash
# Poststop hook: remove iptables egress filtering for an agent container.
# Usage: remove-egress.sh <alloc-id>
set -euo pipefail

ALLOC_ID="$1"
CHAIN="CRABSHACK-${ALLOC_ID:0:8}"

# Remove the FORWARD rule referencing our chain (may have multiple — remove all)
while iptables -D FORWARD -j "$CHAIN" 2>/dev/null; do :; done

# Flush and delete the chain
iptables -F "$CHAIN" 2>/dev/null || true
iptables -X "$CHAIN" 2>/dev/null || true

echo "Egress rules removed for alloc ${ALLOC_ID:0:8}"
```

- [ ] **Step 2: Commit**

```bash
git add nomad/scripts/remove-egress.sh
git commit -m "feat: iptables egress remove script for Nomad poststop hook"
```

---

## Chunk 2: Nomad Job Templates

### Task 3: ironclaw-dind template (most complex — start here)

**Files:**
- Create: `nomad/templates/ironclaw-dind.nomad.hcl`

- [ ] **Step 1: Write the ironclaw-dind template**

This is the Sysbox DinD container — the most complex service type. It needs:
- Sysbox runtime
- Gateway + SSH ports
- Worker image tarball bind-mount
- Egress poststart/poststop hooks
- Consul service registration
- Health check

Create `nomad/templates/ironclaw-dind.nomad.hcl`:

```hcl
# Parameterized job template for ironclaw-dind service type.
# Variables are substituted by the API's template renderer before submission.
#
# Required variables:
#   INSTANCE_NAME, IMAGE, MEM_MB, CPU_MHZ,
#   NEARAI_API_KEY, NEARAI_API_URL, SSH_PUBKEY, INSTANCE_TOKEN

job "agent-${INSTANCE_NAME}" {
  datacenters = ["dc1"]
  type        = "service"

  group "agent" {
    count = 1

    network {
      port "gateway" {}
      port "ssh" {}
    }

    # --- Egress lifecycle hooks ---

    task "egress-setup" {
      lifecycle {
        hook    = "poststart"
        sidecar = false
      }
      driver = "raw_exec"
      config {
        command = "/usr/local/bin/apply-egress.sh"
        args    = ["${NOMAD_ALLOC_ID}"]
      }
      resources {
        memory = 32
        cpu    = 50
      }
    }

    task "egress-cleanup" {
      lifecycle {
        hook    = "poststop"
        sidecar = false
      }
      driver = "raw_exec"
      config {
        command = "/usr/local/bin/remove-egress.sh"
        args    = ["${NOMAD_ALLOC_ID}"]
      }
      resources {
        memory = 32
        cpu    = 50
      }
    }

    # --- Main agent container ---

    task "agent" {
      driver = "docker"

      config {
        image   = "${IMAGE}"
        runtime = "sysbox-runc"
        ports   = ["gateway", "ssh"]

        port_map {
          gateway = 3000
          ssh     = 22
        }

        volumes = [
          "/data/crabshack/images/ironclaw-sandbox-worker.tar:/opt/.worker-image.tar:ro"
        ]
      }

      env {
        NEARAI_API_KEY  = "${NEARAI_API_KEY}"
        NEARAI_API_URL  = "${NEARAI_API_URL}"
        SSH_PUBKEY      = "${SSH_PUBKEY}"
        INSTANCE_TOKEN  = "${INSTANCE_TOKEN}"
        INSTANCE_NAME   = "${INSTANCE_NAME}"
        GATEWAY_PORT    = "${NOMAD_PORT_gateway}"
        SSH_PORT        = "${NOMAD_PORT_ssh}"
      }

      resources {
        memory = ${MEM_MB}
        cpu    = ${CPU_MHZ}
      }

      service {
        name = "agent-${INSTANCE_NAME}"
        port = "gateway"
        tags = ["agent", "ironclaw-dind", "instance:${INSTANCE_NAME}"]

        check {
          type     = "http"
          path     = "/health"
          port     = "gateway"
          interval = "15s"
          timeout  = "5s"
        }
      }

      service {
        name = "agent-${INSTANCE_NAME}-ssh"
        port = "ssh"
        tags = ["agent-ssh", "ironclaw-dind", "instance:${INSTANCE_NAME}"]

        check {
          type     = "tcp"
          port     = "ssh"
          interval = "15s"
          timeout  = "5s"
        }
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add nomad/templates/ironclaw-dind.nomad.hcl
git commit -m "feat: Nomad job template for ironclaw-dind service type"
```

---

### Task 4: openclaw template

**Files:**
- Create: `nomad/templates/openclaw.nomad.hcl`

- [ ] **Step 1: Write the openclaw template**

Openclaw is a single container with built-in gateway + SSH. Simpler than ironclaw-dind — no Sysbox needed, no worker image tarball.

Create `nomad/templates/openclaw.nomad.hcl`:

```hcl
job "agent-${INSTANCE_NAME}" {
  datacenters = ["dc1"]
  type        = "service"

  group "agent" {
    count = 1

    network {
      port "gateway" {}
      port "ssh" {}
    }

    task "egress-setup" {
      lifecycle {
        hook    = "poststart"
        sidecar = false
      }
      driver = "raw_exec"
      config {
        command = "/usr/local/bin/apply-egress.sh"
        args    = ["${NOMAD_ALLOC_ID}"]
      }
      resources {
        memory = 32
        cpu    = 50
      }
    }

    task "egress-cleanup" {
      lifecycle {
        hook    = "poststop"
        sidecar = false
      }
      driver = "raw_exec"
      config {
        command = "/usr/local/bin/remove-egress.sh"
        args    = ["${NOMAD_ALLOC_ID}"]
      }
      resources {
        memory = 32
        cpu    = 50
      }
    }

    task "agent" {
      driver = "docker"

      config {
        image = "${IMAGE}"
        ports = ["gateway", "ssh"]

        port_map {
          gateway = 3000
          ssh     = 22
        }
      }

      env {
        NEARAI_API_KEY  = "${NEARAI_API_KEY}"
        NEARAI_API_URL  = "${NEARAI_API_URL}"
        SSH_PUBKEY      = "${SSH_PUBKEY}"
        INSTANCE_TOKEN  = "${INSTANCE_TOKEN}"
        INSTANCE_NAME   = "${INSTANCE_NAME}"
      }

      resources {
        memory = ${MEM_MB}
        cpu    = ${CPU_MHZ}
      }

      service {
        name = "agent-${INSTANCE_NAME}"
        port = "gateway"
        tags = ["agent", "openclaw", "instance:${INSTANCE_NAME}"]

        check {
          type     = "http"
          path     = "/health"
          port     = "gateway"
          interval = "15s"
          timeout  = "5s"
        }
      }

      service {
        name = "agent-${INSTANCE_NAME}-ssh"
        port = "ssh"
        tags = ["agent-ssh", "openclaw", "instance:${INSTANCE_NAME}"]

        check {
          type     = "tcp"
          port     = "ssh"
          interval = "15s"
          timeout  = "5s"
        }
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add nomad/templates/openclaw.nomad.hcl
git commit -m "feat: Nomad job template for openclaw service type"
```

---

### Task 5: ironclaw template

**Files:**
- Create: `nomad/templates/ironclaw.nomad.hcl`

- [ ] **Step 1: Write the ironclaw template**

Ironclaw uses two tasks in one group: worker + openssh sidecar sharing a volume.

Create `nomad/templates/ironclaw.nomad.hcl`:

```hcl
job "agent-${INSTANCE_NAME}" {
  datacenters = ["dc1"]
  type        = "service"

  group "agent" {
    count = 1

    network {
      port "gateway" {}
      port "ssh" {}
    }

    volume "agent-data" {
      type   = "host"
      source = "agent-data"
    }

    task "egress-setup" {
      lifecycle {
        hook    = "poststart"
        sidecar = false
      }
      driver = "raw_exec"
      config {
        command = "/usr/local/bin/apply-egress.sh"
        args    = ["${NOMAD_ALLOC_ID}"]
      }
      resources {
        memory = 32
        cpu    = 50
      }
    }

    task "egress-cleanup" {
      lifecycle {
        hook    = "poststop"
        sidecar = false
      }
      driver = "raw_exec"
      config {
        command = "/usr/local/bin/remove-egress.sh"
        args    = ["${NOMAD_ALLOC_ID}"]
      }
      resources {
        memory = 32
        cpu    = 50
      }
    }

    task "worker" {
      driver = "docker"

      config {
        image = "${IMAGE}"
        ports = ["gateway"]

        port_map {
          gateway = 3000
        }
      }

      volume_mount {
        volume      = "agent-data"
        destination = "/home/agent"
      }

      env {
        NEARAI_API_KEY  = "${NEARAI_API_KEY}"
        NEARAI_API_URL  = "${NEARAI_API_URL}"
        INSTANCE_TOKEN  = "${INSTANCE_TOKEN}"
        INSTANCE_NAME   = "${INSTANCE_NAME}"
      }

      resources {
        memory = ${MEM_MB}
        cpu    = ${CPU_MHZ}
      }

      service {
        name = "agent-${INSTANCE_NAME}"
        port = "gateway"
        tags = ["agent", "ironclaw", "instance:${INSTANCE_NAME}"]

        check {
          type     = "http"
          path     = "/health"
          port     = "gateway"
          interval = "15s"
          timeout  = "5s"
        }
      }
    }

    task "sshd" {
      driver = "docker"

      config {
        image = "lscr.io/linuxserver/openssh-server:latest"
        ports = ["ssh"]

        port_map {
          ssh = 2222
        }
      }

      volume_mount {
        volume      = "agent-data"
        destination = "/home/agent"
      }

      env {
        PUBLIC_KEY   = "${SSH_PUBKEY}"
        USER_NAME    = "agent"
        SUDO_ACCESS  = "true"
      }

      resources {
        memory = 128
        cpu    = 100
      }

      service {
        name = "agent-${INSTANCE_NAME}-ssh"
        port = "ssh"
        tags = ["agent-ssh", "ironclaw", "instance:${INSTANCE_NAME}"]

        check {
          type     = "tcp"
          port     = "ssh"
          interval = "15s"
          timeout  = "5s"
        }
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add nomad/templates/ironclaw.nomad.hcl
git commit -m "feat: Nomad job template for ironclaw service type"
```

---

## Chunk 3: Template Renderer

### Task 6: Template rendering logic

**Files:**
- Create: `src/template-render.ts`
- Create: `src/template-render.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/template-render.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/yan/Documents/NEAR/agent-hosting-v2 && bun test src/template-render.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/template-render.ts`:

```ts
import { readFileSync } from "fs";
import { join } from "path";

const TEMPLATES_DIR = join(import.meta.dir, "..", "nomad", "templates");

// Variables that Nomad resolves at runtime — never substitute these.
const NOMAD_VAR_PREFIX = "NOMAD_";

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name: string) => {
    if (name.startsWith(NOMAD_VAR_PREFIX)) return `\${${name}}`;
    if (name in vars) return vars[name];
    throw new Error(`Missing required template variable: ${name}`);
  });
}

export function renderJobTemplate(serviceType: string, vars: Record<string, string>): string {
  const templatePath = join(TEMPLATES_DIR, `${serviceType}.nomad.hcl`);
  const template = readFileSync(templatePath, "utf-8");
  return renderTemplate(template, vars);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/yan/Documents/NEAR/agent-hosting-v2 && bun test src/template-render.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/template-render.ts src/template-render.test.ts
git commit -m "feat: Nomad HCL template renderer with variable substitution"
```

---

### Task 7: End-to-end template validation against Nomad

- [ ] **Step 1: Render a template and dry-run it against Nomad**

```bash
cd /Users/yan/Documents/NEAR/agent-hosting-v2
bun -e "
  const { renderJobTemplate } = require('./src/template-render.ts');
  const hcl = renderJobTemplate('ironclaw-dind', {
    INSTANCE_NAME: 'test-e2e',
    IMAGE: 'alpine:latest',
    MEM_MB: '512',
    CPU_MHZ: '500',
    NEARAI_API_KEY: 'test',
    NEARAI_API_URL: 'https://example.com',
    SSH_PUBKEY: 'ssh-ed25519 AAAA',
    INSTANCE_TOKEN: 'tok',
  });
  require('fs').writeFileSync('/tmp/test-job.nomad', hcl);
"
nomad job validate /tmp/test-job.nomad
```

Expected: `Job validation successful`

If validation fails, fix the HCL template and re-run.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: adjust templates based on Nomad validation"
```
