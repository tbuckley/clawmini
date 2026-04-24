#!/usr/bin/env bash

# validate.sh - Validates a skill directory for a SKILL.md with valid frontmatter

if [ -z "$1" ]; then
  echo "Usage: ./validate.sh <path_to_skill_directory>"
  exit 1
fi

SKILL_DIR="$1"
SKILL_FILE="$SKILL_DIR/SKILL.md"

if [ ! -d "$SKILL_DIR" ]; then
  echo "Error: Directory $SKILL_DIR does not exist."
  exit 1
fi

if [ ! -f "$SKILL_FILE" ]; then
  echo "Error: $SKILL_FILE does not exist. A skill must have a SKILL.md file."
  exit 1
fi

# Check for YAML frontmatter
if ! head -n 1 "$SKILL_FILE" | grep -q "^---$"; then
  echo "Error: $SKILL_FILE must begin with YAML frontmatter (---)."
  exit 1
fi

# Extract frontmatter block
FRONTMATTER=$(awk '/^---$/{p++} p==1{print} p==2{print; exit}' "$SKILL_FILE")

# Check for name and description
if ! echo "$FRONTMATTER" | grep -q "^name: "; then
  echo "Error: Frontmatter is missing required 'name' field."
  exit 1
fi

if ! echo "$FRONTMATTER" | grep -q "^description: "; then
  echo "Error: Frontmatter is missing required 'description' field."
  exit 1
fi

DIR_NAME=$(basename "$SKILL_DIR")
NAME_FIELD=$(echo "$FRONTMATTER" | grep "^name: " | sed 's/^name: *//' | tr -d '"' | tr -d "'")

if [ "$DIR_NAME" != "$NAME_FIELD" ]; then
  echo "Error: Directory name ('$DIR_NAME') must match the 'name' field in frontmatter ('$NAME_FIELD')."
  exit 1
fi

echo "Success: Skill directory '$SKILL_DIR' is valid!"
exit 0
