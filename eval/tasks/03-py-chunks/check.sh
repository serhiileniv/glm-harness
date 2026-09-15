#!/usr/bin/env bash
cd "$1" && python3 -m unittest -q 2>&1 | tail -15; exit "${PIPESTATUS[0]}"
