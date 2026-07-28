#!/bin/sh
set -eu

root="$(git rev-parse --show-toplevel)"
cp "$root/pre-commit-hook.sh" "$root/.git/hooks/pre-commit"
chmod +x "$root/.git/hooks/pre-commit"
printf '%s\n' "Daewon website pre-commit guard installed."
