#!/usr/bin/env bash
# Installs Lactic Preview on a Mac: a testing build that sits beside Lactic as its own app, with its
# own data, saved keys and updates, so trying a change never touches your real rides or plan.
#
#   try-preview.sh              the latest build of main (the rolling `preview` release)
#   try-preview.sh 72           pull request #72's latest build, before it's merged
#   try-preview.sh my-branch    a branch's latest build
#   try-preview.sh --modular    Lactic Modular instead (purple icon, its own data again): the latest
#                               modular-ui build, or add a pull request number or branch after it
#
# Pull request and branch builds come from the App workflow's run, so they need the GitHub CLI
# (brew install gh && gh auth login). The latest main needs nothing but curl.
#
# Without cloning the repo:
#   curl -fsSL https://raw.githubusercontent.com/blairj09/lactic/main/app/scripts/try-preview.sh | bash -s -- 72
set -euo pipefail

REPO=blairj09/lactic
NAME="Lactic Preview"
TAG=preview
ARTIFACT=Lactic-macOS-Preview
if [ "${1:-}" = --modular ]; then
  shift
  NAME="Lactic Modular"
  TAG=modular
  ARTIFACT=Lactic-macOS-Modular
fi
APP="/Applications/$NAME.app"
target=${1:-}

[ "$(uname)" = Darwin ] || { echo "This installs the Mac app. On Windows and Linux, download a build from https://github.com/$REPO/releases/tag/$TAG"; exit 1; }

work=$(mktemp -d)
mnt="$work/mnt"
cleanup() { hdiutil detach -quiet "$mnt" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

if [ -z "$target" ]; then
  echo "Fetching the latest $NAME…"
  url=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/tags/$TAG" | grep -o '"browser_download_url": *"[^"]*\.dmg"' | head -1 | sed -E 's/.*"(https[^"]+)"$/\1/')
  [ -n "$url" ] || { echo "No $NAME build yet: https://github.com/$REPO/releases/tag/$TAG"; exit 1; }
  curl -fL# -o "$work/preview.dmg" "$url"
else
  command -v gh >/dev/null || { echo "Pull request and branch builds need the GitHub CLI: brew install gh && gh auth login"; exit 1; }
  if [[ $target =~ ^#?[0-9]+$ ]]; then
    pr=${target#\#}
    branch=$(gh pr view "$pr" -R "$REPO" --json headRefName -q .headRefName)
    echo "Pull request #$pr is on $branch."
  else
    branch=$target
  fi
  running=$(gh run list -R "$REPO" --workflow App --branch "$branch" --status in_progress --limit 1 --json databaseId -q '.[0].databaseId // empty')
  [ -z "$running" ] || echo "A newer build of $branch is still running (gh run watch $running -R $REPO); using the last finished one."
  run=""
  for id in $(gh run list -R "$REPO" --workflow App --branch "$branch" --status completed --limit 10 --json databaseId -q '.[].databaseId'); do
    if gh api "repos/$REPO/actions/runs/$id/artifacts" -q '.artifacts[].name' | grep -qx "$ARTIFACT"; then run=$id; break; fi
  done
  [ -n "$run" ] || { echo "No finished Mac build of $branch yet. Check https://github.com/$REPO/actions?query=branch%3A$branch"; exit 1; }
  echo "Downloading the Mac build from run $run…"
  gh run download "$run" -R "$REPO" -n "$ARTIFACT" -D "$work/artifact"
  dmg=$(find "$work/artifact" -name '*.dmg' | head -1)
  mv "$dmg" "$work/preview.dmg"
fi

# Quit a running copy first, so the copy isn't swapped out under it.
osascript -e "quit app \"$NAME\"" 2>/dev/null || true
sleep 1

mkdir -p "$mnt"
hdiutil attach -nobrowse -quiet -mountpoint "$mnt" "$work/preview.dmg"
src=$(find "$mnt" -maxdepth 1 -name '*.app' | head -1)
[ -n "$src" ] || { echo "No app in the download."; exit 1; }
rm -rf "$APP"
cp -R "$src" "$APP"
# Unsigned (ad hoc) builds need their quarantine flag cleared to open.
xattr -cr "$APP"
echo "Installed $APP ($(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "?"))."
open "$APP"
