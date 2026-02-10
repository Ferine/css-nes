#!/bin/bash
# macOS notification when Claude needs user attention.
osascript -e 'display notification "Needs your input" with title "Claude Code" sound name "Ping"' 2>/dev/null
exit 0
