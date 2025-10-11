import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === 환경 변수 ===
const TOKEN = process.env.BOT_TOKEN;
const INTRO_CHANNEL_ID = process.env.INTRO_CHANNEL_ID;      // 자기소개 채널 ID (메시지 작성 감시)
const DEV_LOG_CHANNEL_ID = process.env.DEV_LOG_CHANNEL_ID; // 오류/개발 로그 채널
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID; // 환영 메시지 보낼 채널
const NOTICE_CHANNEL_ID = process.env.NOTICE_CHANNEL_ID;   // 공지 보낼 채널 (옵션)

// === 개발자 포인트 조정 ===
const DEV_IDS = ["937280891967918120"]; // 개발자 ID 배열 (예시)

// === 데이터 디렉토리 ===
const baseDataDir = path.join(__dirname, "data");
if (!fs.existsSync(baseDataDir)) fs.mkdirSync(baseDataDir, { recursive: true });

// 기본 템플릿 (defaultRole은 객체로 관리)
const defaultDataTemplates = {
  points: {},
  attendance: {},
  items: {},
  market: [],
  logs: {},
  joinQueue: {},
  defaultRole: { id: null }
};

function ensureServerData(guildId) {
  const guildDir = path.join(baseDataDir, guildId);
  if (!fs.existsSync(guildDir)) fs.mkdirSync(guildDir, { recursive: true });
  for (const [key, defaultContent] of Object.entries(defaultDataTemplates)) {
    const filePath = path.join(guildDir, `${key}.json`);
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2));
    else {
      // 빈 파일 보호
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (!content) fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2));
    }
  }
}
function loadData(guildId, key) { ensureServerData(guildId); return JSON.parse(fs.readFileSync(path.join(baseDataDir, guildId, `${key}.json`), "utf8")); }
function saveData(guildId, key, data) { ensureServerData(guildId); fs.writeFileSync(path.join(baseDataDir, guildId, `${key}.json`), JSON.stringify(data, null, 2)); }



// === 봇 자산 ===
const BOT_ASSET_KEY = "botAsset";
const DEFAULT_BOT_ASSET = 3983896076;
function getBotAsset(guildId) {
  const pointsData = loadData(guildId, "points");
  if (!pointsData[BOT_ASSET_KEY]) pointsData[BOT_ASSET_KEY] = DEFAULT_BOT_ASSET;
  saveData(guildId, "points", pointsData);
  return pointsData[BOT_ASSET_KEY];
}
function setBotAsset(guildId, amount) {
  const pointsData = loadData(guildId, "points");
  pointsData[BOT_ASSET_KEY] = amount;
  saveData(guildId, "points", pointsData);
}


// === 아이템 등급 및 확률 ===
const ITEM_GRADES = [
  "하급",        // 가장 낮은 등급
  "일반",        // 기본
  "고급",        // 조금 희귀
  "희귀",        // 보기 드문 등급
  "영웅",        // 강력한 희귀템
  "전설",        // 최고 등급
  "신화"         // 신적인 등급
];
function getUpgradeSuccessRate(currentPlus) {
  if (currentPlus < 5) return 0.98;   // 초반: 거의 100% 성공
  if (currentPlus < 10) return 0.9;
  if (currentPlus < 15) return 0.8;
  if (currentPlus < 20) return 0.65;
  if (currentPlus < 25) return 0.5;
  if (currentPlus < 30) return 0.35;
  if (currentPlus < 40) return 0.25;
  if (currentPlus < 50) return 0.15;
  if (currentPlus < 60) return 0.08;
  if (currentPlus < 70) return 0.04;
  if (currentPlus < 80) return 0.02;
  return 0.01; // +80 이상: 극악
}

function getDestroyChance(currentPlus) {
  if (currentPlus < 40) return 0;          // 안전구간
  if (currentPlus < 50) return 0.01;       // 미세 확률
  if (currentPlus < 60) return 0.03;       // 조금 위험
  if (currentPlus < 70) return 0.07;       // 위험 구간
  if (currentPlus < 80) return 0.13;       // 고위험
  if (currentPlus < 90) return 0.18;       // 극한
  return 0.25;                             // +90 이상: 거의 도박 수준
}

function getRandomGrade() {
  return ITEM_GRADES[Math.floor(Math.random() * ITEM_GRADES.length)];
}

// === 클라이언트 ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// === 반말 모드 ===
let banmalMode = false, lastBanmal = null, lastJondaet = null;
const banmalReplies = ["응","그래","응 그래","어 안녕","안녕","왜불러","ㅇㅇ","ㅇ","ㅎㅇ"];
const jondaetReplies = ["안녕하세요","반가워요","안녕하십니까?"];
function getRandomReply(list, lastUsed){
  let choice;
  do { choice = list[Math.floor(Math.random()*list.length)]; } while(choice===lastUsed && list.length>1);
  return choice;
}

// === 오류 로그 전송 ===
async function devLogError(guild, user, error, code="343"){
  const ch = await client.channels.fetch(DEV_LOG_CHANNEL_ID).catch(()=>null);
  if(!ch||!ch.isTextBased()) return;
  const embed = new EmbedBuilder()
    .setTitle("🚨 BOT 오류 발생")
    .setColor(0xff0000)
    .addFields(
      {name:"📌 Error Code", value:`Error Code : ${code}`},
      {name:"👤 사용자", value:user?`${user.tag} (${user.id})`:"알 수 없음"},
      {name:"🏰 서버", value:guild?`${guild.name} (${guild.id})`:"알 수 없음"},
      {name:"⚡ 오류 메시지", value:error?.message||String(error)}
    )
    .setTimestamp();
  ch.send({embeds:[embed]}).catch(()=>{});
}

// === 자기소개 검증 ===
function validateIntro(content){
  const lines = content.split("\n").map(l=>l.trim());
  let fields={nick:null, age:null, gender:null, region:null};
  for(const line of lines){
    if(line.startsWith("디코닉:")) fields.nick=line.slice(4).trim();
    if(line.startsWith("나이:")) fields.age=line.slice(3).trim();
    if(line.startsWith("성별:")) fields.gender=line.slice(3).trim();
    if(line.startsWith("지역:")) fields.region=line.slice(3).trim();
  }
  if(!fields.nick||!fields.age||!fields.gender||!fields.region) return false;
  const ageRegex=/^(\d{2}년생|\d{2}살|\d{2})$/;
  if(!ageRegex.test(fields.age)) return false;
  return true;
}

const statuses = [
  { name: "강화 중...", type: 0 },
  { name: "아이템 제작 중...", type: 0 },
  { name: "포인트 계산 중...", type: 3 },
  { name: "냥이들의 모험을 관찰 중", type: 3 }
];

// === 봇 준비 ===
client.once("clientReady", () => {
  console.log(`${client.user.tag} 로그인 완료!`);
  let i = 0;
  setInterval(() => {
    const next = statuses[i % statuses.length];
    client.user.setPresence({ activities: [next], status: "online" });
    i++;
  }, 60000); // 1분마다 상태 변경
});

// === 메시지 이벤트 ===
client.on("messageCreate", async (message)=>{
  try{
    // 봇 메시지 무시
    if (message.author.bot) return;

    const { content, author, guild, channel } = message;
    if(!guild) return; // DM 무시

    const guildId = guild.id;
    ensureServerData(guildId);

    // -----------------------
    // 자기소개 채널 감시 (INTRO_CHANNEL_ID)
    // -----------------------
    if (INTRO_CHANNEL_ID && channel.id === INTRO_CHANNEL_ID) {
      const joinQueue = loadData(guildId,"joinQueue");
      const defaultRoleData = loadData(guildId,"defaultRole");
      if(!joinQueue[author.id]) {
        // 가입 기록이 없으면 무시
      } else {
        // 자기소개 처리
        if(validateIntro(content)){
          joinQueue[author.id].introDone=true;
          saveData(guildId,"joinQueue",joinQueue);
          // 기본 역할 부여
          if(defaultRoleData && defaultRoleData.id){
            const role = message.guild.roles.cache.get(defaultRoleData.id);
            if(role){
              const member = await message.guild.members.fetch(author.id).catch(()=>null);
              if(member) member.roles.add(role).catch(()=>{});
            }
          }
          await message.reply("✅ 자기소개 확인 완료. 기본 역할 지급");
        } else {
          await message.reply("⚠️ 양식 미준수. 기본 역할 미지급");
        }
      }
      return; // INTRO 채널 메시지는 명령어 파싱하지 않음
    }

    // 명령어가 아니면 로그만 남김 (명령어 처리 전)
    if(!content.startsWith("!")){
      // 기록용 로그 저장
      const logs = loadData(guildId,"logs");
      logs[author.id] = logs[author.id] || [];
      logs[author.id].push({ time: new Date().toISOString(), message: content });
      saveData(guildId,"logs",logs);
      return;
    }

    // -----------------------
    // 공통 데이터 로드
    // -----------------------
    const args = content.slice(1).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    const pointsData = loadData(guildId,"points");
    const attendance = loadData(guildId,"attendance");
    const itemsData = loadData(guildId,"items");
    const marketData = loadData(guildId,"market");
    const logs = loadData(guildId,"logs");
    const joinQueue = loadData(guildId,"joinQueue");
    const defaultRoleData = loadData(guildId,"defaultRole");

    // 채팅 로그 기록 (명령어 포함)
    logs[author.id] = logs[author.id] || [];
    logs[author.id].push({ time: new Date().toISOString(), message: content });
    saveData(guildId,"logs",logs);

    // -----------------------
    // 명령어 처리
    // -----------------------
    // === 냥이설명서 ===
    if (cmd === "냥이설명서") {
      const pages = [
        new EmbedBuilder()
          .setTitle("🐾 길냥이봇 사용 설명서 — 1️⃣ 일반 명령어")
          .setColor(0xFFD700)
          .setDescription("냥냥~ 여긴 길냥이봇 명령어 모음집이야!\n\n`!` 접두어로 명령어를 입력해줘 💛")
          .addFields(
            { name: "💬 일반 명령어", value: [
              "`!안녕` — 반말/존댓말에 따라 인사",
              "`!반모` — 반말 모드 전환",
              "`!반종` — 존댓말 모드 복귀",
              "`!시간` — 현재 한국 시간 표시",
              "`!봇정보` — 봇 정보 확인"
            ].join("\n") }
          )
          .setFooter({ text: "페이지 1 / 6" }),

        new EmbedBuilder()
          .setTitle("📜 출석 / 포인트 시스템 — 2️⃣")
          .setColor(0xA3E4D7)
          .addFields(
            { name: "🧾 포인트 명령어", value: [
              "`!출석` — 하루 1회 출석 포인트 획득 (2000pt)",
              "`!포인트` — 현재 포인트 확인",
              "`!포인트랭킹` — 상위 10위 표시"
            ].join("\n") },
            { name: "👨‍💻 개발자 전용", value: "`!devpoint <지급/복원> <유저ID>` — 개발자 전용 포인트 관리" }
          )
          .setFooter({ text: "페이지 2 / 6" }),

        new EmbedBuilder()
          .setTitle("⚒️ 아이템 시스템 — 3️⃣")
          .setColor(0xF7DC6F)
          .addFields(
            { name: "제작 & 관리", value: [
              "`!아이템 제작 <이름>` — 포인트로 아이템 제작",
              "`!아이템 강화 <이름>` — 강화 시도 (성공/파괴 확률 있음)",
              "`!아이템 등급 <이름>` — 등급과 강화 수치 확인",
              "`!아이템 목록` — 보유 중인 아이템 표시"
            ].join("\n") },
            { name: "시장 관련", value: [
              "`!아이템 판매 <이름> <가격>` — 아이템 시장에 등록",
              "`!아이템 구입 <이름>` — 시장에서 아이템 구매",
              "`!아이템 시장` — 시장 등록 목록 확인"
            ].join("\n") }
          )
          .setFooter({ text: "페이지 3 / 6" }),

        new EmbedBuilder()
          .setTitle("💰 경제 시스템 — 4️⃣")
          .setColor(0x85C1E9)
          .addFields(
            { name: "봇 자산", value: "`!봇자산` — 길냥이봇의 총 보유 포인트 확인" },
            { name: "시장 통계", value: "판매 및 거래 내역은 자동으로 로그에 기록됩니다." }
          )
          .setFooter({ text: "페이지 4 / 6" }),

        new EmbedBuilder()
          .setTitle("🧹 관리자 / 운영 명령어 — 5️⃣")
          .setColor(0xE67E22)
          .addFields(
            { name: "📢 관리 기능", value: [
              "`!공지 <내용>` — 공지 채널에 공지 전송",
              "`!채널생성 <카테고리> <채널>` — 텍스트 채널 생성",
              "`!기본역할 <@역할>` — 자기소개 완료 시 자동 부여 역할 설정"
            ].join("\n") },
            { name: "💥 메시지 제어", value: [
              "`!시공의폭풍` — 채널 내 모든 메시지 삭제 (확인 필요)",
              "`!맨인블랙 <숫자>` — 최근 N개 메시지 삭제 (최대 100)"
            ].join("\n") }
          )
          .setFooter({ text: "페이지 5 / 6" }),

        new EmbedBuilder()
          .setTitle("⚙️ 자동 시스템 — 6️⃣")
          .setColor(0xBB8FCE)
          .addFields(
            { name: "🧩 자동 기능", value: [
              "🪪 자기소개 감시 — 자기소개 미작성 시 24시간 후 자동 강퇴",
              "🪄 상태 회전 — 1분마다 봇 상태 자동 변경",
              "💾 자동 저장 — 유저/아이템/로그 데이터 자동 저장",
              "🧰 오류 로깅 — 오류 발생 시 개발자 채널로 보고",
              "🎯 기본 역할 부여 — 자기소개 완료 시 지정 역할 자동 지급"
            ].join("\n") }
          )
          .setFooter({ text: "페이지 6 / 6" })
      ];

      let page = 0;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("prev").setLabel("◀️ 이전").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("next").setLabel("다음 ▶️").setStyle(ButtonStyle.Primary)
      );

      const msg = await message.reply({ embeds: [pages[page]], components: [row] });

      const collector = msg.createMessageComponentCollector({ time: 60000 });

      collector.on("collect", async i => {
        if (i.user.id !== message.author.id) return i.reply({ content: "⛔ 본인만 조작할 수 있습니다.", ephemeral: true });

        if (i.customId === "next") page++;
        else if (i.customId === "prev") page--;

        page = Math.max(0, Math.min(pages.length - 1, page));

        const newRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("prev").setLabel("◀️ 이전").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
          new ButtonBuilder().setCustomId("next").setLabel("다음 ▶️").setStyle(ButtonStyle.Primary).setDisabled(page === pages.length - 1)
        );

        await i.update({ embeds: [pages[page]], components: [newRow] });
      });

      collector.on("end", async () => {
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("prev").setLabel("◀️ 이전").setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId("next").setLabel("다음 ▶️").setStyle(ButtonStyle.Primary).setDisabled(true)
        );
        await msg.edit({ components: [disabledRow] });
      });
    }
    switch(cmd){

      // 기본 인사/모드
      case "안녕": {
        const reply=banmalMode?getRandomReply(banmalReplies,lastBanmal):getRandomReply(jondaetReplies,lastJondaet);
        if(banmalMode) lastBanmal=reply; else lastJondaet=reply;
        return message.reply(reply);
      }
      case "반모": banmalMode=true; return message.reply("이제부터 반말로 대답할게.");
      case "반종": banmalMode=false; return message.reply("존댓말 모드로 돌아왔습니다.");
      case "시간": return message.reply(`현재 시간: ${new Date().toLocaleString("ko-KR")}`);
      case "봇정보": {
        const embedInfo=new EmbedBuilder()
          .setTitle("🤖 봇 정보")
          .setColor(0x00aaff)
          .addFields(
            {name:"이름",value:client.user.username,inline:true},
            {name:"개발일",value:"2018.11.17",inline:true},
            {name:"소속 서버 수",value:`${client.guilds.cache.size}`,inline:true},
            {name:"엔진",value:"NobleNetick",inline:true},
            {name:"언어",value:"JavaScript (Node.js)",inline:true}
          ).setTimestamp();
        return message.reply({embeds:[embedInfo]});
      }

      // === 개발자 포인트 ===
      case "devpoint":{
        if(!DEV_IDS.includes(author.id)) return message.reply("⛔ 권한이 없습니다.");
        const action = args[0]; // 지급/복원
        const targetId = args[1];
        if(!targetId) return message.reply("사용법: !devpoint <지급/복원> <유저ID>");
        if(!pointsData[targetId]) pointsData[targetId]={ username: "알 수 없음", points: 0 };
        if(action==="지급") pointsData[targetId].points+=10000;
        else if(action==="복원") pointsData[targetId].points=pointsData[targetId].points||0;
        else return message.reply("❌ 사용법: !devpoint <지급/복원> <유저ID>");
        saveData(guildId,"points",pointsData);
        return message.reply(`✅ <@${targetId}>님 포인트 ${action} 완료`);
      }

      // === 출석 ===
      case "출석":{
        const userId=author.id;
        const now=new Date();
        const last=attendance[userId]?.lastCheck?new Date(attendance[userId].lastCheck):null;
        if(last && now-last<24*60*60*1000) return message.reply("⏰ 이미 오늘 출석했습니다. 24시간 후 다시 출석 가능!");
        attendance[userId]={ username:author.username, lastCheck: now.toISOString() };
        saveData(guildId,"attendance",attendance);
        pointsData[userId]={ username:author.username, points:(pointsData[userId]?.points||0)+2000 };
        saveData(guildId,"points",pointsData);
        return message.reply("✅ 출석 완료! 2000 포인트 획득");
      }

      // === 포인트 조회/랭킹 ===
      case "포인트": return message.reply(`💰 현재 포인트: ${(pointsData[author.id]?.points||0).toLocaleString()}pt`);
      case "포인트랭킹":{
        const ranking = Object.entries(pointsData)
          .filter(([id])=>id!==BOT_ASSET_KEY) // 봇자산 제외
          .sort((a,b)=> (b[1].points||0) - (a[1].points||0))
          .slice(0,10)
          .map(([id,data],i)=>`${i+1}위 ${data.username}: ${data.points?.toLocaleString()||0}pt`)
          .join("\n")||"랭킹 데이터가 없습니다.";
        return message.reply(`🏆 포인트 상위 10위\n${ranking}`);
      }

      // === 시공의폭풍 (채널 전체 삭제) ===
      case "시공의폭풍": {
        // 경고 + 버튼
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId("storm_yes").setLabel("예").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("storm_no").setLabel("아니오").setStyle(ButtonStyle.Secondary)
          );

        const warningMsg = await message.reply({ 
          content: "⚠️ 주의! 이 채널의 모든 메시지가 삭제됩니다. 계속 진행하시겠습니까?", 
          components: [row] 
        });

        // 버튼 클릭 이벤트 처리 (명령어 실행자만 허용)
        const collector = warningMsg.createMessageComponentCollector({ time: 15000, max: 1, filter: i => i.user.id === author.id });

        collector.on("collect", async i => {
          if(i.customId === "storm_no") {
            await i.update({ content: "❌ 시공의 폭풍 명령어가 취소되었습니다.", components: [] });
            return;
          }
          if(i.customId === "storm_yes") {
            await i.deferUpdate();
            // 메시지 삭제 루프 (최대 100씩)
            try{
              let fetched;
              do {
                fetched = await message.channel.messages.fetch({ limit: 100 });
                if(fetched.size > 0){
                  // bulkDelete는 14일 지난 메시지는 삭제 불가; true로 partial 허용
                  const deleted = await message.channel.bulkDelete(fetched, true).catch(()=>null);
                  // 알림 (선택적)
                  if(deleted && deleted.size){
                    await message.channel.send(`🕶 최근 ${deleted.size}개의 메시지를 삭제했습니다.`).catch(()=>{});
                  }
                }
              } while(fetched && fetched.size >= 2); // interaction 메시지가 남지 않도록 루프 제한
            }catch(e){
              // 에러는 로그로 보냄
              await devLogError(guild, author, e, "STORM_ERR");
            }
            await message.channel.send(`💥 @${author.username}님이 시공의 폭풍을 사용했습니다!`);
          }
        });

        return;
      }

      // === 맨인블랙 (최근 n개 삭제) ===
      case "맨인블랙": {
        const count = parseInt(args[0]);
        if(isNaN(count) || count < 1 || count > 100) return message.reply("⚠️ 1~100 사이의 숫자를 입력해주세요.");
        const deletedMessages = await message.channel.bulkDelete(count, true).catch(err => null);
        return message.channel.send(`🕶 최근 ${deletedMessages?.size || 0}개의 메시지를 삭제했습니다.`);
      }

      // === 아이템 시스템 ===
      case "아이템":{
        if(args.length<1) return message.reply("⚠️ 사용법: !아이템 <제작/등급/강화/판매/구입/시장/목록>");
        const feature=args.shift().toLowerCase();
        itemsData[author.id] = itemsData[author.id]||[];

        switch(feature){
          // 제작
          case "제작":{
            const itemName=args.join(" ");
            if(!itemName) return message.reply("아이템명을 입력해주세요.");
            if((pointsData[author.id]?.points||0)<250) return message.reply("⚠️ 포인트 부족 (250pt 필요)");
            if(itemsData[author.id].length>=5) return message.reply("⚠️ 최대 5개까지 소유 가능");
            pointsData[author.id].points = (pointsData[author.id]?.points||0)-250;
            const newItem = { name:itemName, grade:getRandomGrade(), plus:0, owner:author.id };
            itemsData[author.id].push(newItem);
            saveData(guildId,"points",pointsData);
            saveData(guildId,"items",itemsData);
            return message.reply(`✅ "${itemName}" 제작 완료! 등급: ${newItem.grade}`);
          }

          // 아이템 등급(개별 조회)
          case "등급":{
            const itemName=args.join(" ");
            if(!itemName) return message.reply("아이템명을 입력해주세요.");
            const item = itemsData[author.id].find(i=>i.name===itemName);
            if(!item) return message.reply("아이템 없음");
            return message.reply(`"${itemName}" - 등급: ${item.grade} / +${item.plus}`);
          }

          // 강화
          case "강화":{
            const itemName=args.join(" ");
            if(!itemName) return message.reply("아이템명을 입력해주세요.");
            const item = itemsData[author.id].find(i=>i.name===itemName);
            if(!item) return message.reply("아이템 없음");
            if(item.plus>=88) return message.reply("⚠️ 최대 강화치 도달");

            // 강화비용 계산
            let cost=215+Math.floor(item.plus/10)*190;
            if((pointsData[author.id]?.points||0)<cost) return message.reply(`⚠️ 강화 포인트 부족 (${cost}pt 필요)`);
            pointsData[author.id].points -= cost;

            const roll=Math.random();
            const destroyRate=getDestroyChance(item.plus);
            const successRate=getUpgradeSuccessRate(item.plus);

            if(roll < destroyRate){
              // 파괴
              itemsData[author.id] = itemsData[author.id].filter(i=>!(i.name===itemName && i.owner===author.id));
              saveData(guildId,"points",pointsData);
              saveData(guildId,"items",itemsData);
              return message.reply(`💥 "${itemName}" 강화 실패! 아이템이 파괴되었습니다.`);
            }

            if(roll < successRate){
              item.plus+=1;
              // 낮은 확률로 등급 상승
              if(Math.random() < 0.05 && ITEM_GRADES.indexOf(item.grade) < ITEM_GRADES.length-1){
                item.grade = ITEM_GRADES[ITEM_GRADES.indexOf(item.grade)+1];
              }
              saveData(guildId,"points",pointsData);
              saveData(guildId,"items",itemsData);
              return message.reply(`🔧 "${itemName}" 강화 성공! +${item.plus}, 등급: ${item.grade}`);
            } else {
              // 실패 시 하락
              if(item.plus>0) item.plus-=1;
              if(item.plus<0) item.plus=0;
              saveData(guildId,"points",pointsData);
              saveData(guildId,"items",itemsData);
              return message.reply(`⚠️ "${itemName}" 강화 실패! 현재 +${item.plus}, 등급: ${item.grade}`);
            }
          }

          // 판매
          case "판매":{
            const itemName = args[0];
            const price = parseInt(args[1]);
            if(!itemName || isNaN(price)) return message.reply("⚠️ 사용법: !아이템 판매 <이름> <가격>");
            const itemIndex = itemsData[author.id].findIndex(i=>i.name===itemName && i.owner===author.id);
            if(itemIndex===-1) return message.reply("아이템 없음");
            if((pointsData[author.id]?.points||0) < 100) return message.reply("⚠️ 판매 수수료 100pt 필요");
            pointsData[author.id].points -= 100; // 수수료
            const item = itemsData[author.id].splice(itemIndex,1)[0];
            // 시장에 등록 (seller 아이디 포함)
            marketData.push({...item, seller: author.id, price});
            saveData(guildId,"points",pointsData);
            saveData(guildId,"items",itemsData);
            saveData(guildId,"market",marketData);
            return message.reply(`🛒 "${itemName}" 판매 등록 완료 (${price}pt)`);
          }

          // 구입
          case "구입":{
            const itemName = args[0];
            if(!itemName) return message.reply("아이템명 입력 필요");
            const index = marketData.findIndex(i=>i.name===itemName);
            if(index===-1) return message.reply("시장에 해당 아이템 없음");
            const item = marketData[index];
            if((pointsData[author.id]?.points||0) < item.price) return message.reply("포인트 부족");
            if(itemsData[author.id].length >= 5) return message.reply("최대 5개 소유 가능");
            // 구매 처리
            pointsData[author.id].points -= item.price;
            // 구매자는 아이템 소유권 획득
            const purchasedItem = {...item, owner: author.id};
            delete purchasedItem.seller;
            delete purchasedItem.price;
            itemsData[author.id].push(purchasedItem);
            // 판매자에게 90% + 100pt 지급(원본 로직)
            pointsData[item.seller] = pointsData[item.seller] || { username: "알 수 없음", points: 0 };
            pointsData[item.seller].points += (Math.floor(item.price * 0.9) + 100);
            // 시장에서 제거
            marketData.splice(index,1);
            saveData(guildId,"points",pointsData);
            saveData(guildId,"items",itemsData);
            saveData(guildId,"market",marketData);
            return message.reply(`✅ "${itemName}" 구입 완료!`);
          }

          // 시장 목록
          case "시장":{
            if(marketData.length===0) return message.reply("시장에 판매 아이템 없음");
            const list = marketData.map(i=>`${i.name} - +${i.plus} (${i.grade}) - ${i.price}pt - 판매자: <@${i.seller}>`).join("\n");
            return message.reply(`🛒 시장 아이템 목록\n${list}`);
          }

          // 소유 목록
          case "목록":{
            const list = (itemsData[author.id] || []).map(i=>`${i.name} - +${i.plus} (${i.grade})`).join("\n") || "소유 아이템 없음";
            return message.reply(`📦 당신의 아이템\n${list}`);
          }

          default:
            return message.reply("존재하지 않는 기능");
        }
      }

      // === 봇 자산 조회 ===
      case "봇자산":{
        const asset = getBotAsset(guildId);
        return message.reply(`💰 길냥이봇 재산: ${asset.toLocaleString()}pt`);
      }

      // === 채널 생성 ===
      case "채널생성":{
        if(args.length<2) return message.reply("사용법: !채널생성 <카테고리명> <채널명>");
        const categoryName = args.shift();
        const channelName = args.join(" ");
        // 카테고리 찾기
        const category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.includes(categoryName));
        if(!category) return message.reply("해당 카테고리 없음");
        // 생성
        await guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id }).catch(err=>{});
        return message.reply(`✅ "${channelName}" 채널 생성 완료`);
      }

      // === 기본 역할 설정 ===
      case "기본역할":{
        const role = message.mentions.roles.first();
        if(!role) return message.reply("멘션 필요. 사용법: !기본역할 <@역할>");
        saveData(guildId,"defaultRole",{ id: role.id });
        return message.reply(`✅ 기본 역할 ${role.name} 설정 완료`);
      }

      // === 공지 기능 ===
      case "공지":{
        if(!args.length) return message.reply("사용법: !공지 <내용>");
        if(!NOTICE_CHANNEL_ID) return message.reply("공지 채널이 설정되어 있지 않습니다 (NOTICE_CHANNEL_ID)");
        const contentNotice = args.join(" ");
        const ch = await guild.channels.fetch(NOTICE_CHANNEL_ID).catch(()=>null);
        if(!ch || !ch.isTextBased()) return message.reply("공지 채널을 찾을 수 없습니다.");
        ch.send({ content: `📢 공지: ${contentNotice}` }).catch(()=>{});
        return message.reply("✅ 공지 전송 완료");
      }

      default:
        await message.reply("Error Code : 040");
        await devLogError(guild,author,`명령어 오류: "${cmd}" 입력됨`,"040");
    }

  }catch(err){
    // 전역 에러 처리
    try{ await devLogError(message.guild, message.author, err, "343"); }catch(e){}
    await message.reply("Error Code : 343").catch(()=>{});
  }
});

// === 새 유저 입장 ===
client.on("guildMemberAdd", async (member)=>{
  const guildId = member.guild.id;
  ensureServerData(guildId);
  const joinQueue = loadData(guildId,"joinQueue");
  joinQueue[member.id] = { joinTime: new Date().toISOString(), introDone:false };
  saveData(guildId,"joinQueue",joinQueue);

  if(WELCOME_CHANNEL_ID){
    const welcomeCh = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(()=>null);
    if(welcomeCh && welcomeCh.isTextBased()) welcomeCh.send(`🎉 ${member.user.tag}님 입장! 자기소개 작성해주세요.`);
  }
});

// === 24시간 자기소개 미작성 강퇴 ===
setInterval(async ()=>{
  for(const guild of client.guilds.cache.values()){
    const guildId = guild.id;
    ensureServerData(guildId);
    const joinQueue = loadData(guildId,"joinQueue");
    let updated=false;
    const now=new Date();

    for(const [userId, info] of Object.entries(joinQueue)){
      if(!info.introDone){
        const joinTime = new Date(info.joinTime);
        if(now-joinTime>24*60*60*1000){
          const member = await guild.members.fetch(userId).catch(()=>null);
          if(member) await member.kick("자기소개 미작성").catch(()=>{});
          delete joinQueue[userId];
          updated=true;
        }
      }
    }
    if(updated) saveData(guildId,"joinQueue",joinQueue);
  }
}, 10*60*1000);

// === 로그인 ===
client.login(TOKEN);
