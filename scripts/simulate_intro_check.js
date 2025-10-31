import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 경로 설정
const workspaceRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const guildId = args[0] || 'test_guild';
const joinQueuePath = path.join(workspaceRoot, 'data', guildId, 'joinQueue.json');

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeSampleJoinQueue() {
  ensureDir(joinQueuePath);
  const now = Date.now();
  const sample = {
    // 25시간 전 입장 -> 강퇴 대상
    "111111111111111111": { joinTime: new Date(now - 25 * 60 * 60 * 1000).toISOString(), introDone: false },
    // 23시간 전 입장 -> 경고 대상이 아님 (1시간 이상 남음)
    "222222222222222222": { joinTime: new Date(now - 23 * 60 * 60 * 1000).toISOString(), introDone: false },
    // 23.5시간 전 입장 -> 30분 남음 -> DM 경고 대상
    "333333333333333333": { joinTime: new Date(now - 23.5 * 60 * 60 * 1000).toISOString(), introDone: false },
    // 8일 전 입장, introDone true -> 큐에서 제거 대상
    "444444444444444444": { joinTime: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(), introDone: true }
  };
  fs.writeFileSync(joinQueuePath, JSON.stringify(sample, null, 2), 'utf8');
  return sample;
}

function loadJoinQueue() {
  if (!fs.existsSync(joinQueuePath)) return null;
  try {
    const raw = fs.readFileSync(joinQueuePath, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return null;
  }
}

function simulate() {
  let joinQueue = loadJoinQueue();
  if (!joinQueue || Object.keys(joinQueue).length === 0) {
    console.log('joinQueue 파일이 없거나 비어있어 샘플 데이터를 생성합니다:', joinQueuePath);
    joinQueue = writeSampleJoinQueue();
  }

  const now = Date.now();
  console.log('\n==== 자기소개 감시 시뮬레이션 ====');
  console.log('Guild ID:', guildId);
  console.log('현재 시각:', new Date(now).toISOString());

  for (const [uid, info] of Object.entries(joinQueue)) {
    const joinTime = new Date(info.joinTime).getTime();
    const introDone = !!info.introDone;
    const elapsed = now - joinTime; // ms
    const hours = elapsed / (1000 * 60 * 60);
    const timeLeftMs = 24 * 60 * 60 * 1000 - elapsed;
    const timeLeftMin = Math.ceil(timeLeftMs / (60 * 1000));

    process.stdout.write(`\nUser: ${uid}\n`);
    process.stdout.write(`  joinTime: ${info.joinTime}\n`);
    process.stdout.write(`  introDone: ${introDone}\n`);
    process.stdout.write(`  경과시간(시): ${hours.toFixed(2)}\n`);

    if (!introDone) {
      if (timeLeftMs <= 0) {
        process.stdout.write('  => ACTION: KICK (자기소개 미작성, 24시간 경과)\n');
      } else if (timeLeftMs <= 60 * 60 * 1000) {
        process.stdout.write(`  => ACTION: WARN (DM 전송 권장) - 남은 시간: ${timeLeftMin}분\n`);
      } else {
        process.stdout.write('  => ACTION: WAIT (아직 강퇴 대상 아님)\n');
      }
    } else {
      // introDone true이면 7일 이후 큐에서 제거
      if (now - joinTime > 7 * 24 * 60 * 60 * 1000) {
        process.stdout.write('  => ACTION: CLEANUP (자기소개 완료, 큐에서 제거)\n');
      } else {
        process.stdout.write('  => ACTION: OK (자기소개 완료)\n');
      }
    }
  }

  console.log('\n==== 시뮬레이션 종료 ====');
}

simulate();
