# Harness Template

Use this repository as the starting point for a new Harness.Hub workflow.

Trust status: unverified scaffold. The template does not ship a measured eval score; add real case scores or wire a real evaluator before publishing.

## Local checks

```bash
hh validate --strict
hh eval
hh gate
```

## Publish loop

1. Fork or create from template.
2. Edit `harness.yaml`, `agents/`, `evals/` and `examples/`.
3. Add measured eval scores to `evals/cases/*.yaml` or replace the eval runner.
4. Open PR.
5. Review semantic diff, risk delta and eval result.
