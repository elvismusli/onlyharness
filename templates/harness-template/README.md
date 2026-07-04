# Harness Template

Use this repository as the starting point for a new Harness.Hub workflow.

## Local checks

```bash
hh validate --strict
hh eval
hh gate
```

## Publish loop

1. Fork or create from template.
2. Edit `harness.yaml`, `agents/`, `evals/` and `examples/`.
3. Open PR.
4. Review semantic diff, risk delta and eval result.
