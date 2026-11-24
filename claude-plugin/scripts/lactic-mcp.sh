#!/bin/sh
# Starts Lactic's MCP server for Claude. Lactic has the server built in: `lactic --mcp` passes
# Claude's requests to the Lactic app on this computer (opening it if it's closed) over 127.0.0.1,
# and nothing leaves the computer. This script only finds where Lactic is installed: the Lactic
# release first, Lactic Preview if that's the only one there.

if [ -x "/Applications/Lactic.app/Contents/MacOS/lactic" ]; then
  exec "/Applications/Lactic.app/Contents/MacOS/lactic" --mcp
fi
if [ -x "/usr/bin/lactic" ]; then
  exec "/usr/bin/lactic" --mcp
fi
if [ -x "/Applications/Lactic Preview.app/Contents/MacOS/lactic" ]; then
  exec "/Applications/Lactic Preview.app/Contents/MacOS/lactic" --mcp
fi

echo "Lactic isn't installed. Download it free from https://lactic.fit, open it once, then restart Claude." >&2
exit 1
