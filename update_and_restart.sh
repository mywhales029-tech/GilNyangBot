#!/bin/bash

# 1. Git에서 최신 코드 가져오기
echo "Pulling latest code from Git..."
git fetch origin main
git reset --hard origin/main

# 2. package.json 현재 버전 읽기
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | sed 's/[^0-9.]//g')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# 3. 버전 증가 (minor 기준, patch 올리려면 PATCH=$((PATCH+1))로 변경)
MINOR=$((MINOR + 1))
NEW_VERSION="$MAJOR.$MINOR.$PATCH"

# 4. package.json에 새로운 버전 적용
echo "Updating package.json version..."
sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
echo "Version updated: $CURRENT_VERSION → $NEW_VERSION"

# 5. npm 패키지 설치/업데이트
echo "Installing/updating npm packages..."
npm install

# 6. PM2로 봇 재시작
echo "Restarting GilNyangBot..."
pm2 restart GilNyangBot --update-env

echo "Update and restart complete! Current version: $NEW_VERSION"
