# Nomad + Consul Cluster Setup

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Nomad + Consul cluster on bare-metal/VM nodes that can schedule Sysbox-enabled Docker containers.

**Architecture:** 3 Nomad+Consul server nodes for HA (Raft consensus). All remaining nodes run Nomad+Consul client agents that auto-join the cluster. Each client node has Docker + Sysbox installed and the Nomad Docker driver configured to allow `sysbox-runc` runtime.

**Tech Stack:** Nomad 1.7+, Consul 1.18+, Docker 24+, Sysbox CE 0.6.6+, Ansible (for node provisioning), bash (bootstrap scripts)

---

## File Structure

```
agent-hosting-v2/
  infra/
    ansible/
      inventory.yml              # Node inventory (servers, clients)
      playbooks/
        bootstrap-server.yml     # Install + configure Nomad/Consul server
        bootstrap-client.yml     # Install + configure Nomad/Consul client
      roles/
        nomad-server/
          tasks/main.yml
          templates/nomad-server.hcl.j2
        nomad-client/
          tasks/main.yml
          templates/nomad-client.hcl.j2
        consul-server/
          tasks/main.yml
          templates/consul-server.hcl.j2
        consul-client/
          tasks/main.yml
          templates/consul-client.hcl.j2
        docker-sysbox/
          tasks/main.yml         # Install Docker + Sysbox
      group_vars/
        all.yml                  # Shared vars (datacenter name, join addrs)
        servers.yml              # Server-specific vars
        clients.yml              # Client-specific vars
    scripts/
      bootstrap-local-dev.sh     # Single-node dev setup (no Ansible needed)
      validate-cluster.sh        # Health check: Nomad + Consul + Sysbox
    configs/
      nomad-docker-plugin.hcl    # Reference config for Docker plugin with sysbox-runc
```

---

## Chunk 1: Local Dev Environment

### Task 1: Single-node dev bootstrap script

**Files:**
- Create: `infra/scripts/bootstrap-local-dev.sh`

- [ ] **Step 1: Write the validation script first (test-first)**

This script will be used to verify the bootstrap worked. Write it first so we know what success looks like.

Create `infra/scripts/validate-cluster.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

FAIL=0

check() {
  local name="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "OK: $name"
  else
    echo "FAIL: $name"
    FAIL=1
  fi
}

check "Nomad agent is running"    "nomad agent-info"
check "Consul agent is running"   "consul info"
check "Docker daemon is running"  "docker info"
check "Sysbox runtime available"  "docker info --format '{{.Runtimes}}' | grep -q sysbox-runc"
check "Nomad can reach Docker"    "nomad node status -self -json | grep -q '\"docker.version\"'"
check "Nomad allows sysbox-runc"  "nomad node status -self -json | grep -q sysbox-runc"

if [ "$FAIL" -eq 0 ]; then
  echo -e "\nAll checks passed."
else
  echo -e "\nSome checks failed."
  exit 1
fi
```

- [ ] **Step 2: Run validation script — expect it to fail**

Run: `bash infra/scripts/validate-cluster.sh`
Expected: FAIL on all checks (nothing installed yet)

- [ ] **Step 3: Write the bootstrap script**

Create `infra/scripts/bootstrap-local-dev.sh`:

```bash
#!/usr/bin/env bash
# Sets up a single-node Nomad + Consul dev cluster with Docker + Sysbox.
# Run as root or with sudo.
set -euo pipefail

NOMAD_VERSION="1.7.7"
CONSUL_VERSION="1.18.2"
ARCH="$(dpkg --print-architecture)"  # amd64 or arm64

echo "=== Installing Consul ${CONSUL_VERSION} ==="
if ! command -v consul &>/dev/null; then
  curl -fsSL -o /tmp/consul.zip \
    "https://releases.hashicorp.com/consul/${CONSUL_VERSION}/consul_${CONSUL_VERSION}_linux_${ARCH}.zip"
  unzip -o /tmp/consul.zip -d /usr/local/bin/
  rm /tmp/consul.zip
fi

echo "=== Installing Nomad ${NOMAD_VERSION} ==="
if ! command -v nomad &>/dev/null; then
  curl -fsSL -o /tmp/nomad.zip \
    "https://releases.hashicorp.com/nomad/${NOMAD_VERSION}/nomad_${NOMAD_VERSION}_linux_${ARCH}.zip"
  unzip -o /tmp/nomad.zip -d /usr/local/bin/
  rm /tmp/nomad.zip
fi

echo "=== Creating data directories ==="
mkdir -p /opt/nomad/data /opt/consul/data /data/crabshack/images

echo "=== Writing Nomad dev config ==="
cat > /etc/nomad.d/nomad.hcl <<'EOF'
datacenter = "dc1"
data_dir   = "/opt/nomad/data"

server {
  enabled          = true
  bootstrap_expect = 1
}

client {
  enabled = true
}

plugin "docker" {
  config {
    allow_runtimes = ["sysbox-runc", "runc"]
    volumes {
      enabled = true
    }
  }
}
EOF

echo "=== Writing Consul dev config ==="
mkdir -p /etc/consul.d
cat > /etc/consul.d/consul.hcl <<'EOF'
datacenter = "dc1"
data_dir   = "/opt/consul/data"
server     = true
bootstrap_expect = 1
client_addr      = "0.0.0.0"
bind_addr        = "0.0.0.0"
ui_config {
  enabled = true
}
EOF

echo "=== Starting Consul ==="
if ! systemctl is-active --quiet consul 2>/dev/null; then
  # Create systemd unit if not present
  cat > /etc/systemd/system/consul.service <<'UNIT'
[Unit]
Description=Consul Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/consul agent -config-dir=/etc/consul.d
Restart=on-failure
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now consul
fi

echo "=== Starting Nomad ==="
if ! systemctl is-active --quiet nomad 2>/dev/null; then
  cat > /etc/systemd/system/nomad.service <<'UNIT'
[Unit]
Description=Nomad Agent
After=network.target consul.service

[Service]
ExecStart=/usr/local/bin/nomad agent -config=/etc/nomad.d
Restart=on-failure
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now nomad
fi

echo "=== Waiting for Nomad to be ready ==="
for i in $(seq 1 30); do
  if nomad agent-info >/dev/null 2>&1; then
    echo "Nomad is ready."
    break
  fi
  sleep 1
done

echo "=== Done. Run validate-cluster.sh to verify. ==="
```

- [ ] **Step 4: Run the bootstrap on a test node**

Run: `sudo bash infra/scripts/bootstrap-local-dev.sh`
Expected: Nomad + Consul installed and running.

- [ ] **Step 5: Run validation script — expect it to pass**

Run: `bash infra/scripts/validate-cluster.sh`
Expected: All checks pass.

- [ ] **Step 6: Commit**

```bash
git add infra/scripts/bootstrap-local-dev.sh infra/scripts/validate-cluster.sh
git commit -m "feat: single-node dev bootstrap for Nomad + Consul + Sysbox"
```

---

### Task 2: Nomad Docker plugin config reference

**Files:**
- Create: `infra/configs/nomad-docker-plugin.hcl`

- [ ] **Step 1: Write reference config with comments**

Create `infra/configs/nomad-docker-plugin.hcl`:

```hcl
# Reference configuration for Nomad's Docker driver on CrabShack nodes.
# This goes in /etc/nomad.d/ on every client node.
#
# Key settings:
# - allow_runtimes: permits sysbox-runc for DinD containers
# - volumes.enabled: allows bind-mounting host paths (needed for worker image tarballs)

plugin "docker" {
  config {
    # Allow both standard and Sysbox runtimes
    allow_runtimes = ["runc", "sysbox-runc"]

    # Required for mounting /data/crabshack/images/*.tar into DinD containers
    volumes {
      enabled = true
    }

    # Pull timeout — Sysbox images can be large
    pull_activity_timeout = "10m"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add infra/configs/nomad-docker-plugin.hcl
git commit -m "docs: reference Nomad Docker plugin config for Sysbox"
```

---

## Chunk 2: Ansible Playbooks for Multi-Node

### Task 3: Ansible inventory and shared variables

**Files:**
- Create: `infra/ansible/inventory.yml`
- Create: `infra/ansible/group_vars/all.yml`
- Create: `infra/ansible/group_vars/servers.yml`
- Create: `infra/ansible/group_vars/clients.yml`

- [ ] **Step 1: Write inventory template**

Create `infra/ansible/inventory.yml`:

```yaml
# Edit this file with your actual node hostnames/IPs.
# Servers run Nomad+Consul in server mode (need 3 or 5 for HA).
# Clients run Nomad+Consul in client mode and accept workloads.
all:
  children:
    servers:
      hosts:
        server-1:
          ansible_host: 10.0.0.1
        server-2:
          ansible_host: 10.0.0.2
        server-3:
          ansible_host: 10.0.0.3
    clients:
      hosts:
        client-1:
          ansible_host: 10.0.1.1
        # Add more client nodes here
```

- [ ] **Step 2: Write shared variables**

Create `infra/ansible/group_vars/all.yml`:

```yaml
datacenter: dc1
nomad_version: "1.7.7"
consul_version: "1.18.2"

# Consul join addresses — these are the server private IPs.
# Override in your inventory if IPs differ.
consul_retry_join:
  - "10.0.0.1"
  - "10.0.0.2"
  - "10.0.0.3"

# Nomad server join addresses (same as Consul servers in this setup)
nomad_retry_join:
  - "10.0.0.1"
  - "10.0.0.2"
  - "10.0.0.3"

# Data directories
nomad_data_dir: /opt/nomad/data
consul_data_dir: /opt/consul/data
crabshack_data_dir: /data/crabshack
```

Create `infra/ansible/group_vars/servers.yml`:

```yaml
nomad_server: true
nomad_client: false
consul_server: true
consul_bootstrap_expect: 3
```

Create `infra/ansible/group_vars/clients.yml`:

```yaml
nomad_server: false
nomad_client: true
consul_server: false
```

- [ ] **Step 3: Commit**

```bash
git add infra/ansible/
git commit -m "feat: Ansible inventory and group vars for Nomad+Consul cluster"
```

---

### Task 4: Docker + Sysbox Ansible role

**Files:**
- Create: `infra/ansible/roles/docker-sysbox/tasks/main.yml`

- [ ] **Step 1: Write the role**

Create `infra/ansible/roles/docker-sysbox/tasks/main.yml`:

```yaml
---
# Install Docker CE and Sysbox on Ubuntu 22.04+

- name: Install Docker prerequisites
  apt:
    name: [ca-certificates, curl, gnupg]
    state: present
    update_cache: yes

- name: Add Docker GPG key
  shell: |
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  args:
    creates: /etc/apt/keyrings/docker.asc

- name: Add Docker apt repo
  shell: |
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
      https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
      > /etc/apt/sources.list.d/docker.list
  args:
    creates: /etc/apt/sources.list.d/docker.list

- name: Install Docker CE
  apt:
    name: [docker-ce, docker-ce-cli, containerd.io, docker-compose-plugin]
    state: present
    update_cache: yes

- name: Enable Docker
  systemd:
    name: docker
    enabled: yes
    state: started

- name: Check if Sysbox is installed
  command: dpkg -l sysbox-ce
  register: sysbox_check
  ignore_errors: yes
  changed_when: false

- name: Download Sysbox CE
  get_url:
    url: "https://downloads.nestybox.com/sysbox/releases/v0.6.6/sysbox-ce_0.6.6-0.linux_amd64.deb"
    dest: /tmp/sysbox-ce.deb
  when: sysbox_check.rc != 0

- name: Install Sysbox CE
  apt:
    deb: /tmp/sysbox-ce.deb
  when: sysbox_check.rc != 0

- name: Verify sysbox-runc is registered with Docker
  shell: docker info --format '{{ "{{" }}.Runtimes{{ "}}" }}' | grep -q sysbox-runc
  changed_when: false

- name: Create crabshack data directories
  file:
    path: "{{ item }}"
    state: directory
    mode: "0755"
  loop:
    - "{{ crabshack_data_dir }}"
    - "{{ crabshack_data_dir }}/images"
```

- [ ] **Step 2: Commit**

```bash
git add infra/ansible/roles/docker-sysbox/
git commit -m "feat: Ansible role for Docker + Sysbox installation"
```

---

### Task 5: Consul server and client roles

**Files:**
- Create: `infra/ansible/roles/consul-server/tasks/main.yml`
- Create: `infra/ansible/roles/consul-server/templates/consul-server.hcl.j2`
- Create: `infra/ansible/roles/consul-client/tasks/main.yml`
- Create: `infra/ansible/roles/consul-client/templates/consul-client.hcl.j2`

- [ ] **Step 1: Write Consul server role**

Create `infra/ansible/roles/consul-server/templates/consul-server.hcl.j2`:

```hcl
datacenter       = "{{ datacenter }}"
data_dir         = "{{ consul_data_dir }}"
server           = true
bootstrap_expect = {{ consul_bootstrap_expect }}
bind_addr        = "{{ ansible_default_ipv4.address }}"
client_addr      = "0.0.0.0"

retry_join = {{ consul_retry_join | to_json }}

ui_config {
  enabled = true
}

connect {
  enabled = true
}
```

Create `infra/ansible/roles/consul-server/tasks/main.yml`:

```yaml
---
- name: Download Consul
  get_url:
    url: "https://releases.hashicorp.com/consul/{{ consul_version }}/consul_{{ consul_version }}_linux_amd64.zip"
    dest: /tmp/consul.zip
  register: consul_download

- name: Install Consul
  unarchive:
    src: /tmp/consul.zip
    dest: /usr/local/bin/
    remote_src: yes
  when: consul_download.changed

- name: Create Consul config dir
  file:
    path: /etc/consul.d
    state: directory
    mode: "0755"

- name: Create Consul data dir
  file:
    path: "{{ consul_data_dir }}"
    state: directory
    mode: "0755"

- name: Write Consul server config
  template:
    src: consul-server.hcl.j2
    dest: /etc/consul.d/consul.hcl
  notify: restart consul

- name: Write Consul systemd unit
  copy:
    content: |
      [Unit]
      Description=Consul Agent
      After=network.target
      [Service]
      ExecStart=/usr/local/bin/consul agent -config-dir=/etc/consul.d
      Restart=on-failure
      LimitNOFILE=65536
      [Install]
      WantedBy=multi-user.target
    dest: /etc/systemd/system/consul.service
  notify: restart consul

- name: Enable and start Consul
  systemd:
    name: consul
    enabled: yes
    state: started
    daemon_reload: yes

handlers:
  - name: restart consul
    systemd:
      name: consul
      state: restarted
```

- [ ] **Step 2: Write Consul client role**

Create `infra/ansible/roles/consul-client/templates/consul-client.hcl.j2`:

```hcl
datacenter  = "{{ datacenter }}"
data_dir    = "{{ consul_data_dir }}"
server      = false
bind_addr   = "{{ ansible_default_ipv4.address }}"
client_addr = "0.0.0.0"

retry_join = {{ consul_retry_join | to_json }}
```

Create `infra/ansible/roles/consul-client/tasks/main.yml`:

```yaml
---
- name: Download Consul
  get_url:
    url: "https://releases.hashicorp.com/consul/{{ consul_version }}/consul_{{ consul_version }}_linux_amd64.zip"
    dest: /tmp/consul.zip
  register: consul_download

- name: Install Consul
  unarchive:
    src: /tmp/consul.zip
    dest: /usr/local/bin/
    remote_src: yes
  when: consul_download.changed

- name: Create Consul config dir
  file:
    path: /etc/consul.d
    state: directory
    mode: "0755"

- name: Create Consul data dir
  file:
    path: "{{ consul_data_dir }}"
    state: directory
    mode: "0755"

- name: Write Consul client config
  template:
    src: consul-client.hcl.j2
    dest: /etc/consul.d/consul.hcl
  notify: restart consul

- name: Write Consul systemd unit
  copy:
    content: |
      [Unit]
      Description=Consul Agent
      After=network.target
      [Service]
      ExecStart=/usr/local/bin/consul agent -config-dir=/etc/consul.d
      Restart=on-failure
      LimitNOFILE=65536
      [Install]
      WantedBy=multi-user.target
    dest: /etc/systemd/system/consul.service
  notify: restart consul

- name: Enable and start Consul
  systemd:
    name: consul
    enabled: yes
    state: started
    daemon_reload: yes

handlers:
  - name: restart consul
    systemd:
      name: consul
      state: restarted
```

- [ ] **Step 3: Commit**

```bash
git add infra/ansible/roles/consul-server/ infra/ansible/roles/consul-client/
git commit -m "feat: Ansible roles for Consul server and client"
```

---

### Task 6: Nomad server and client roles

**Files:**
- Create: `infra/ansible/roles/nomad-server/tasks/main.yml`
- Create: `infra/ansible/roles/nomad-server/templates/nomad-server.hcl.j2`
- Create: `infra/ansible/roles/nomad-client/tasks/main.yml`
- Create: `infra/ansible/roles/nomad-client/templates/nomad-client.hcl.j2`

- [ ] **Step 1: Write Nomad server role**

Create `infra/ansible/roles/nomad-server/templates/nomad-server.hcl.j2`:

```hcl
datacenter = "{{ datacenter }}"
data_dir   = "{{ nomad_data_dir }}"

server {
  enabled          = true
  bootstrap_expect = {{ consul_bootstrap_expect }}
  server_join {
    retry_join = {{ nomad_retry_join | map('regex_replace', '^(.*)$', '\\1:4648') | list | to_json }}
  }
}
```

Create `infra/ansible/roles/nomad-server/tasks/main.yml`:

```yaml
---
- name: Download Nomad
  get_url:
    url: "https://releases.hashicorp.com/nomad/{{ nomad_version }}/nomad_{{ nomad_version }}_linux_amd64.zip"
    dest: /tmp/nomad.zip
  register: nomad_download

- name: Install Nomad
  unarchive:
    src: /tmp/nomad.zip
    dest: /usr/local/bin/
    remote_src: yes
  when: nomad_download.changed

- name: Create Nomad config dir
  file:
    path: /etc/nomad.d
    state: directory
    mode: "0755"

- name: Create Nomad data dir
  file:
    path: "{{ nomad_data_dir }}"
    state: directory
    mode: "0755"

- name: Write Nomad server config
  template:
    src: nomad-server.hcl.j2
    dest: /etc/nomad.d/nomad.hcl
  notify: restart nomad

- name: Write Nomad systemd unit
  copy:
    content: |
      [Unit]
      Description=Nomad Agent
      After=network.target consul.service
      [Service]
      ExecStart=/usr/local/bin/nomad agent -config=/etc/nomad.d
      Restart=on-failure
      LimitNOFILE=65536
      [Install]
      WantedBy=multi-user.target
    dest: /etc/systemd/system/nomad.service
  notify: restart nomad

- name: Enable and start Nomad
  systemd:
    name: nomad
    enabled: yes
    state: started
    daemon_reload: yes

handlers:
  - name: restart nomad
    systemd:
      name: nomad
      state: restarted
```

- [ ] **Step 2: Write Nomad client role**

Create `infra/ansible/roles/nomad-client/templates/nomad-client.hcl.j2`:

```hcl
datacenter = "{{ datacenter }}"
data_dir   = "{{ nomad_data_dir }}"

client {
  enabled = true
  servers = {{ nomad_retry_join | map('regex_replace', '^(.*)$', '\\1:4647') | list | to_json }}
}

plugin "docker" {
  config {
    allow_runtimes = ["runc", "sysbox-runc"]
    volumes {
      enabled = true
    }
    pull_activity_timeout = "10m"
  }
}
```

Create `infra/ansible/roles/nomad-client/tasks/main.yml`:

```yaml
---
- name: Download Nomad
  get_url:
    url: "https://releases.hashicorp.com/nomad/{{ nomad_version }}/nomad_{{ nomad_version }}_linux_amd64.zip"
    dest: /tmp/nomad.zip
  register: nomad_download

- name: Install Nomad
  unarchive:
    src: /tmp/nomad.zip
    dest: /usr/local/bin/
    remote_src: yes
  when: nomad_download.changed

- name: Create Nomad config dir
  file:
    path: /etc/nomad.d
    state: directory
    mode: "0755"

- name: Create Nomad data dir
  file:
    path: "{{ nomad_data_dir }}"
    state: directory
    mode: "0755"

- name: Write Nomad client config
  template:
    src: nomad-client.hcl.j2
    dest: /etc/nomad.d/nomad.hcl
  notify: restart nomad

- name: Write Nomad systemd unit
  copy:
    content: |
      [Unit]
      Description=Nomad Agent
      After=network.target consul.service
      [Service]
      ExecStart=/usr/local/bin/nomad agent -config=/etc/nomad.d
      Restart=on-failure
      LimitNOFILE=65536
      [Install]
      WantedBy=multi-user.target
    dest: /etc/systemd/system/nomad.service
  notify: restart nomad

- name: Enable and start Nomad
  systemd:
    name: nomad
    enabled: yes
    state: started
    daemon_reload: yes

handlers:
  - name: restart nomad
    systemd:
      name: nomad
      state: restarted
```

- [ ] **Step 3: Commit**

```bash
git add infra/ansible/roles/nomad-server/ infra/ansible/roles/nomad-client/
git commit -m "feat: Ansible roles for Nomad server and client"
```

---

### Task 7: Top-level playbooks

**Files:**
- Create: `infra/ansible/playbooks/bootstrap-server.yml`
- Create: `infra/ansible/playbooks/bootstrap-client.yml`

- [ ] **Step 1: Write server playbook**

Create `infra/ansible/playbooks/bootstrap-server.yml`:

```yaml
---
# Bootstrap a Nomad+Consul server node.
# Usage: ansible-playbook -i inventory.yml playbooks/bootstrap-server.yml
- hosts: servers
  become: yes
  roles:
    - docker-sysbox
    - consul-server
    - nomad-server
```

- [ ] **Step 2: Write client playbook**

Create `infra/ansible/playbooks/bootstrap-client.yml`:

```yaml
---
# Bootstrap a Nomad+Consul client node with Docker + Sysbox.
# Usage: ansible-playbook -i inventory.yml playbooks/bootstrap-client.yml
- hosts: clients
  become: yes
  roles:
    - docker-sysbox
    - consul-client
    - nomad-client
```

- [ ] **Step 3: Commit**

```bash
git add infra/ansible/playbooks/
git commit -m "feat: top-level Ansible playbooks for server and client bootstrap"
```

---

### Task 8: End-to-end cluster validation

- [ ] **Step 1: Bootstrap a 1-server + 1-client cluster (or use local dev script for single node)**

For local dev:
```bash
sudo bash infra/scripts/bootstrap-local-dev.sh
```

For multi-node:
```bash
ansible-playbook -i infra/ansible/inventory.yml infra/ansible/playbooks/bootstrap-server.yml
ansible-playbook -i infra/ansible/inventory.yml infra/ansible/playbooks/bootstrap-client.yml
```

- [ ] **Step 2: Validate the cluster**

```bash
bash infra/scripts/validate-cluster.sh
```

Expected: All checks pass.

- [ ] **Step 3: Run a test Sysbox container via Nomad**

Create a one-off test job:

```bash
cat > /tmp/test-sysbox.nomad <<'EOF'
job "test-sysbox" {
  type = "batch"
  group "test" {
    task "sysbox-check" {
      driver = "docker"
      config {
        image   = "alpine:latest"
        runtime = "sysbox-runc"
        command = "sh"
        args    = ["-c", "echo 'Sysbox works!' && cat /proc/uptime"]
      }
      resources {
        memory = 128
        cpu    = 100
      }
    }
  }
}
EOF
nomad job run /tmp/test-sysbox.nomad
```

Wait for completion:
```bash
nomad job status test-sysbox
```

Expected: Status `dead` (batch job completed), task state `Dead` with exit code 0.

Check logs:
```bash
nomad alloc logs $(nomad job allocs -t '{{range .}}{{.ID}}{{end}}' test-sysbox)
```

Expected output includes: `Sysbox works!`

- [ ] **Step 4: Clean up test job**

```bash
nomad job stop -purge test-sysbox
```

- [ ] **Step 5: Commit validation results / notes**

```bash
git add -A
git commit -m "test: validate Nomad cluster with Sysbox runtime"
```
