#!/usr/bin/env bash
set -e
cp -R "$(dirname "$0")/fixture/." "$1"/
cd "$1" && git init -q && git add -A && git -c user.email=eval@glmh -c user.name=eval commit -qm init
