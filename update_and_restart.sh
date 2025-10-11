#!/bin/bash

# 1. Git 최신 코드 가져오기
git reset --hard
git pull origin main

# 2. package.json 버전 자동 증가 (minor)
current_version=$(grep -oP '"version":\s*"\K[0-9]+\.[0-9]+\.[0-9]+' package.json)
IFS='.' read -r major minor patch <<< "$current_version"
minor=$((minor + 1))
new_version="$major.$minor.$patch"
# 버전 업데이트
sed -i "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" package.json
echo "Version updated: $current_version → $new_version"

# 3. npm 패키지 설치/업데이트
npm install

# 4. PM2로 봇 재시작
pm2 restart GilNyangBot --update-env
