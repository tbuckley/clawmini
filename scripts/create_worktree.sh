#!/bin/bash

# Check if an argument is provided
if [ -z "$1" ]; then
  echo "Usage: $0 <branch-name>"
  exit 1
fi

BRANCH_NAME=$1
# Resolve the target directory relative to the current directory's parent
TARGET_DIR="../$BRANCH_NAME"

echo "Creating git worktree '$BRANCH_NAME' at '$TARGET_DIR'..."
# Create the worktree and the new branch
git worktree add -b "$BRANCH_NAME" "$TARGET_DIR"

if [ $? -ne 0 ]; then
  echo "Error: Failed to create worktree. Please check git status and arguments."
  exit 1
fi

echo "Copying .gemini sandbox files..."
if [ -d ".gemini" ]; then
  mkdir -p "$TARGET_DIR/.gemini"
  if ls .gemini/*.sb 1> /dev/null 2>&1; then
    cp .gemini/*.sb "$TARGET_DIR/.gemini/"
  else
    echo "No .sb files found in .gemini/"
  fi
else
  echo "Warning: .gemini directory not found. Skipping sandbox files copy."
fi

echo "Running npm install in '$TARGET_DIR'..."
# Navigate to the new directory and install dependencies
cd "$TARGET_DIR" || exit 1
npm install

if [ $? -eq 0 ]; then
    echo "--------------------------------------------------"
    echo "Worktree setup complete for '$BRANCH_NAME'."
    echo "Location: $TARGET_DIR"
    echo "NOTE: To change your current shell to this directory, run:"
    echo "source ./scripts/create_worktree.sh $BRANCH_NAME"
    echo "--------------------------------------------------"
else
    echo "Error: npm install failed."
    exit 1
fi
