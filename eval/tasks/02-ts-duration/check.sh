#!/usr/bin/env bash
cd "$1" && bun test 2>&1 | tail -15; exit "${PIPESTATUS[0]}"
