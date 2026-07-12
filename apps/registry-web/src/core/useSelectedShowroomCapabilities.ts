import { useEffect, useState } from "react";
import { selectedShowroomListResponseSchema } from "@harnesshub/capability-schema/browser";

import { apiUrl } from "./constants";
import type { DataState, SelectedShowroomListResponse, SuperSkillApiError } from "./superskill-types";

export function useSelectedShowroomCapabilities(options: { limit?: number; job?: string; enabled?: boolean } = {}) {
  const limit = Math.min(12, Math.max(1, options.limit ?? 12));
  const job = options.job;
  const enabled = options.enabled ?? true;
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<DataState<SelectedShowroomListResponse>>(enabled ? { status: "loading" } : { status: "idle" });

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: String(limit) });
    if (job) params.set("job", job);
    setState({ status: "loading" });
    fetch(`${apiUrl}/showroom/selected?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Partial<SelectedShowroomListResponse> & SuperSkillApiError;
        if (!response.ok) throw apiFailure(body, response.status);
        const parsed = selectedShowroomListResponseSchema.safeParse(body);
        if (!parsed.success) {
          throw apiFailure({ error: "Selected shelf returned an invalid public payload.", code: "SELECTED_SHOWROOM_PAYLOAD_INVALID" }, 503);
        }
        const data: SelectedShowroomListResponse = parsed.data;
        setState(data.items.length === 0 ? { status: "empty", data } : { status: "success", data });
      })
      .catch((error: Error & { code?: string; next?: string }) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          code: error.code ?? "SELECTED_SHOWROOM_UNAVAILABLE",
          reason: error.message || "The selected shelf is unavailable.",
          next: error.next ?? "Retry, or browse the classic OnlyHarness catalog."
        });
      });
    return () => controller.abort();
  }, [enabled, job, limit, refreshKey]);

  return { state, refresh: () => setRefreshKey((current) => current + 1) };
}

function apiFailure(body: Partial<SuperSkillApiError>, status: number) {
  return Object.assign(new Error(body.error || `Selected shelf request failed (${status}).`), {
    code: body.code || "SELECTED_SHOWROOM_UNAVAILABLE",
    next: body.next
  });
}
