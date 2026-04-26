# @manasvi/model-adapter

Temporary model adapter package for Milestone 5 harness.

- `mock` mode: deterministic local responses without provider credentials.
- `ollama` mode: local provider via OpenAI-compatible endpoint (default `http://localhost:11434/v1`).
- `openai` mode: real provider call through OpenAI-compatible chat completions API.
- `claude` mode: Anthropic Claude via Messages API (`https://api.anthropic.com` by default).
- `auto` mode: uses `openai` when key is present, else `claude` when `ANTHROPIC_API_KEY` exists, else falls back to `mock`.

This package is intentionally narrow and replaceable by a future production provider layer.
