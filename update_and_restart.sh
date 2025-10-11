#!/bin/bash

# 1. Git pull
echo "Pulling latest code from Git..."
git fetch origin
git reset --hard origin/main

# 2. 현재 버전 읽기
current_version=$(jq -r '.version' package.json)
IFS='.' read -r major minor patch <<< "$current_version"

# 3. minor 버전 증가
minor=$((minor + 1))
new_version="$major.$minor.$patch"

# 4. package.json 업데이트
jq --arg ver "$new_version" '.version = $ver' package.json > package.tmp.json && mv package.tmp.json package.json
echo "Version updated: $current_version → $new_version"

# 5. npm 설치
echo "Installing/updating npm packages..."
npm install

# 6. PM2 재시작
echo "Restarting GilNyangBot..."
pm2 restart GilNyangBot --update-env

echo "Update and restart complete! Current version: $new_version"
