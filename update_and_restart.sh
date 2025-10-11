#!/bin/bash
# =============================================
# update_and_restart.sh
# Git pull 후 버전 minor 자동 증가 + npm install + PM2 재시작
# =============================================

# 1. Git 최신 코드 가져오기
echo "Pulling latest code from Git..."
git reset --hard
git pull origin main

# 2. package.json 버전 자동 증가 (minor)
echo "Updating package.json version..."
current_version=$(grep -oP '"version":\s*"\K[0-9]+\.[0-9]+\.[0-9]+' package.json)
IFS='.' read -r major minor patch <<< "$current_version"
minor=$((minor + 1))
new_version="$major.$minor.$patch"
sed -i "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" package.json
echo "Version updated: $current_version → $new_version"

# 3. npm 패키지 설치/업데이트
echo "Installing/updating npm packages..."
npm install

# 4. PM2로 봇 재시작
echo "Restarting GilNyangBot..."
pm2 restart GilNyangBot --update-env

echo "Update and restart complete! Current version: $new_version"
