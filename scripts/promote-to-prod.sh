#!/bin/bash

# Ensure we are on the staging branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "staging" ]; then
  echo "Error: You must be on the 'staging' branch to promote to production."
  exit 1
fi

# Pull latest staging
echo "Pulling latest staging..."
git pull origin staging

# Switch to main
echo "Switching to main..."
git checkout main
git pull origin main

# Merge staging into main
echo "Merging staging into main..."
git merge staging

# Push main to production
echo "Pushing to production..."
git push origin main

# Switch back to staging
echo "Switching back to staging..."
git checkout staging

echo "✅ Promotion to production complete!"
