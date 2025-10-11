#!/bin/bash

# 1. Git에서 최신 코드 가져오기
git reset --hard
git pull origin main

# 2. 의존성 설치
npm install

# 3. PM2로 봇 재시작
pm2 restart GilNyangBot --update-env

echo "✅ 업데이트 및 재시작 완료!"

