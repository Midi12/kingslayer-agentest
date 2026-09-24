# ADR-0011: Local models for private AI and air gap

- Status: proposed; to confirm at the M19-G8 evaluation
- Date: 2026-09-24
- Module: program

## Decision

The `local-ai` profile runs an OpenAI-compatible server (Ollama by default, vLLM for GPU hosts). Candidate models: a Qwen2.5 7B instruct for the LocalNavigator (log-probabilities required) and a Qwen2.5-VL 7B for the Analyst. Weights are a separate download. The choice is final only after M19-G8 passes on a host with keys and weights.
