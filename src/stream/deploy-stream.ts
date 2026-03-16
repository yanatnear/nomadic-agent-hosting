export interface DeployEvent {
  status: string;
  message: string;
}

export function formatAllocEvent(alloc: Record<string, unknown>): DeployEvent {
  const clientStatus = alloc.ClientStatus as string;
  const taskStates = alloc.TaskStates as Record<
    string,
    { State: string; Events?: { DisplayMessage: string }[] }
  > | null;

  if (clientStatus === "pending") {
    return { status: "pending", message: "Waiting for scheduling..." };
  }
  if (clientStatus === "running") {
    return { status: "running", message: "Container is running" };
  }
  if (clientStatus === "failed") {
    let errorMsg = "Container failed";
    if (taskStates) {
      for (const [, state] of Object.entries(taskStates)) {
        if (state.State === "dead" && state.Events) {
          const lastEvent = state.Events[state.Events.length - 1];
          if (lastEvent?.DisplayMessage) errorMsg = lastEvent.DisplayMessage;
        }
      }
    }
    return { status: "error", message: errorMsg };
  }
  return { status: clientStatus, message: `Allocation status: ${clientStatus}` };
}

export async function* streamDeployEvents(
  nomadAddr: string,
  evalId: string,
): AsyncGenerator<DeployEvent> {
  let allocId: string | null = null;

  for (let i = 0; i < 30; i++) {
    const resp = await fetch(`${nomadAddr}/v1/evaluation/${evalId}/allocations`);
    if (resp.ok) {
      const allocs = (await resp.json()) as { ID: string }[];
      if (allocs.length > 0) {
        allocId = allocs[0].ID;
        break;
      }
    }
    yield { status: "pending", message: "Waiting for scheduling..." };
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!allocId) {
    yield { status: "error", message: "No allocation created after 30s" };
    return;
  }

  for (let i = 0; i < 120; i++) {
    const resp = await fetch(`${nomadAddr}/v1/allocation/${allocId}`);
    if (!resp.ok) {
      yield { status: "error", message: "Failed to query allocation" };
      return;
    }
    const alloc = await resp.json();
    const event = formatAllocEvent(alloc);
    yield event;
    if (event.status === "running" || event.status === "error") return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  yield { status: "error", message: "Deploy timed out after 120s" };
}
