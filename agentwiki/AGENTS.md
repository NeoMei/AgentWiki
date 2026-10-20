# AgentWiki session continuity

This directory is the AgentWiki application inside a parent Git worktree whose path ends with a space. A new Session must treat `AGENTWIKI_RELEASE_CANDIDATE` as the source-of-truth release lock.

Before editing or publishing, run:

```sh
node scripts/agentwiki-release-guard.mjs
```

If it fails, stop using the current checkout. Inspect `git worktree list --porcelain` and continue only from the branch named by `AGENTWIKI_RELEASE_CANDIDATE` with the locked candidate commit as an ancestor. The historical `codex/assist-qwen-fallback` checkout is not a release source.

The canonical local checkout is `/Users/neomei/.codex/worktrees/agentwiki-autochat-external/agentwiki`.

Do not infer the active AgentWiki version from a page, an old worktree, a prior chat, or a build directory. Keep the candidate lock, branch, commit, package versions, and visible Agent chat behavior aligned.
