#!/bin/sh
# lint-env.sh — fail fast on a malformed build-secret env file BEFORE it gets
# `set -a && . file && set +a`'d into a shell during the Docker build. A
# hand-edited value with an unquoted shell-active char (space, $, <, ;, ...)
# either breaks the build with a cryptic parse error deep inside `npm run
# build`, or worse, gets silently executed. This never prints a value.
#
# Usage:   lint-env.sh <file>      # exit 0 clean, exit 1 + reasons on stderr
#          lint-env.sh --self-test # run built-in fixtures, no args needed
set -eu

META='space/tab/<>()`$;&|# or a stray quote'

lint_file() {
  file="$1"
  bad=0
  n=0
  tab="$(printf '\t')"
  cr="$(printf '\r')"
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    case "$line" in
      '' | '#'*) continue ;;
      *=*) ;;
      *) echo "line $n: (none): not a KEY=value line"; bad=1; continue ;;
    esac
    key="${line%%=*}" val="${line#*=}"
    case "$line" in
      *"$cr"*) echo "line $n: $key: CRLF line ending -- file must be LF-only"; bad=1; continue ;;
    esac
    case "$key" in
      [A-Za-z_]*) rest="${key#?}" ;;
      *) rest='x!' ;;
    esac
    case "$rest" in
      *[!A-Za-z0-9_]*) echo "line $n: $key: key must match ^[A-Za-z_][A-Za-z0-9_]*\$"; bad=1; continue ;;
    esac
    case "$val" in
      \'*\' )
        [ "$(printf '%s' "$val" | grep -o "'" | wc -l)" -eq 2 ] && continue
        echo "line $n: $key: unbalanced single quote"; bad=1 ;;
      \"*\" )
        if [ "$(printf '%s' "$val" | grep -o '"' | wc -l)" -ne 2 ]; then
          echo "line $n: $key: unbalanced double quote"; bad=1
        else
          case "$val" in
            *'$'* | *'`'*)
              echo "line $n: $key: \$ or backtick inside double quotes still expands when sourced -- use single quotes"
              bad=1 ;;
          esac
        fi ;;
      *\'* | *\"*)
        echo "line $n: $key: stray/unbalanced quote in unquoted value"; bad=1 ;;
      *" "* | *"$tab"* | *'<'* | *'>'* | *'('* | *')'* | *'`'* | *'$'* | *';'* | *'&'* | *'|'* | *'#'*)
        echo "line $n: $key: unquoted value contains a shell-active character ($META)"; bad=1 ;;
    esac
  done < "$file"
  return $bad
}

self_test() {
  d="$(mktemp -d)"; trap 'rm -rf "$d"' EXIT
  pass=0 fail=0
  check() {
    name="$1" file="$2" want="$3"
    if lint_file "$file" >"$d/out" 2>&1; then got=0; else got=1; fi
    if [ "$got" = "$want" ]; then pass=$((pass + 1)); echo "PASS  $name (exit $got)"
    else fail=$((fail + 1)); echo "FAIL  $name (want $want got $got)"; sed 's/^/      /' "$d/out"; fi
  }
  printf 'FOO=bar\nBAZ_1="hello world"\nQUX=\047a;b\047\n# comment\n\nEMPTY=\n' > "$d/valid"
  check "valid file" "$d/valid" 0
  printf 'BROKEN=a<b\n' > "$d/lt"
  check "unquoted < (todays bug)" "$d/lt" 1
  printf 'BROKEN=has space\n' > "$d/space"
  check "unquoted space (exec hazard)" "$d/space" 1
  printf 'SAFE=%s\n' "'a;b(c)\$d'" > "$d/sq"
  check "fully single-quoted shell chars" "$d/sq" 0
  printf 'SAFE="a b c"\n' > "$d/dq"
  check "double-quoted value" "$d/dq" 0
  printf '123BAD=x\n' > "$d/badkey"
  check "malformed key" "$d/badkey" 1
  printf 'ODD='"'"'a\n' > "$d/oddquote"
  check "unbalanced quote" "$d/oddquote" 1
  printf 'BAD=%s\n' '"$(whoami)"' > "$d/dqsub"
  check "double-quoted command substitution" "$d/dqsub" 1
  printf 'FOO=bar\r\n' > "$d/crlf"
  check "CRLF line ending" "$d/crlf" 1
  echo "-- $pass passed, $fail failed --"
  [ "$fail" -eq 0 ]
}

case "${1:-}" in
  --self-test) self_test ;;
  "") echo "usage: lint-env.sh <file> | --self-test" >&2; exit 2 ;;
  *)
    [ -f "$1" ] || { echo "lint-env.sh: no such file: $1" >&2; exit 2; }
    lint_file "$1"
    ;;
esac
