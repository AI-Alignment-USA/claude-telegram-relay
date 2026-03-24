#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: post-social.sh <x|linkedin> <post text>"
  exit 1
fi

platform="$1"
shift
text="$*"

echo "$text" > /tmp/pending-post.txt

case "$platform" in
  x)
    start "https://x.com/compose/post"
    ;;
  linkedin)
    start "https://www.linkedin.com/feed/"
    ;;
  *)
    echo "Unknown platform: $platform (use 'x' or 'linkedin')"
    exit 1
    ;;
esac

echo "Chrome opened, paste your text and click Post."
