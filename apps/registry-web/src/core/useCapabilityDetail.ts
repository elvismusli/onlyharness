import { useCallback, useRef, useState } from "react";

import type { DataState, ManagedCapability, SuperSkillApiError } from "./superskill-types";

type CapabilityTransport = (capabilityId: string, signal: AbortSignal) => Promise<ManagedCapability>;

/** Protected/internal capability detail adapter. It intentionally has no fetch
 * default so the browser never invents or persists an internal Bearer token. */
export function useCapabilityDetail(options: { transport?: CapabilityTransport } = {}) {
  const [state, setState] = useState<DataState<ManagedCapability>>({ status: "idle" });
  const active = useRef<AbortController | null>(null);

  const load = useCallback(
    async (capabilityId: string) => {
      active.current?.abort();
      if (!options.transport) {
        setState({
          status: "error",
          code: "CAPABILITY_TRANSPORT_UNAVAILABLE",
          reason: "Managed capability detail is available in the terminal client only.",
          next: "Use the public showroom trust page or open the SuperSkill plugin."
        });
        return;
      }
      const controller = new AbortController();
      active.current = controller;
      setState({ status: "loading" });
      try {
        setState({ status: "success", data: await options.transport(capabilityId, controller.signal) });
      } catch (cause) {
        if (controller.signal.aborted) return;
        const error = cause as Error & Partial<SuperSkillApiError> & { status?: number };
        const common = { code: error.code ?? "CAPABILITY_DETAIL_FAILED", reason: error.message || error.error || "Capability detail failed.", next: error.next };
        setState(error.status === 404 ? { status: "not_found", ...common } : { status: "error", ...common });
      }
    },
    [options.transport]
  );

  return { state, load, reset: () => setState({ status: "idle" }) };
}
