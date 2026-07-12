import { useEffect, useState } from "react";
import { showroomListResponseSchema } from "@harnesshub/capability-schema/browser";

import { apiUrl } from "./constants";
import type { DataState, ShowroomListResponse, SuperSkillApiError } from "./superskill-types";

export function useShowroomCapabilities(options: { limit?: number; job?: string } = {}) {
  const limit = Math.min(12, Math.max(1, options.limit ?? 12));
  const job = options.job;
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<DataState<ShowroomListResponse>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: String(limit) });
    if (job) params.set("job", job);
    setState({ status: "loading" });
    fetch(`${apiUrl}/showroom/capabilities?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Partial<ShowroomListResponse> & SuperSkillApiError;
        if (!response.ok) throw apiFailure(body, response.status);
        const parsed = showroomListResponseSchema.safeParse(body);
        if (!parsed.success) {
          throw apiFailure({ error: "Showroom returned an invalid public payload.", code: "SHOWROOM_PAYLOAD_INVALID" }, 503);
        }
        const data: ShowroomListResponse = parsed.data;
        setState(data.items.length === 0 ? { status: "empty", data } : { status: "success", data });
      })
      .catch((error: Error & { code?: string; next?: string }) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          code: error.code ?? "SHOWROOM_UNAVAILABLE",
          reason: error.message || "The public catalog is unavailable.",
          next: error.next ?? "Retry, or continue with the client setup below."
        });
      });
    return () => controller.abort();
  }, [job, limit, refreshKey]);

  return { state, refresh: () => setRefreshKey((current) => current + 1) };
}

function apiFailure(body: Partial<SuperSkillApiError>, status: number) {
  return Object.assign(new Error(body.error || `Showroom request failed (${status}).`), {
    code: body.code || "SHOWROOM_UNAVAILABLE",
    next: body.next
  });
}
