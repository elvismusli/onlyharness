import { useCallback, useRef, useState } from "react";

import type {
  RecommendationRequest,
  RecommendationResponse,
  SuperSkillApiError
} from "./superskill-types";

export type RecommendationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "recommend"; data: RecommendationResponse & { decision: "recommend" } }
  | { status: "clarify"; data: RecommendationResponse & { decision: "needs_clarification" } }
  | { status: "no_match"; data: RecommendationResponse & { decision: "no_safe_match" } }
  | { status: "error"; code: string; reason: string; next?: string };

type RecommendationTransport = (
  request: RecommendationRequest,
  signal: AbortSignal
) => Promise<RecommendationResponse>;

/**
 * Future-transport-ready managed recommendation state. The browser has no
 * default transport because internal-alpha recommendation auth belongs in the
 * terminal client; callers must inject a separately approved public transport.
 */
export function useRecommendations(options: { transport?: RecommendationTransport } = {}) {
  const [state, setState] = useState<RecommendationState>({ status: "idle" });
  const active = useRef<AbortController | null>(null);

  const recommend = useCallback(
    async (request: RecommendationRequest) => {
      active.current?.abort();
      const task = request.task.replace(/\s+/g, " ").trim();
      const localError = validateTask(task);
      if (localError) {
        setState(localError);
        return;
      }
      if (!options.transport) {
        setState({
          status: "error",
          code: "RECOMMENDATION_TRANSPORT_UNAVAILABLE",
          reason: "Recommendations run inside Claude Code or Codex during internal alpha.",
          next: "Install the SuperSkill plugin, then paste the task into a new client session."
        });
        return;
      }
      const controller = new AbortController();
      active.current = controller;
      setState({ status: "loading" });
      try {
        const data = await options.transport({ ...request, task }, controller.signal);
        if (data.decision === "recommend") {
          setState({ status: "recommend", data: data as RecommendationResponse & { decision: "recommend" } });
        } else if (data.decision === "needs_clarification") {
          setState({ status: "clarify", data: data as RecommendationResponse & { decision: "needs_clarification" } });
        } else {
          setState({ status: "no_match", data: data as RecommendationResponse & { decision: "no_safe_match" } });
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        const error = cause as Error & Partial<SuperSkillApiError>;
        setState({
          status: "error",
          code: error.code ?? "RECOMMENDATION_FAILED",
          reason: error.message || error.error || "The recommendation request failed.",
          next: error.next
        });
      }
    },
    [options.transport]
  );

  return {
    state,
    recommend,
    reset: () => {
      active.current?.abort();
      setState({ status: "idle" });
    }
  };
}

function validateTask(task: string): Extract<RecommendationState, { status: "error" }> | null {
  if (task.length < 3 || task.length > 500) {
    return { status: "error", code: "TASK_INVALID", reason: "Task must be between 3 and 500 characters.", next: "Describe one concrete task." };
  }
  if (/(?:sk-[a-z0-9_-]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:api[_-]?key|token|password)\s*[:=]\s*\S+)/i.test(task)) {
    return { status: "error", code: "TASK_CONTAINS_SECRET", reason: "The task looks like it contains a secret.", next: "Remove credentials and try again." };
  }
  return null;
}
