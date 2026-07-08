# Trellis (the server)

This is the Trellis implementation. See `~/dev/trellis/playbook/` for strategy, specs, and the intent/reality/drift model.

## Trellis manages its own spec (dogfood)

This project's intent lives in Trellis itself — the `Trellis` project on the production relay, seeded from `playbook/specs/core.md`. Config is in `.trellis.json`. The CLI is in-repo (not npm-published), so invoke it with `node cli/trellis.mjs …`.

- **First run:** if you have no token, run `node cli/trellis.mjs join` (uses the join code in `.trellis.json`; caches a member token in `.trellis/token.json`).
- **See what needs doing:** `node cli/trellis.mjs worklist` (add `--effort <id>` to focus).
- **Record work that satisfies an assertion:** `node cli/trellis.mjs fact --statement "…" --supports <ASSERTION-ID> --evidence commit:$(git rev-parse HEAD)`. Use `--contradicts <ASSERTION-ID>` when you observe reality diverging from intent — that files drift. Never mark an assertion verified by hand; only a fact does that.
- **Status:** `node cli/trellis.mjs status`.

`core.md` currently declares no `metric:` assertions, so `node cli/trellis.mjs check` has nothing to run — verification here is the analyst path (post facts against assertions), not benchmarks. When metric assertions are added, populate the `checks` map in `.trellis.json` and `check` becomes a CI gate.
