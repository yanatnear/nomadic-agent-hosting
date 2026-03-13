# Reference configuration for Nomad's Docker driver on CrabShack nodes.
# Drop this file into /etc/nomad.d/ on every client node (or merge into
# the existing nomad.hcl). It is already embedded in the dev config
# written by bootstrap-local-dev.sh; this file is the canonical reference
# for production Ansible-managed nodes.
#
# Key settings:
# - allow_runtimes: permits sysbox-runc for DinD containers alongside
#   the default runc runtime
# - volumes.enabled: allows bind-mounting host paths, required for
#   mounting /data/crabshack/images/*.tar into DinD containers
# - pull_activity_timeout: Sysbox/DinD images can be large; 10 min
#   prevents false-positive pull failures on slow uplinks

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
