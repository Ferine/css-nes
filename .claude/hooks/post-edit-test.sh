#!/bin/bash
# Runs vitest after edits to src/ files, feeding results back as context.
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only run for source files — skip tests, config, etc.
if [[ "$FILE_PATH" != */src/*.js ]]; then
  exit 0
fi

RESULT=$(cd "$CLAUDE_PROJECT_DIR" && npx vitest run --reporter=dot 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  SUMMARY=$(echo "$RESULT" | tail -4)
  echo "Auto-test after editing $(basename "$FILE_PATH"): PASSED"
  echo "$SUMMARY"
else
  # Show failures concisely
  echo "Auto-test after editing $(basename "$FILE_PATH"): FAILED"
  echo "$RESULT" | grep -E '(FAIL|×|Error|expected|received)' | head -15
fi

exit 0
