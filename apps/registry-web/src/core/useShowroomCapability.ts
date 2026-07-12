import { useEffect, useState } from "react";
import { showroomCapabilitySchema } from "@harnesshub/capability-schema/browser";

import { apiUrl } from "./constants";
import type { DataState, ShowroomCapability, SuperSkillApiError } from "./superskill-types";

export function useShowroomCapability(capabilityId: string | undefined) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<DataState<ShowroomCapability>>(
    capabilityId ? { status: "loading" } : { status: "idle" }
  );

  useEffect(() => {
    if (!capabilityId) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(`${apiUrl}/showroom/capabilities/${encodeURIComponent(capabilityId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as ShowroomCapability & SuperSkillApiError;
        if (response.status === 404) {
          setState({ status: "not_found", code: body.code || "CAPABILITY_NOT_FOUND", reason: body.error || "This resource was not found." });
          return;
        }
        if (!response.ok) throw Object.assign(new Error(body.error || `Trust report request failed (${response.status}).`), body);
        const parsed = showroomCapabilitySchema.safeParse(body);
        if (!parsed.success) throw Object.assign(new Error("Trust report returned an invalid public payload."), { code: "SHOWROOM_PAYLOAD_INVALID" });
        setState({ status: "success", data: parsed.data });
      })
      .catch((error: Error & { code?: string; next?: string }) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          code: error.code ?? "SHOWROOM_UNAVAILABLE",
          reason: error.message || "The trust report is unavailable.",
          next: error.next ?? "Retry or return to the showroom."
        });
      });
    return () => controller.abort();
  }, [capabilityId, refreshKey]);

  return { state, refresh: () => setRefreshKey((current) => current + 1) };
}
