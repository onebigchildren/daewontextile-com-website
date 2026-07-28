#!/bin/sh
set -eu

"$HOME/bin/no-em-dash-guard" scan-staged
node "$(git rev-parse --show-toplevel)/verify-site.mjs" --staged
