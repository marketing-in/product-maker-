#!/bin/sh
# Commit every stored generation and project, then push. Run with: npm run push
set -eu
cd "$(dirname "$0")/.."
# A last look for secrets before anything leaves this computer.
if grep -rqE 'sk-ant-[A-Za-z0-9_-]{10}|wrkspc_[A-Za-z0-9]{8}' data 2>/dev/null; then
  echo "Stopped: something in data/ looks like an API key or workspace ID. Remove it, then try again." >&2
  exit 1
fi
git add data
if git diff --cached --quiet -- data; then
  echo "No new generations or projects to save."
else
  n=$(git diff --cached --name-only -- data/generations | wc -l | tr -d ' ')
  p=$(git diff --cached --name-only -- data/projects | wc -l | tr -d ' ')
  git commit -q -m "Save stored generations ($n) and projects ($p)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- data
  echo "Saved $n generation and $p project files."
fi
git push origin "$(git rev-parse --abbrev-ref HEAD)"
