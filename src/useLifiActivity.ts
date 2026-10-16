import { useEffect } from "react";
import { useWidgetEvents, WidgetEvent } from "@lifi/widget";
import { logActivity } from "./activity";

// Logs every route the LI.FI widget finishes (bridge or swap) to api/activity.js.
// The server checks with LI.FI that the transfer really carries the "flowfi" integrator tag,
// so only the tx hash is needed here. Same tx reported twice is counted once.
type Action = { type?: string; txHash?: string };
type Step = { execution?: { actions?: Action[]; process?: Action[] } };

export function useLifiActivity(): void {
  const events = useWidgetEvents();
  useEffect(() => {
    // Route's steps carry `execution` at runtime (RouteExtended); read it loosely so either SDK shape works.
    const onDone = (route: { steps?: unknown[] }) => {
      for (const step of (route.steps ?? []) as Step[]) {
        const actions = step.execution?.actions ?? step.execution?.process ?? [];
        const sent = actions.find((a) => a.txHash && (a.type === "SWAP" || a.type === "CROSS_CHAIN"));
        if (sent?.txHash) { logActivity("lifi", sent.txHash); return; }
      }
    };
    events.on(WidgetEvent.RouteExecutionCompleted, onDone);
    return () => { events.off(WidgetEvent.RouteExecutionCompleted, onDone); };
  }, [events]);
}
