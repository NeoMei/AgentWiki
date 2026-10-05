#!/bin/sh
set -eu
probe_source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
probe_runtime_dir=$(mktemp -d /tmp/agentwiki-visual-editor-probe.XXXXXX)
cp "$probe_source_dir/probe.mjs" "$probe_source_dir/fixtures.json" "$probe_runtime_dir/"
npm install --prefix "$probe_runtime_dir" --save-exact --no-audit --no-fund @tiptap/markdown@3.31.4 @tiptap/core@3.31.4 @tiptap/starter-kit@3.31.4 @tiptap/extension-table@3.31.4 @tiptap/extension-image@3.31.4 @tiptap/extension-list@3.31.4 @tiptap/extension-mathematics@3.31.4 jsdom@26.1.0 diff@8.0.2 unified@11.0.5 remark-parse@11.0.0 remark-gfm@4.0.1 remark-math@6.0.0 remark-breaks@4.0.0 tsx@4.20.6
export AGENTWIKI_REPO="${AGENTWIKI_REPO:-$(CDPATH= cd -- "$probe_source_dir/../../../../.." && pwd)}"
export PROBE_OUTPUT="${PROBE_OUTPUT:-$probe_runtime_dir/results}"
"$probe_runtime_dir/node_modules/.bin/tsx" "$probe_runtime_dir/probe.mjs"
printf 'Runtime and outputs: %s\n' "$probe_runtime_dir"
