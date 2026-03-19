# AGENTS

## QA Suite

- QA env vars are stored in `.env.local`.
- Expected vars:
  - `CRABSHACK_BASE_URL`
  - `CRABSHACK_ADMIN_TOKEN`
  - `BACKEND_TYPE`
  - `NOMAD_UI_URL`
  - `NOMAD_SSH_TUNNEL`
- Canonical command:

```bash
source .env.local && ../nearai-infra-qa/.venv/bin/pytest -v
```

- Current expected result against the deployed instance at `34.55.92.185`:
  - `28 passed, 1 skipped`
  - optional skip: `test_node_exporter_running`

## Important Runtime Assumptions

- `/nodes` must return the real SSH endpoint for the Nomad client host.
- The API supports this through:
  - `NODE_SSH_HOST`
  - `NODE_SSH_PORT`
  - `NODE_SSH_USER`
- If host-level QA tests suddenly fail, check `/nodes` first before changing QA.

- Stop is asynchronous at the Nomad layer.
- The API now waits for Nomad convergence before reporting `stopped`.
- If `test_stop_agent` regresses, inspect stop/read reconciliation in the API before changing tests.

- Persistent workspace paths are runtime-dependent.
- The QA repo now detects a writable workspace path at runtime instead of assuming `/workspace`.
- If persistence tests fail, verify the actual container mount path before changing Crabshack.

## Related External Repo

- This repo depends on local fixes in `../nearai-infra-qa` for this deployment:
  - container/task discovery
  - backend exec shell quoting
  - runtime workspace detection
- If QA behavior changes unexpectedly, inspect that repo as well as this one.
