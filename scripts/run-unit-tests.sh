#!/usr/bin/env bash
#
# Discovery-based unit test runner. Globs tests/unit/*.test.ts (or runs the
# subset of paths passed as arguments) and runs each one under `npx tsx`.
# No allowlist/skip list: every discovered file runs, and a failing file
# fails loudly with its full captured output printed inline.

set -uo pipefail
shopt -s nullglob

if [ "$#" -gt 0 ]; then
    files=("$@")
else
    files=(tests/unit/*.test.ts)
fi

if [ "${#files[@]}" -eq 0 ]; then
    echo "error: no test files found (glob 'tests/unit/*.test.ts' matched nothing, or the given path does not exist)" >&2
    echo "passed=0 failed=0 of 0"
    exit 1
fi

passed=0
failed=0

for file in "${files[@]}"; do
    output_file="$(mktemp)"
    npx tsx "$file" >"$output_file" 2>&1
    status=$?

    if [ "$status" -eq 0 ]; then
        printf 'PASS %s\n' "$file"
        passed=$((passed + 1))
    else
        printf 'FAIL %s\n' "$file"
        failed=$((failed + 1))
        echo "----- output: $file -----"
        cat "$output_file"
        echo "----- end output: $file -----"
    fi

    rm -f "$output_file"
done

total=${#files[@]}
echo "passed=$passed failed=$failed of $total"

if [ "$failed" -eq 0 ]; then
    exit 0
else
    exit 1
fi
