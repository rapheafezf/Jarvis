#!/usr/bin/env sh
# Lance Jarvis puis ouvre le navigateur. Clé API optionnelle dans cle-api.txt.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js est introuvable : installez-le depuis https://nodejs.org"; exit 1; }
if [ -f cle-api.txt ]; then
  CLE=$(tr -d ' \r\n' < cle-api.txt)
  case "$CLE" in
    sk-ant-*) [ -z "$ANTHROPIC_API_KEY" ] && export ANTHROPIC_API_KEY="$CLE" ;;
    *) [ -z "$GEMINI_API_KEY" ] && export GEMINI_API_KEY="$CLE" ;;
  esac
fi
exec node server.js --ouvrir
