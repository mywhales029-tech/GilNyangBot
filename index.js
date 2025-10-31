import dotenv from "dotenv";
import {
  Client,
  GatewayIntentBits,
  Collection,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 환경변수 검증
const requiredEnvVars = ['BOT_TOKEN', 'INTRO_CHANNEL_ID', 'DEV_LOG_CHANNEL_ID', 'WELCOME_CHANNEL_ID', 'NOTICE_CHANNEL_ID'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    console.error('필수 환경 변수가 설정되지 않았습니다:', missingEnvVars.join(', '));
    process.exit(1);
}

// 환경변수
const TOKEN = process.env.BOT_TOKEN;
const INTRO_CHANNEL_ID = process.env.INTRO_CHANNEL_ID;
const DEV_LOG_CHANNEL_ID = process.env.DEV_LOG_CHANNEL_ID;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const NOTICE_CHANNEL_ID = process.env.NOTICE_CHANNEL_ID;

// 클라이언트 설정
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

let banmalMode = false, banmalReplies = [], lastBanmal, jondaetReplies = [], lastJondaet;
let botVersion = "v3.2.1";
let DEV_IDS = ["937280891967918120"];
let pointsData = {}, attendance = {}, itemsData = {}, marketData = [];
const BOT_ASSET_KEY = "bot_asset";
const ITEM_GRADES = ["일반", "고급", "희귀", "영웅", "전설"];

// 주식 시스템 상수
const STOCK_UPDATE_INTERVAL = 15 * 60 * 1000; // 15분
const MIN_STOCK_PRICE = 500;
const MIN_CREATE_STOCK_POINTS = 1900000000;
const STOCK_PRICE_CHANGE_RATES = [-0.15, -0.1, -0.05, -0.02, 0, 0.02, 0.05, 0.1, 0.15];

// 주식 시스템 함수들
function loadStockData() {
  const loaded = loadData("global", "stocks");
  // loadData may return an empty object {} if file doesn't exist or is empty.
  // In that case we must fall back to default initial market structure.
  if (loaded && typeof loaded === 'object' && Object.prototype.hasOwnProperty.call(loaded, 'stocks') && loaded.stocks && typeof loaded.stocks === 'object') {
    return loaded;
  }

  const stockData = {
    stocks: {
      "해피캐피탈": { price: 4300, initialPrice: 4300, totalShares: 1000000, available: true, owner: "system", lastUpdate: null, history: [] },
      "냐옹전자": { price: 18700, initialPrice: 18700, totalShares: 1000000, available: true, owner: "system", lastUpdate: null, history: [] },
      "냐옹그룹": { price: 98000, initialPrice: 98000, totalShares: 1000000, available: true, owner: "system", lastUpdate: null, history: [] },
      "푸른하늘엔터테이먼트": { price: 970, initialPrice: 970, totalShares: 1000000, available: true, owner: "system", lastUpdate: null, history: [] }
    },
    userStocks: {},
    marketOpen: true,
    lastGlobalUpdate: null
  };
  return stockData;
}

function saveStockData(data) {
  saveData("global", "stocks", data);
}

function updateStockPrices() {
  const stockData = loadStockData();
  const now = Date.now();

  if (!stockData.marketOpen) return;
  if (stockData.lastGlobalUpdate && now - stockData.lastGlobalUpdate < STOCK_UPDATE_INTERVAL) return;

  Object.entries(stockData.stocks).forEach(([name, stock]) => {
    if (!stock.available) return;
    
    // 가격 변동률 무작위 선택
    const changeRate = STOCK_PRICE_CHANGE_RATES[Math.floor(Math.random() * STOCK_PRICE_CHANGE_RATES.length)];
    const oldPrice = stock.price;
    let newPrice = Math.round(oldPrice * (1 + changeRate));
    
    // 최소 주가 확인
    if (newPrice < MIN_STOCK_PRICE) {
      stock.available = false;
      newPrice = 0;
    }

    stock.price = newPrice;
    stock.history.push({
      price: newPrice,
      timestamp: now,
      change: changeRate
    });

    // 히스토리는 최근 24시간만 유지
    if (stock.history.length > 96) { // 15분 * 96 = 24시간
      stock.history = stock.history.slice(-96);
    }
  });

  stockData.lastGlobalUpdate = now;
  saveStockData(stockData);
}

function formatStockPrice(price) {
  // 안전하게 숫자로 변환 후 포맷 (undefined/NaN 방지)
  const n = Number(price);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString("ko-KR") + 'pt';
}

function formatShares(amount) {
  // 최대 8자리 소수까지 표시하되 불필요한 0은 제거
  if (amount === undefined || amount === null) return '0';
  const num = Number(amount);
  if (!Number.isFinite(num)) return '0';
  const fixed = num.toFixed(8);
  // 불필요한 소수점 0 제거
  const trimmed = fixed.replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, '$1');
  const parts = trimmed.split('.');
  parts[0] = Number(parts[0]).toLocaleString("ko-KR");
  return parts.join('.') ;
}

function getStockPriceChangeEmoji(changeRate) {
  if (changeRate > 0) return '📈';
  if (changeRate < 0) return '📉';
  return '➡️';
}

function getStockStatusEmbed(stockData, stockName) {
  const stock = stockData.stocks[stockName];
  if (!stock) return null;

  const history = stock.history;
  const lastPrice = history.length > 1 ? history[history.length - 2].price : stock.initialPrice;
  const priceChange = stock.price - lastPrice;
  const changeRate = (priceChange / lastPrice * 100).toFixed(2);
  const emoji = getStockPriceChangeEmoji(priceChange);

  return new EmbedBuilder()
    .setTitle(`${emoji} ${stockName} 주가 정보`)
    .setColor(priceChange > 0 ? 0x00ff00 : priceChange < 0 ? 0xff0000 : 0x808080)
    .addFields(
      { name: '현재 주가', value: formatStockPrice(stock.price), inline: true },
      { name: '전일 대비', value: `${priceChange >= 0 ? '+' : ''}${formatStockPrice(priceChange)} (${changeRate}%)`, inline: true },
      { name: '거래 상태', value: stock.available ? '거래가능' : '거래중지', inline: true },
  { name: '시가총액', value: formatStockPrice((Number(stock.price) || 0) * (Number(stock.totalShares) || 0)), inline: true },
  { name: '발행주식수', value: (Number(stock.totalShares) || 0).toLocaleString("ko-KR") + '주', inline: true },
      { name: '소유자', value: stock.owner === 'system' ? '시스템' : `<@${stock.owner}>`, inline: true }
    )
    .setFooter({ text: '매 15분마다 가격이 갱신됩니다.' })
    .setTimestamp();
}

// 감시 시스템 데이터
let surveillanceData = { servers: {}, userPatterns: {} };
const PATTERN_UPDATE_INTERVAL = 60 * 60 * 1000; // 1시간마다 패턴 업데이트
const MAX_MESSAGE_HISTORY = 100; // 유저당 저장할 최대 메시지 수
const MIN_MESSAGES_FOR_PATTERN = 10; // 패턴 분석을 위한 최소 메시지 수

// 감시 데이터 저장/로드 함수
function loadSurveillanceData() {
  const filePath = path.join(__dirname, "data", "surveillance.json");
  try {
    if (fs.existsSync(filePath)) {
      surveillanceData = JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (error) {
    console.error("감시 데이터 로드 실패:", error);
  }
}

function saveSurveillanceData() {
  const filePath = path.join(__dirname, "data", "surveillance.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify(surveillanceData, null, 2), "utf8");
  } catch (error) {
    console.error("감시 데이터 저장 실패:", error);
  }
}

// 사용자 메시지 패턴 분석
function analyzeUserPattern(userId, messages) {
  if (messages.length < MIN_MESSAGES_FOR_PATTERN) return null;

  const pattern = {
    messageCount: messages.length,
    averageLength: Math.floor(messages.reduce((sum, msg) => sum + msg.content.length, 0) / messages.length),
    commonWords: {},
    activeHours: Array(24).fill(0),
    lastAnalyzed: Date.now()
  };

  // 자주 사용하는 단어 분석
  messages.forEach(msg => {
    const words = msg.content.split(/\s+/);
    words.forEach(word => {
      if (word.length >= 2) {
        pattern.commonWords[word] = (pattern.commonWords[word] || 0) + 1;
      }
    });

    // 활동 시간대 분석
    const hour = new Date(msg.timestamp).getHours();
    pattern.activeHours[hour]++;
  });

  // 가장 자주 사용하는 단어 상위 10개만 유지
  pattern.commonWords = Object.entries(pattern.commonWords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .reduce((obj, [word, count]) => {
      obj[word] = count;
      return obj;
    }, {});

  return pattern;
}

client.commands = new Collection();

// === 데이터 저장/로드 ===
function ensureServerData(guildId) {
  const basePath = path.join(__dirname, "data", guildId);
  if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });
}

function loadData(guildId, file) {
  const filePath = path.join(__dirname, "data", guildId, `${file}.json`);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function saveData(guildId, file, data) {
  const filePath = path.join(__dirname, "data", guildId, `${file}.json`);
  try {
    ensureServerData(guildId);
    // 임시 파일에 먼저 저장
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    // 성공적으로 저장되면 실제 파일로 이동
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    console.error(`데이터 저장 실패 (${guildId}/${file}):`, error);
    devLogError(null, null, error, "DATA_SAVE_ERR");
  }
}
// === 기본 유틸 ===
function validateIntro(content) {
  // 필수 항목 정의
  const required = {
    "디코닉": /디코닉\s*:\s*.+/,
    "나이": /나이\s*:\s*\d{1,2}세?/,
    "성별": /성별\s*:\s*(남성?|여성?|남자?|여자?)/,
    "지역": /지역\s*:\s*.+/
  };

  // 각 필수 항목 검사
  const missing = [];
  for (const [field, pattern] of Object.entries(required)) {
    if (!pattern.test(content)) {
      missing.push(field);
    }
  }

  // 검증 결과 반환
  return {
    isValid: missing.length === 0,
    missing: missing,
    content: content
  };
}

function getIntroTemplate() {
  return [
    "📝 자기소개 양식",
    "",
    "아래 양식을 복사하여 작성해주세요.",
    "",
    "디코닉 : ",
    "나이 : ",
    "성별 : ",
    "지역 : ",
    "",
    "✨ 예시)",
    "",
    "디코닉 : 길냥",
    "나이 : 02",
    "성별 : 남",
    "지역 : 부산"
  ].join("\n");
}

function getRandomReply(list, last) {
  const defaults = ["안녕! 🐾", "반가워~", "오늘 기분 어때?", "냥! 왔냥?", "헤헷 안녕!"];
  const replies = list.length ? list : defaults;
  let reply;
  do {
    reply = replies[Math.floor(Math.random() * replies.length)];
  } while (replies.length > 1 && reply === last);
  return reply;
}

// === 오류 로그 전송 ===
async function devLogError(guild, user, error, code) {
  try {
    const channel = await client.channels.fetch(DEV_LOG_CHANNEL_ID);
    if (!channel) return;
    await channel.send(
      `🚨 **BOT 오류 발생**\n📌 Error Code : ${code}\n👤 사용자 : ${user?.tag}\n🏰 서버 : ${guild?.name}\n⚡ 오류 메시지 : ${error}`
    );
  } catch (e) {
    console.error("로그 전송 실패:", e);
  }
}

// === 봇 시작 ===
client.once("ready", () => {
  console.log(`✅ ${client.user.tag} 로그인 완료`);
  loadSurveillanceData(); // 감시 데이터 로드
  const statuses = [
    () => `🐾 길냥이봇 | &도움말`,
    () => `${client.guilds.cache.size}개의 서버와 함께!`,
    () => `🛠️ 업데이트 준비 중...`,
  ];
  let i = 0;
  setInterval(() => {
    client.user.setPresence({
      activities: [{ name: statuses[i % statuses.length](), type: 0 }],
      status: "online",
    });
    i++;
  }, 10000);
});

// ✅ 메시지 이벤트 처리
client.on("messageCreate", async message => {
  try {
    if (message.author.bot || !message.guild) return;

    const { guild, author, content } = message;
    const channel = message.channel;
    const guildId = guild.id;

    // 감시 시스템 처리
    if (surveillanceData.servers[guildId]?.enabled) {
      const userId = author.id;
      if (!surveillanceData.userPatterns[guildId]) {
        surveillanceData.userPatterns[guildId] = {};
      }
      if (!surveillanceData.userPatterns[guildId][userId]) {
        surveillanceData.userPatterns[guildId][userId] = {
          messages: [],
          pattern: null,
          stats: {
            messages: 0,
            stickers: 0,
            emojis: 0,
            gifs: 0,
            links: 0
          }
        };
      } else {
        // 보장: stats 필드가 숫자로 존재하도록 보정
        surveillanceData.userPatterns[guildId][userId].stats = surveillanceData.userPatterns[guildId][userId].stats || {};
        const s = surveillanceData.userPatterns[guildId][userId].stats;
        s.messages = Number(s.messages || 0) || 0;
        s.stickers = Number(s.stickers || 0) || 0;
        s.emojis = Number(s.emojis || 0) || 0;
        s.gifs = Number(s.gifs || 0) || 0;
        s.links = Number(s.links || 0) || 0;
      }

      // 메시지 저장 및 통계 업데이트
      const userPattern = surveillanceData.userPatterns[guildId][userId];
      userPattern.messages.push({
        content: content,
        timestamp: message.createdTimestamp,
        channelId: channel.id
      });
      userPattern.stats.messages += 1;

      // 이모지(Unicode) 수 카운트 (간단 추정)
      const emojiRegex = /\p{Extended_Pictographic}/gu;
      const emojiMatches = content.match(emojiRegex);
      if (emojiMatches) userPattern.stats.emojis += emojiMatches.length;

      // 링크 감지
      const urlRegex = /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
      const urlMatches = content.match(urlRegex);
      if (urlMatches) userPattern.stats.links += urlMatches.length;

      // 첨부된 파일 검사 (스티커/이미지/GIF 구분)
      if (message.stickers && message.stickers.size > 0) {
        userPattern.stats.stickers += message.stickers.size;
      }
      if (message.attachments && message.attachments.size > 0) {
        message.attachments.forEach(att => {
          const name = (att.name || '').toLowerCase();
          const url = (att.url || '').toLowerCase();
          if (name.endsWith('.gif') || url.endsWith('.gif')) {
            userPattern.stats.gifs += 1;
          } else if (/(png|jpg|jpeg|webp)$/.test(name) || /(png|jpg|jpeg|webp)$/.test(url)) {
            // 일반 이미지는 이모지/이미지로 따로 카운트하지 않음
          } else {
            // 기타 첨부
          }
        });
      }

      // 최대 메시지 수 제한
      if (userPattern.messages.length > MAX_MESSAGE_HISTORY) {
        userPattern.messages.shift();
      }

      // 주기적으로 패턴 분석
      const now = Date.now();
      if (!userPattern.pattern || now - userPattern.pattern.lastAnalyzed > PATTERN_UPDATE_INTERVAL) {
        const newPattern = analyzeUserPattern(userId, userPattern.messages);
        if (newPattern) {
          userPattern.pattern = newPattern;
          saveSurveillanceData();
        }
      }
    }
    ensureServerData(guildId);

    const config = loadData(guildId, "config");
    // 지정 채널에서 메시지 제한
    for (const category of ["명령어", "자기소개"]) {
      const targetChannelId = config.channels?.[category];
      if (!targetChannelId) continue;

      if (channel.id === targetChannelId) {
        if (category === "명령어" && !content.startsWith("&")) {
          // 명령어 채널: 일반 메시지 삭제
          await message.delete().catch(() => {});
          return;
        }
        if (category === "자기소개" && content.startsWith("&")) {
          // 자기소개 채널: 명령어 삭제
          await message.delete().catch(() => {});
          return;
        }
      }
    }

    const introChannelId = config.channels?.["자기소개"];
    const targetIntroChannelId = introChannelId || INTRO_CHANNEL_ID;

    // ✅ 자기소개 감지 + 역할 지급
    if (targetIntroChannelId && message.channel.id === targetIntroChannelId) {
      // 봇의 메시지는 무시
      if (message.author.bot) return;

      const joinQueue = loadData(guildId, "joinQueue");
  // loadData may return {} or null-like; ensure it's an object we can mutate
  const safeJoinQueue = (joinQueue && typeof joinQueue === 'object') ? joinQueue : {};
      const defaultRoleData = loadData(guildId, "defaultRole");

      // 자기소개 유효성 검사
      const validation = validateIntro(content);
      if (!validation.isValid) {
        const template = getIntroTemplate();
        const errorMsg = [
          "⚠️ 자기소개 양식이 올바르지 않습니다.",
          "",
          `❌ 누락되거나 잘못된 항목: ${validation.missing.join(", ")}`,
          "",
          "✅ 아래 양식을 복사하여 작성해주세요.",
          "ℹ️ 콜론(:) 뒤에 한 칸 띄우고 작성해주세요!",
          "",
          template,
          "",
          "⚠️ 주의사항:",
          "• 위 양식을 그대로 복사해서 수정해주세요",
          "• 각 항목의 콜론(:) 뒤에 반드시 한 칸을 띄워주세요",
          "• 나이는 숫자로만 입력해주세요",
          "• 성별은 남/여로만 입력해주세요"
        ].join("\n");
        
        return message.reply(errorMsg).then(msg => {
          setTimeout(() => msg.delete().catch(() => {}), 15000); // 15초 후 안내 메시지 삭제
        });
      }

      // 기존 자기소개가 있는지 확인
      const member = await guild.members.fetch(author.id).catch(() => null);
      if (!member) return;

      // 기본 역할이 설정되어 있지 않으면 알림
      if (!defaultRoleData?.id) {
        return message.reply("⚠️ 서버에 기본 역할이 설정되어 있지 않습니다. 관리자에게 문의하세요.").then(msg => {
          setTimeout(() => msg.delete().catch(() => {}), 5000);
        });
      }

      // 이미 기본 역할을 가지고 있는지 확인
      const role = guild.roles.cache.get(defaultRoleData.id);
      if (!role) {
        return message.reply("⚠️ 설정된 기본 역할을 찾을 수 없습니다. 관리자에게 문의하세요.").then(msg => {
          setTimeout(() => msg.delete().catch(() => {}), 5000);
        });
      }

      if (member.roles.cache.has(role.id)) {
        return message.reply("ℹ️ 이미 기본 역할을 보유하고 있습니다.").then(msg => {
          setTimeout(() => msg.delete().catch(() => {}), 5000);
        });
      }

      // joinQueue에 없어도 자기소개하면 역할 지급 (복구 기능)
      if (!safeJoinQueue[author.id]) {
        safeJoinQueue[author.id] = {
          joinTime: new Date().toISOString(),
          introDone: false
        };
      }

      // 자기소개 완료 처리
      safeJoinQueue[author.id].introDone = true;
      saveData(guildId, "joinQueue", safeJoinQueue);

      // 역할 지급
      try {
        await member.roles.add(role);
        const successMsg = await message.reply("✅ 자기소개 확인 완료! 기본 역할이 지급되었습니다.");
        setTimeout(() => successMsg.delete().catch(() => {}), 5000);
      } catch (error) {
        console.error("역할 지급 실패:", error);
        return message.reply("❌ 역할 지급 중 오류가 발생했습니다. 관리자에게 문의하세요.").then(msg => {
          setTimeout(() => msg.delete().catch(() => {}), 5000);
        });
      }

      // 로그 채널에 기록
      const logChannelId = config.channels?.["로그"];
      if (logChannelId) {
        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (logChannel?.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle("✅ 자기소개 완료")
            .setColor(0x00ff00)
            .setDescription(`${author.tag}님이 자기소개를 작성했습니다.`)
            .addFields(
              { name: "멤버", value: `<@${author.id}>`, inline: true },
              { name: "역할", value: role.name, inline: true },
              { name: "자기소개", value: content.length > 1000 ? content.slice(0, 997) + "..." : content }
            )
            .setTimestamp();
          logChannel.send({ embeds: [embed] }).catch(() => {});
        }
      }
    }

    // === 명령어 처리 ===
    if (!content.startsWith("&")) return;
    const args = content.slice(1).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();
    if (!cmd) return;;

    switch (cmd) {
      case "채널설정": {
        if (!message.member.permissions.has("ManageGuild"))
          return message.reply("⚠️ 서버 관리 권한이 필요합니다.");

        const subCommand = args[0]?.toLowerCase();
        if (!subCommand) {
          const embed = new EmbedBuilder()
            .setTitle("📋 채널 설정 도움말")
            .setColor(0x00ff00)
            .setDescription("채널 설정 관련 명령어 안내")
            .addFields(
              { name: "채널 지정", value: "`&채널설정 지정 <분류> <#채널>`\n- 분류: 자기소개/입장/명령어/공지/로그" },
              { name: "채널 해제", value: "`&채널설정 해제 <분류>`\n- 설정된 채널을 해제합니다." },
              { name: "채널 목록", value: "`&채널설정 목록`\n- 현재 설정된 채널들을 확인합니다." },
              { name: "채널 초기화", value: "`&채널설정 초기화`\n- 모든 채널 설정을 초기화합니다." }
            )
            .setFooter({ text: "관리자 전용 명령어입니다." });
          return message.reply({ embeds: [embed] });
        }

        config.channels = config.channels || {};

        switch (subCommand) {
          case "지정": {
            const category = args[1]?.toLowerCase();
            const channel = message.mentions.channels.first();
            const validCategories = ["자기소개", "입장", "명령어", "공지", "로그"];
            
            if (!validCategories.includes(category))
              return message.reply(`⚠️ 분류는 [${validCategories.join("/")}] 중 하나여야 합니다.`);
            if (!channel) 
              return message.reply("⚠️ 채널을 멘션해주세요.");
            if (channel.type !== ChannelType.GuildText)
              return message.reply("⚠️ 텍스트 채널만 지정할 수 있습니다.");

            config.channels[category] = channel.id;
            saveData(guildId, "config", config);
            
            const embed = new EmbedBuilder()
              .setTitle("✅ 채널 설정 완료")
              .setColor(0x00ff00)
              .setDescription(`${category} 채널이 ${channel}로 지정되었습니다.`)
              .addFields(
                { name: "분류", value: category, inline: true },
                { name: "채널", value: channel.toString(), inline: true }
              )
              .setTimestamp();
            return message.reply({ embeds: [embed] });
          }

          case "해제": {
            const category = args[1]?.toLowerCase();
            if (!category || !config.channels[category])
              return message.reply("⚠️ 해제할 분류를 지정해주세요.");

            const oldChannel = guild.channels.cache.get(config.channels[category]);
            delete config.channels[category];
            saveData(guildId, "config", config);

            const embed = new EmbedBuilder()
              .setTitle("🗑️ 채널 설정 해제")
              .setColor(0xff0000)
              .setDescription(`${category} 채널 설정이 해제되었습니다.`)
              .addFields(
                { name: "분류", value: category, inline: true },
                { name: "이전 채널", value: oldChannel ? oldChannel.toString() : "알 수 없음", inline: true }
              )
              .setTimestamp();
            return message.reply({ embeds: [embed] });
          }

          case "목록": {
            const channelList = Object.entries(config.channels).map(([category, channelId]) => {
              const channel = guild.channels.cache.get(channelId);
              return `**${category}**: ${channel ? channel.toString() : "❌ 삭제됨"}`;
            }).join("\n") || "설정된 채널이 없습니다.";

            const embed = new EmbedBuilder()
              .setTitle("📋 채널 설정 목록")
              .setColor(0x0099ff)
              .setDescription(channelList)
              .setTimestamp();
            return message.reply({ embeds: [embed] });
          }

          case "초기화": {
            const row = new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId("channel_reset_confirm")
                  .setLabel("초기화")
                  .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                  .setCustomId("channel_reset_cancel")
                  .setLabel("취소")
                  .setStyle(ButtonStyle.Secondary)
              );

            const confirmMsg = await message.reply({
              content: "⚠️ 모든 채널 설정을 초기화하시겠습니까?",
              components: [row]
            });

            const collector = confirmMsg.createMessageComponentCollector({
              time: 15000,
              max: 1,
              filter: i => i.user.id === author.id
            });

            collector.on("collect", async i => {
              if (i.customId === "channel_reset_cancel") {
                await i.update({ content: "❌ 초기화가 취소되었습니다.", components: [] });
                return;
              }

              if (i.customId === "channel_reset_confirm") {
                const oldChannels = { ...config.channels };
                config.channels = {};
                saveData(guildId, "config", config);

                const embed = new EmbedBuilder()
                  .setTitle("🗑️ 채널 설정 초기화 완료")
                  .setColor(0xff0000)
                  .setDescription("모든 채널 설정이 초기화되었습니다.")
                  .addFields({
                    name: "이전 설정",
                    value: Object.entries(oldChannels)
                      .map(([cat, id]) => `${cat}: <#${id}>`)
                      .join("\n") || "없음"
                  })
                  .setTimestamp();
                await i.update({ content: null, embeds: [embed], components: [] });
              }
            });

            collector.on("end", async (collected, reason) => {
              if (reason === "time") {
                await confirmMsg.edit({
                  content: "⏳ 시간이 초과되어 초기화가 취소되었습니다.",
                  components: []
                });
              }
            });
            return;
          }

          default:
            return message.reply("⚠️ 올바른 하위 명령어를 입력해주세요. `&채널설정` 으로 도움말을 확인하세요.");
        }
      }
      case "안녕": {
        const reply = banmalMode ? getRandomReply(banmalReplies, lastBanmal) : getRandomReply(jondaetReplies, lastJondaet);
        if (banmalMode) lastBanmal = reply; else lastJondaet = reply;
        return message.reply(reply);
      }
      case "반모": banmalMode=true; return message.reply("이제부터 반말로 대답할게.");
      case "반종": banmalMode=false; return message.reply("존댓말 모드로 돌아왔습니다.");
      case "시간": return message.reply(`현재 시간: ${new Date().toLocaleString("ko-KR")}`);
      case "길냥이봇정보": {
        const embedInfo=new EmbedBuilder()
          .setTitle("🤖 봇 정보")
          .setColor(0x00aaff)
          .addFields(
            {name:"이름",value:client.user.username,inline:true},
            {name:"개발일",value:"2025.10.12",inline:true},
            {name:"소속 서버 수",value:`${client.guilds.cache.size}`,inline:true},
            {name:"엔진",value:"NobleNetick2",inline:true},
            {name:"언어",value:"JavaScript (Node.js)",inline:true},
            {name:"버전",value:botVersion,inline:true}
          )
          .setTimestamp();
        return message.reply({embeds:[embedInfo]});
      }
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
      case "감시활성화":
      case "감시비활성화": {
        if (!message.member.permissions.has("Administrator")) {
          return message.reply("⚠️ 관리자 권한이 필요합니다.");
        }

        const enable = cmd === "감시활성화";
        const reason = args.join(" ") || null;
        const guildIdLocal = message.guild.id;
        const configLocal = loadData(guildIdLocal, "config");

        // 확인 버튼 생성
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId("surv_confirm").setLabel(enable ? "활성화" : "비활성화").setStyle(enable ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("surv_cancel").setLabel("취소").setStyle(ButtonStyle.Secondary)
          );

        const preview = `서버: ${message.guild.name}\n동작: ${enable ? "감시 활성화" : "감시 비활성화"}\n사유: ${reason || "없음"}`;

        const confirmMsg = await message.reply({ content: `⚠️ 아래 설정으로 진행하시겠습니까?\n${preview}`, components: [row] });

        const collector = confirmMsg.createMessageComponentCollector({ time: 20000, max: 1, filter: i => i.user.id === message.author.id });

        collector.on("collect", async i => {
          if (i.customId === "surv_cancel") {
            await i.update({ content: "❌ 취소되었습니다.", components: [] });
            return;
          }

          // 실행
          if (enable) {
            surveillanceData.servers[guildIdLocal] = {
              enabled: true,
              name: message.guild.name,
              enabledAt: Date.now(),
              enabledBy: message.author.id,
              reason: reason
            };
            saveSurveillanceData();

            const embedOk = new EmbedBuilder()
              .setTitle("🔍 서버 감시 활성화 완료")
              .setColor(0x00ff00)
              .setDescription(`${message.guild.name} 서버의 감시가 활성화되었습니다.`)
              .addFields(
                { name: "서버 ID", value: guildIdLocal, inline: true },
                { name: "설정자", value: message.author.tag, inline: true },
                { name: "사유", value: reason || "없음", inline: true }
              )
              .setTimestamp();

            await i.update({ content: null, embeds: [embedOk], components: [] });

            // 로그 채널 전송
            const logChannelId = configLocal.channels?.["로그"] || DEV_LOG_CHANNEL_ID;
            const logCh = await message.guild.channels.fetch(logChannelId).catch(() => null);
            if (logCh?.isTextBased()) logCh.send({ embeds: [embedOk] }).catch(() => {});

            return;
          } else {
            // disable
            const prev = surveillanceData.servers[guildIdLocal] || {};
            surveillanceData.servers[guildIdLocal] = {
              ...prev,
              enabled: false,
              disabledAt: Date.now(),
              disabledBy: message.author.id,
              disabledReason: reason
            };

            // 옵션: '초기화' 키워드가 있으면 수집 데이터 초기화
            if ((reason || "").includes("초기화")) {
              delete surveillanceData.userPatterns[guildIdLocal];
            }

            saveSurveillanceData();

            const embedOk = new EmbedBuilder()
              .setTitle("🔍 서버 감시 비활성화 완료")
              .setColor(0xff0000)
              .setDescription(`${message.guild.name} 서버의 감시가 비활성화되었습니다.`)
              .addFields(
                { name: "서버 ID", value: guildIdLocal, inline: true },
                { name: "설정자", value: message.author.tag, inline: true },
                { name: "사유", value: reason || "없음", inline: true }
              )
              .setTimestamp();

            await i.update({ content: null, embeds: [embedOk], components: [] });

            const logChannelId = configLocal.channels?.["로그"] || DEV_LOG_CHANNEL_ID;
            const logCh = await message.guild.channels.fetch(logChannelId).catch(() => null);
            if (logCh?.isTextBased()) logCh.send({ embeds: [embedOk] }).catch(() => {});

            return;
          }
        });

        collector.on("end", (collected, reasonEnd) => {
          if (reasonEnd === "time") {
            confirmMsg.edit({ content: "⏳ 시간이 초과되어 취소되었습니다.", components: [] }).catch(() => {});
          }
        });

        return;
      }

      case "감시현황": {
        if (!message.member.permissions.has("Administrator")) {
          return message.reply("⚠️ 관리자 권한이 필요합니다.");
        }

        const guildPattern = surveillanceData.userPatterns[message.guild.id];
        if (!guildPattern || !surveillanceData.servers[message.guild.id]?.enabled) {
          return message.reply("❌ 이 서버는 감시가 활성화되어 있지 않습니다.");
        }

        const userPatterns = Object.entries(guildPattern);
  const totalUsers = userPatterns.length;
  const totalMessages = userPatterns.reduce((sum, [_, data]) => sum + (data?.messages?.length || 0), 0);
  const totalStickers = userPatterns.reduce((sum, [_, data]) => sum + (data?.stats?.stickers || 0), 0);
  const totalEmojis = userPatterns.reduce((sum, [_, data]) => sum + (data?.stats?.emojis || 0), 0);
  const totalGifs = userPatterns.reduce((sum, [_, data]) => sum + (data?.stats?.gifs || 0), 0);
  const totalLinks = userPatterns.reduce((sum, [_, data]) => sum + (data?.stats?.links || 0), 0);

        const embed = new EmbedBuilder()
          .setTitle("📊 서버 감시 현황")
          .setColor(0x0099ff)
          .setDescription(`'${message.guild.name}' 서버의 감시 현황입니다.`)
          .addFields(
            { name: "감시 중인 유저 수", value: totalUsers.toString(), inline: true },
            { name: "수집된 총 메시지", value: totalMessages.toString(), inline: true },
            { name: "수집된 스티커", value: totalStickers.toString(), inline: true },
            { name: "수집된 이모지(추정)", value: totalEmojis.toString(), inline: true },
            { name: "수집된 GIF", value: totalGifs.toString(), inline: true },
            { name: "수집된 링크", value: totalLinks.toString(), inline: true },
            { name: "활성화 일시", value: surveillanceData.servers[message.guild.id]?.enabledAt ? new Date(surveillanceData.servers[message.guild.id].enabledAt).toLocaleString("ko-KR") : "설정 없음", inline: true }
          );

        // 상위 5명의 활동적인 사용자 표시
        const topUsers = userPatterns
          .filter(([_, data]) => data.pattern)
          .sort((a, b) => b[1].pattern.messageCount - a[1].pattern.messageCount)
          .slice(0, 5);

        if (topUsers.length > 0) {
          embed.addFields({
            name: "🏆 가장 활동적인 사용자",
            value: await Promise.all(topUsers.map(async ([userId, data], index) => {
              const user = await client.users.fetch(userId).catch(() => null);
              return user ? 
                `${index + 1}. ${user.tag}: ${data.pattern.messageCount}개 메시지, ` +
                `평균 ${data.pattern.averageLength}자` : 
                `${index + 1}. 알 수 없는 사용자`;
            }))
          });
        }

        return message.reply({ embeds: [embed] });
      }

      case "서버정보": {
        // 누구나 볼 수 있도록 설정
        const configData = loadData(guildId, "config");
        const defaultRole = loadData(guildId, "defaultRole");

        // 관리자 목록 수집
        const admins = guild.members.cache
          .filter(m => m.permissions && m.permissions.has && m.permissions.has("Administrator"))
          .map(m => `${m.user.tag}`)
          .slice(0, 25);

        const owner = guild.ownerId ? (guild.members.cache.get(guild.ownerId)?.user.tag || guild.ownerId) : "알 수 없음";

        const embed = new EmbedBuilder()
          .setTitle(`🏷️ 서버 정보: ${guild.name}`)
          .setColor(0x00cc99)
          .addFields(
            { name: "서버명", value: guild.name, inline: true },
            { name: "서버 소유자", value: owner, inline: true },
            { name: "기본 역할", value: defaultRole?.id ? `<@&${defaultRole.id}>` : "설정되지 않음", inline: true },
            { name: "채널 설정(예시)", value: Object.entries(configData.channels || {}).map(([k,v])=>`${k}: <#${v}>`).join("\n") || "설정 없음", inline: false },
            { name: `관리자 (${admins.length})`, value: admins.join("\n") || "없음", inline: false }
          )
          .setTimestamp();

        return message.reply({ embeds: [embed] });
      }

      case "유저분석": {
        if (!message.member.permissions.has("Administrator")) {
          return message.reply("⚠️ 관리자 권한이 필요합니다.");
        }

        const targetUser = message.mentions.users.first();
        if (!targetUser) {
          return message.reply("⚠️ 분석할 유저를 멘션해주세요.");
        }

        const guildPattern = surveillanceData.userPatterns[message.guild.id];
        if (!guildPattern || !surveillanceData.servers[message.guild.id]?.enabled) {
          return message.reply("❌ 이 서버는 감시가 활성화되어 있지 않습니다.");
        }

        const userPattern = guildPattern[targetUser.id]?.pattern;
        if (!userPattern) {
          return message.reply("❌ 해당 유저의 패턴 데이터가 충분하지 않습니다.");
        }

        // 활동 시간대 그래프 생성 (간단한 ASCII 그래프)
        const maxActivity = Math.max(...userPattern.activeHours);
        const graphHeight = 5;
        const graph = userPattern.activeHours.map(count => {
          const height = Math.round((count / maxActivity) * graphHeight) || 0;
          return "█".repeat(height) + "░".repeat(graphHeight - height);
        });

        const embed = new EmbedBuilder()
          .setTitle(`👤 유저 분석: ${targetUser.tag}`)
          .setColor(0x00ffff)
          .setThumbnail(targetUser.displayAvatarURL())
          .addFields(
            { name: "총 분석된 메시지", value: userPattern.messageCount.toString(), inline: true },
            { name: "평균 메시지 길이", value: `${userPattern.averageLength}자`, inline: true },
            { name: "마지막 분석 시각", value: new Date(userPattern.lastAnalyzed).toLocaleString("ko-KR"), inline: true },
            { name: "자주 사용하는 단어", value: Object.entries(userPattern.commonWords)
              .map(([word, count]) => `${word}: ${count}회`)
              .join("\n") || "데이터 없음" },
            { name: "시간대별 활동 (0-23시)", value: "```\n" + graph.join(" ") + "\n```" }
          )
          .setTimestamp();

        return message.reply({ embeds: [embed] });
      }

      case "데이터삭제": {
        // 개발자 권한 체크
        if(!DEV_IDS.includes(author.id)) return message.reply("⛔ 개발자 권한이 필요합니다.");

        // 확인 버튼 생성
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId("data_delete_confirm")
              .setLabel("삭제 확인")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId("data_delete_cancel")
              .setLabel("취소")
              .setStyle(ButtonStyle.Secondary)
          );

        // 경고 메시지 전송
        const warningMsg = await message.reply({
          content: "⚠️ **위험!** 서버의 모든 데이터가 삭제됩니다!\n" +
                   "🔸포인트\n🔸출석\n🔸아이템\n🔸시장\n" +
                   "정말로 진행하시겠습니까?",
          components: [row]
        });

        // 버튼 클릭 이벤트 처리
        const collector = warningMsg.createMessageComponentCollector({
          time: 15000,
          max: 1,
          filter: i => i.user.id === author.id
        });

        collector.on("collect", async i => {
          if(i.customId === "data_delete_cancel") {
            await i.update({
              content: "❌ 데이터 삭제가 취소되었습니다.",
              components: []
            });
            return;
          }

          if(i.customId === "data_delete_confirm") {
            await i.update({
              content: "💫 데이터를 삭제하는 중...",
              components: []
            });

            try {
              // 데이터 파일들 삭제
              const dataFiles = ["points", "attendance", "items", "market"];
              for(const file of dataFiles) {
                const filePath = path.join(__dirname, "data", guildId, `${file}.json`);
                if(fs.existsSync(filePath)) {
                  fs.unlinkSync(filePath);
                }
              }

              // 메모리상의 데이터도 초기화
              pointsData = {};
              attendance = {};
              itemsData = {};
              marketData = [];

              // 데이터 디렉토리 재생성
              ensureServerData(guildId);

              // 빈 데이터 파일들 생성
              for(const file of dataFiles) {
                saveData(guildId, file, file === "market" ? [] : {});
              }

              await warningMsg.edit({
                content: "✅ 모든 데이터가 성공적으로 초기화되었습니다.\n" +
                         `📅 초기화 시각: ${new Date().toLocaleString("ko-KR")}\n` +
                         `👤 실행자: ${author.username}`,
                components: []
              });

              // 개발 로그 채널에 기록
              await devLogError(guild, author, "데이터 초기화 완료", "DATA_RESET");

            } catch(error) {
              console.error("데이터 삭제 중 오류:", error);
              await warningMsg.edit({
                content: "⚠️ 데이터 삭제 중 오류가 발생했습니다.",
                components: []
              });
              await devLogError(guild, author, error, "DATA_RESET_ERR");
            }
          }
        });

        collector.on("end", async (collected, reason) => {
          if(reason === "time") {
            await warningMsg.edit({
              content: "⏳ 시간이 초과되어 작업이 취소되었습니다.",
              components: []
            });
          }
        });

        return;
      }
      // === 출석 ===
        case "출석": {
          const userId = author.id;
          const now = new Date();
          const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // KST 변환
          const kstDate = kstNow.toISOString().split('T')[0]; // YYYY-MM-DD

          const last = attendance[userId]?.lastCheck;
          const lastKstDate = last ? new Date(new Date(last).getTime() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0] : null;

          if (last && lastKstDate === kstDate) {
            return message.reply("⏰ 이미 오늘 출석했습니다. 다음 출석은 자정(KST) 이후에 가능합니다!");
          }

          // 봇 자산에서 출석 보상 차감
          const rewardPoints = 3500;
          const botAssetData = loadData(guildId, "botAsset") || { points: 1000000 }; // 초기 자산 백만 포인트
          
          if (botAssetData.points < rewardPoints) {
            botAssetData.points = 1000000; // 봇 자산 부족 시 리필
          }
          
          botAssetData.points -= rewardPoints;
          saveData(guildId, "botAsset", botAssetData);

          // 출석 정보 저장
          attendance[userId] = { 
            username: author.username, 
            lastCheck: now.toISOString(),
            totalAttendance: (attendance[userId]?.totalAttendance || 0) + 1,
            lastKstDate: kstDate
          };
          saveData(guildId, "attendance", attendance);

          // 포인트 지급
          if (!pointsData[userId]) {
            pointsData[userId] = { username: author.username, points: 0 };
          }
          pointsData[userId].points += rewardPoints;
          saveData(guildId, "points", pointsData);

          const embed = new EmbedBuilder()
            .setTitle("✅ 출석 체크 완료!")
            .setColor(0x00ff00)
            .setDescription(`${author.username}님의 출석이 확인되었습니다.`)
            .addFields(
              { name: "💰 지급된 포인트", value: `${rewardPoints.toLocaleString()}pt`, inline: true },
              { name: "📊 현재 포인트", value: `${pointsData[userId].points.toLocaleString()}pt`, inline: true },
              { name: "🎯 총 출석 횟수", value: `${attendance[userId].totalAttendance}회`, inline: true }
            )
            .setFooter({ text: `다음 출석: ${kstDate} 24:00 이후` })
            .setTimestamp();

          return message.reply({ embeds: [embed] });
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
          if (!message.member.permissions.has("ManageMessages")) {
            return message.reply("⚠️ 메시지 관리 권한이 필요합니다.");
          }

          // 경고 + 버튼
          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder().setCustomId("storm_yes").setLabel("예").setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId("storm_no").setLabel("아니오").setStyle(ButtonStyle.Secondary)
            );

          const warningMsg = await message.reply({ 
            content: "⚠️ 주의! 이 채널의 최근 메시지들이 삭제됩니다. 계속 진행하시겠습니까?", 
            components: [row] 
          });

          // 버튼 클릭 이벤트 처리 (명령어 실행자만 허용)
          if (warningMsg.collector) warningMsg.collector.stop();
          const collector = warningMsg.createMessageComponentCollector({ 
            time: 15000, 
            max: 1, 
            filter: i => i.user.id === author.id 
          });

          collector.on("collect", async i => {
            if(i.customId === "storm_no") {
              await i.update({ content: "❌ 시공의 폭풍 명령어가 취소되었습니다.", components: [] });
              return;
            }
            if(i.customId === "storm_yes") {
              await i.update({ content: "🌀 시공의 폭풍이 시작됩니다...", components: [] });
              
              try {
                // 명령어 메시지 먼저 삭제
                await message.delete().catch(() => {});
                
                let totalDeleted = 0;
                let statusMessage = null;
                
                // 최대 1000개까지만 삭제 (무한루프 방지)
                for(let iteration = 0; iteration < 10 && totalDeleted < 1000; iteration++) {
                  const fetched = await message.channel.messages.fetch({ limit: 100 });
                  if(fetched.size === 0) break;
                  
                  // 상태 메시지 업데이트 또는 생성
                  const status = `🌀 삭제 진행 중... (${totalDeleted}개 완료)`;
                  if(statusMessage) {
                    await statusMessage.edit(status).catch(() => {});
                  } else {
                    statusMessage = await message.channel.send(status);
                  }
                  
                  // bulkDelete 실행
                  const deleted = await message.channel.bulkDelete(fetched, true).catch(() => null);
                  if(!deleted || deleted.size === 0) break;
                  
                  totalDeleted += deleted.size;
                  
                  // 잠시 대기하여 API 속도 제한 방지
                  await new Promise(resolve => setTimeout(resolve, 1500));
                }
                
                // 상태 메시지 삭제
                if(statusMessage) {
                  await statusMessage.delete().catch(() => {});
                }
                
                // 최종 결과 메시지
                await message.channel.send(
                  `💫 시공의 폭풍이 종료되었습니다.\n` +
                  `📊 총 ${totalDeleted}개의 메시지가 삭제되었습니다.\n` +
                  `👤 실행자: ${author.username}`
                );
                
              } catch(e) {
                await devLogError(guild, author, e, "STORM_ERR");
                await message.channel.send("⚠️ 시공의 폭풍 실행 중 오류가 발생했습니다.");
              }
            }
          });

          collector.on("end", async (collected, reason) => {
            if(reason === "time") {
              await warningMsg.edit({
                content: "⏳ 시간이 초과되어 명령이 취소되었습니다.",
                components: []
              }).catch(() => {});
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
              if (!pointsData[author.id]) pointsData[author.id] = { username: author.username, points: 0 };
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
              if (!pointsData[author.id]) pointsData[author.id] = { username: author.username, points: 0 };
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
              const listingFee = 100;
              if((pointsData[author.id]?.points||0) < listingFee) return message.reply("⚠️ 판매 수수료 100pt 필요");
              if (!pointsData[author.id]) pointsData[author.id] = { username: author.username, points: 0 };
              pointsData[author.id].points -= listingFee;
              manageBotTransaction(guildId, listingFee, 'income'); // 수수료 봇 자산으로 추가
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
              if (!pointsData[author.id]) pointsData[author.id] = { username: author.username, points: 0 };
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
        case "주식": {
          if (args.length < 1) {
            return message.reply("⚠️ 사용법: &주식 [시세/매수/매도/보유/생성] [종목명] [수량]");
          }

          const subCommand = args[0];
          const stockData = loadStockData();
          updateStockPrices(); // 가격 갱신 체크

          switch (subCommand) {
            case "시세": {
              const stockName = args[1];
              if (!stockName) {
                // 전체 종목 시세
                const embed = new EmbedBuilder()
                  .setTitle("📊 주식 시세 현황")
                  .setColor(0x0099ff)
                  .setDescription("현재 거래 가능한 모든 주식의 시세입니다.");

                Object.entries(stockData.stocks)
                  .filter(([_, stock]) => stock.available)
                  .forEach(([name, stock]) => {
                    const history = stock.history;
                    const lastPrice = history.length > 1 ? history[history.length - 2].price : stock.initialPrice;
                    const priceChange = stock.price - lastPrice;
                    const changeRate = (priceChange / lastPrice * 100).toFixed(2);
                    const emoji = getStockPriceChangeEmoji(priceChange);

                    embed.addFields({
                      name: `${emoji} ${name}`,
                      value: `${formatStockPrice(stock.price)} (${changeRate}%)`,
                      inline: true
                    });
                  });

                return message.reply({ embeds: [embed] });
              }

              // 특정 종목 상세 시세
              const stockEmbed = getStockStatusEmbed(stockData, stockName);
              if (!stockEmbed) {
                return message.reply("❌ 존재하지 않는 주식입니다.");
              }
              return message.reply({ embeds: [stockEmbed] });
            }

            case "매수": {
              const stockName = args[1];
              const raw = args[2];

              if (!stockName || !raw) {
                return message.reply("⚠️ 사용법: &주식 매수 [종목명] [수량/포인트]\n예시1) &주식 매수 삼성전자 1.5\n예시2) &주식 매수 삼성전자 1000p");
              }

              const stock = stockData.stocks[stockName];
              if (!stock || !stock.available) {
                return message.reply("❌ 거래할 수 없는 주식입니다.");
              }

              // 포인트 단위로 구매하는지, 수량 단위로 구매하는지 판별
              const pointsPattern = /(?:p|포인트)$/i;
              let amount = 0;
              let totalCost = 0;
              let boughtByPoints = false;

              if (pointsPattern.test(raw)) {
                // 예: 1500p 또는 1500포인트
                const points = parseFloat(raw.replace(/[^0-9.]/g, ""));
                if (isNaN(points) || points <= 0) {
                  return message.reply("⚠️ 올바른 포인트 값을 입력해주세요. 예: 1000p");
                }
                boughtByPoints = true;
                totalCost = points;
                amount = totalCost / stock.price;
              } else {
                // 수량으로 입력 (소수 허용)
                amount = parseFloat(raw);
                if (isNaN(amount) || amount <= 0) {
                  return message.reply("⚠️ 올바른 수량을 입력해주세요. 예: 1.5");
                }
                totalCost = stock.price * amount;
              }

              // 최소 구매 금액 체크
              if (totalCost < 1) {
                return message.reply("⚠️ 최소 1포인트 이상 구매해야 합니다.");
              }

              // 사용자 데이터 보장 (검사 이전에 보장)
              if (!pointsData[author.id]) pointsData[author.id] = { username: author.username, points: 0 };
              if (!stockData.userStocks[author.id]) stockData.userStocks[author.id] = {};

              const userPoints = Number(pointsData[author.id].points || 0) || 0;
              if (userPoints < totalCost) {
                return message.reply("⚠️ 포인트가 부족합니다.");
              }
              if (!stockData.userStocks[author.id]) stockData.userStocks[author.id] = {};
              if (!stockData.userStocks[author.id][stockName]) stockData.userStocks[author.id][stockName] = 0;

              // 소수점 처리: 최대 8자리까지만 보관
              amount = Number(amount.toFixed(8));
              // 포인트 차감은 사용자가 지정한 총액을 그대로 사용(포인트 구매의 경우)
              totalCost = boughtByPoints ? Number(totalCost.toFixed(2)) : Number((stock.price * amount).toFixed(2));

              // 구매 반영
              stockData.userStocks[author.id][stockName] += amount;
              pointsData[author.id].points -= totalCost;

              saveStockData(stockData);
              saveData(guildId, "points", pointsData);

              const embed = new EmbedBuilder()
                .setTitle("✅ 주식 매수 완료")
                .setColor(0x00ff00)
                .addFields(
                  { name: "종목", value: stockName, inline: true },
                  { name: "수량", value: `${formatShares(amount)}주`, inline: true },
                  { name: "총 비용", value: formatStockPrice(totalCost), inline: true },
                  { name: "주당 가격", value: formatStockPrice(stock.price), inline: true },
                  { name: "남은 포인트", value: formatStockPrice(pointsData[author.id].points), inline: true }
                );

              return message.reply({ embeds: [embed] });
            }

            case "매도": {
              const stockName = args[1];
              const amount = parseFloat(args[2]);

              if (!stockName || isNaN(amount) || amount <= 0) {
                return message.reply("⚠️ 사용법: &주식 매도 [종목명] [수량] (소수점 거래 가능)");
              }

              const stock = stockData.stocks[stockName];
              if (!stock || !stock.available) {
                return message.reply("❌ 거래할 수 없는 주식입니다.");
              }

              if (!stockData.userStocks[author.id]?.[stockName] || 
                  stockData.userStocks[author.id][stockName] < amount) {
                return message.reply("❌ 보유한 주식이 부족합니다.");
              }

              // 판매 처리
              const totalProfit = stock.price * amount;
              stockData.userStocks[author.id][stockName] -= amount;
              
              if (stockData.userStocks[author.id][stockName] === 0) {
                delete stockData.userStocks[author.id][stockName];
              }
              
              if (!pointsData[author.id]) {
                pointsData[author.id] = { username: author.username, points: 0 };
              }
              pointsData[author.id].points += totalProfit;

              saveStockData(stockData);
              saveData(guildId, "points", pointsData);

              const embed = new EmbedBuilder()
                .setTitle("✅ 주식 매도 완료")
                .setColor(0x00ff00)
                .addFields(
                  { name: "종목", value: stockName, inline: true },
                    { name: "수량", value: formatShares(amount) + "주", inline: true },
                  { name: "총 수익", value: formatStockPrice(totalProfit), inline: true },
                  { name: "주당 가격", value: formatStockPrice(stock.price), inline: true },
                  { name: "현재 포인트", value: formatStockPrice(pointsData[author.id].points), inline: true }
                );

              return message.reply({ embeds: [embed] });
            }

            case "보유": {
              if (!stockData.userStocks[author.id] || Object.keys(stockData.userStocks[author.id]).length === 0) {
                return message.reply("📈 보유중인 주식이 없습니다.");
              }

              let totalValue = 0;
              const embed = new EmbedBuilder()
                .setTitle(`🏦 ${author.username}님의 주식 보유 현황`)
                .setColor(0x0099ff);

              Object.entries(stockData.userStocks[author.id]).forEach(([stockName, amount]) => {
                const stock = stockData.stocks[stockName];
                if (stock && amount > 0) {
                  const value = stock.price * amount;
                  totalValue += value;
                  embed.addFields({
                    name: stockName,
                    value: `${formatShares(amount)}주\n` +
                          `현재가: ${formatStockPrice(stock.price)}\n` +
                          `평가액: ${formatStockPrice(value)}`,
                    inline: true
                  });
                }
              });

              embed.addFields({
                name: "총 평가액",
                value: formatStockPrice(totalValue),
                inline: false
              });

              return message.reply({ embeds: [embed] });
            }

            case "생성": {
              const stockName = args[1];
              const initialPrice = parseInt(args[2]);

              if (!stockName || isNaN(initialPrice) || initialPrice < MIN_STOCK_PRICE) {
                return message.reply(`⚠️ 사용법: &주식 생성 [종목명] [초기가격(최소 ${MIN_STOCK_PRICE}pt)]`);
              }

              if (stockData.stocks[stockName]) {
                return message.reply("❌ 이미 존재하는 주식입니다.");
              }

              if ((pointsData[author.id]?.points || 0) < MIN_CREATE_STOCK_POINTS) {
                return message.reply(`⚠️ 주식 생성을 위해서는 최소 ${formatStockPrice(MIN_CREATE_STOCK_POINTS)}가 필요합니다.`);
              }

              // 주식 생성
              stockData.stocks[stockName] = {
                price: initialPrice,
                initialPrice: initialPrice,
                totalShares: 1000000,
                available: true,
                owner: author.id,
                lastUpdate: Date.now(),
                history: []
              };

              // 생성 비용 차감
              if (!pointsData[author.id]) pointsData[author.id] = { username: author.username, points: 0 };
              pointsData[author.id].points -= MIN_CREATE_STOCK_POINTS;

              saveStockData(stockData);
              saveData(guildId, "points", pointsData);

              const embed = new EmbedBuilder()
                .setTitle("✅ 새로운 주식 상장")
                .setColor(0x00ff00)
                .addFields(
                  { name: "종목명", value: stockName, inline: true },
                  { name: "초기 가격", value: formatStockPrice(initialPrice), inline: true },
                  { name: "총 발행주식", value: "1,000,000주", inline: true },
                  { name: "소유자", value: author.username, inline: true },
                  { name: "생성 비용", value: formatStockPrice(MIN_CREATE_STOCK_POINTS), inline: true }
                );

              return message.reply({ embeds: [embed] });
            }

            default:
              return message.reply("⚠️ 올바른 주식 명령어를 입력해주세요. (시세/매수/매도/보유/생성)");
          }
        }

        case "봇자산": {
          const asset = getBotAsset(guildId);
              const embed = new EmbedBuilder()
            .setTitle("💰 길냥이봇 자산 현황")
            .setColor(0xffd700)
            .addFields(
              { name: "보유 자산", value: `${(Number(asset.botBalance)||0).toLocaleString("ko-KR")}pt`, inline: true },
              { name: "시장 가치", value: `${(Number(asset.marketValue)||0).toLocaleString("ko-KR")}pt`, inline: true },
              { name: "총 자산", value: `${(Number(asset.total)||0).toLocaleString("ko-KR")}pt`, inline: true },
              { name: "유통 포인트", value: `${(Number(asset.circulatingPoints)||0).toLocaleString("ko-KR")}pt`, inline: true },
              { name: "거래 수수료 수입", value: `${(Number(asset.tradeFees)||0).toLocaleString("ko-KR")}pt`, inline: true }
            )
            .setFooter({ text: "포인트 발행량과 시장 가치의 합계" })
            .setTimestamp();
          return message.reply({ embeds: [embed] });
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
        case "도움말":
        case "명령어":
        case "냥이설명서": {
          const page = args[0]?.toLowerCase();
          const pages = {
            general: new EmbedBuilder()
              .setTitle("📘 길냥이봇 기본 도움말")
              .setColor(0x00cc99)
              .setDescription("자주 사용하는 기본적인 명령어들입니다.")
              .addFields(
                {
                  name: "💬 대화",
                  value: [
                    "`&안녕` — 인사하기",
                    "`&반모` — 반말 모드로 전환",
                    "`&반종` — 존댓말 모드로 전환"
                  ].join("\n"),
                  inline: false
                },
                {
                  name: "ℹ️ 정보",
                  value: [
                    "`&길냥이봇정보` — 봇의 정보 및 버전 확인",
                    "`&시간` — 현재 시간 확인",
                    "`&도움말 [페이지]` — 도움말 확인"
                  ].join("\n"),
                  inline: false
                },
                {
                  name: "📋 도움말 페이지",
                  value: [
                    "`&도움말 포인트` — 포인트 시스템",
                    "`&도움말 아이템` — 아이템 시스템",
                    "`&도움말 관리` — 서버 관리",
                    "`&도움말 채널` — 채널 설정",
                    "`&도움말 감시` — 서버 감시(감시활성화/감시현황)",
                    "`&도움말 개발자` — 개발자 전용"
                  ].join("\n"),
                  inline: false
                }
              ),

            포인트: new EmbedBuilder()
              .setTitle("🎁 포인트 시스템 도움말")
              .setColor(0xffcc00)
              .setDescription("포인트를 모으고 사용하는 방법을 안내합니다.")
              .addFields(
                {
                  name: "💰 포인트 시스템",
                  value: [
                    "`&출석` — 매일 자정(KST) 이후 3500pt 획득",
                    "`&포인트` — 내 포인트 확인",
                    "`&포인트랭킹` — 상위 10명 랭킹 확인",
                    "`&봇자산` — 길냥이봇의 자산 현황 확인",
                    "💡 출석 보상은 매일 자정(KST)에 초기화됩니다"
                  ].join("\n"),
                  inline: false
                }
              ),

            아이템: new EmbedBuilder()
              .setTitle("⚔️ 아이템 시스템 도움말")
              .setColor(0xff9900)
              .setDescription("아이템 제작과 거래에 관한 명령어들입니다.")
              .addFields(
                {
                  name: "🛠️ 아이템 관리",
                  value: [
                    "`&아이템 제작 <이름>` — 새 아이템 제작 (250pt)",
                    "`&아이템 강화 <이름>` — 아이템 강화",
                    "`&아이템 등급 <이름>` — 아이템 등급 확인",
                    "`&아이템 목록` — 보유 아이템 확인"
                  ].join("\n"),
                  inline: false
                },
                {
                  name: "🏪 거래",
                  value: [
                    "`&아이템 판매 <이름> <가격>` — 시장에 등록",
                    "`&아이템 구입 <이름>` — 시장에서 구매",
                    "`&아이템 시장` — 시장 목록 확인"
                  ].join("\n"),
                  inline: false
                }
              ),

            관리: new EmbedBuilder()
              .setTitle("🔧 서버 관리 도움말")
              .setColor(0x3366ff)
              .setDescription("서버 관리에 필요한 명령어들입니다. (관리자 전용)")
              .addFields(
                {
                  name: "👥 멤버 관리",
                  value: [
                    "`&기본역할 <@역할>` — 자기소개 완료 시 자동 부여할 역할 설정",
                    "`&공지 <내용>` — 공지사항 전송"
                  ].join("\n"),
                  inline: false
                },
                {
                  name: "🧹 채팅 관리",
                  value: [
                    "`&맨인블랙 <숫자>` — 최근 메시지 삭제 (1~100개)",
                    "`&시공의폭풍` — 채널 메시지 대량 삭제 (확인 필요)"
                    ,"`&감시활성화 [사유]` — 서버 감시 시작 (관리자 전용, 확인 버튼)",
                    "`&감시비활성화 [사유]` — 서버 감시 종료 (사유에 '초기화' 포함 시 데이터 삭제)",
                    "`&감시현황` — 수집된 통계 확인 (관리자 전용)",
                    "`&서버정보` — 서버 기본 정보 확인"
                  ].join("\n"),
                  inline: false
                }
              ),

            감시: new EmbedBuilder()
              .setTitle("🔍 서버 감시 도움말")
              .setColor(0x8855ff)
              .setDescription("서버의 채팅/스티커/이미지/링크 등을 수집하여 통계를 제공합니다. (관리자 전용)")
              .addFields(
                {
                  name: "기본 명령어",
                  value: [
                    "`&감시활성화 [사유]` — 감시 시작 (확인 버튼)",
                    "`&감시비활성화 [사유]` — 감시 종료 (사유에 '초기화' 포함 시 데이터 삭제)",
                    "`&감시현황` — 수집된 통계 요약 확인",
                    "`&서버정보` — 서버의 채널/역할/관리자/소유자 정보 확인"
                  ].join("\n"),
                  inline: false
                }
              ),

            채널: new EmbedBuilder()
              .setTitle("📋 채널 설정 도움말")
              .setColor(0x33cc33)
              .setDescription("서버의 채널 설정을 관리합니다. (관리자 전용)")
              .addFields(
                {
                  name: "⚙️ 채널 설정",
                  value: [
                    "`&채널설정` — 채널 설정 도움말",
                    "`&채널설정 지정 <분류> <#채널>` — 채널 지정",
                    "`&채널설정 해제 <분류>` — 채널 설정 해제",
                    "`&채널설정 목록` — 설정된 채널 목록",
                    "`&채널설정 초기화` — 모든 채널 설정 초기화",
                    "`&채널생성 <카테고리명> <채널명>` — 새 채널 생성"
                  ].join("\n"),
                  inline: false
                }
              ),

            개발자: new EmbedBuilder()
              .setTitle("⚡ 개발자 전용 도움말")
              .setColor(0xff3366)
              .setDescription("개발자만 사용할 수 있는 명령어들입니다.")
              .addFields(
                {
                  name: "� 개발자 명령어",
                  value: [
                    "`&devpoint 지급 <유저ID>` — 포인트 지급",
                    "`&devpoint 복원 <유저ID>` — 포인트 복원",
                    "`&데이터삭제` — 서버 데이터 초기화"
                  ].join("\n"),
                  inline: false
                }
              )
          };

          const embed = pages[page] || pages.general;
          embed
            .setFooter({ 
              text: `🐾 길냥이봇 v${botVersion} — 페이지 ${page || 'general'}`, 
              iconURL: client.user.displayAvatarURL() 
            })
            .setTimestamp();

          // 이전/다음 페이지 버튼
          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId("help_prev")
                .setLabel("◀️ 이전")
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId("help_next")
                .setLabel("다음 ▶️")
                .setStyle(ButtonStyle.Secondary)
            );

          const reply = await message.reply({ 
            embeds: [embed],
            components: [row]
          });

          // 버튼 클릭 이벤트 처리
          const collector = reply.createMessageComponentCollector({
            time: 60000,
            filter: i => i.user.id === author.id
          });

          const pageOrder = ["general", "포인트", "아이템", "관리", "채널", "개발자"];
          let currentPageIndex = page ? pageOrder.indexOf(page) : 0;
          if (currentPageIndex === -1) currentPageIndex = 0;

          collector.on("collect", async i => {
            if (i.customId === "help_prev") {
              currentPageIndex = (currentPageIndex - 1 + pageOrder.length) % pageOrder.length;
            } else if (i.customId === "help_next") {
              currentPageIndex = (currentPageIndex + 1) % pageOrder.length;
            }

            const newPage = pageOrder[currentPageIndex];
            const newEmbed = pages[newPage];
            newEmbed
              .setFooter({ 
                text: `🐾 길냥이봇 v${botVersion} — 페이지 ${newPage}`, 
                iconURL: client.user.displayAvatarURL() 
              })
              .setTimestamp();

            await i.update({ embeds: [newEmbed], components: [row] });
          });

          collector.on("end", () => {
            reply.edit({ components: [] }).catch(() => {});
          });

          return;

        return message.reply({ embeds: [embed] });
        break;

      }
      default:
        return message.reply("❓ 존재하지 않는 명령어입니다.");
    } 
    }catch (err) {
    console.error(err);
    await devLogError(message.guild, message.author, err, "v3.2-040");
  }
});
// 아이템 등급 결정 함수
function getRandomGrade() {
  const rand = Math.random() * 100;
  if (rand < 50) return "일반";         // 50%
  else if (rand < 80) return "고급";    // 30%
  else if (rand < 95) return "희귀";    // 15%
  else if (rand < 99) return "영웅";    // 4%
  else return "전설";                   // 1%
}

// 강화 성공 확률 계산 함수
function getUpgradeSuccessRate(plus) {
  // 플러스 수가 높을수록 확률이 낮아짐
  // 예시: +0 → 90%, +1 → 80%, +2 → 70%, ..., +9 → 0%
  const baseRate = 90 - plus * 10;
  return Math.max(baseRate, 5); // 최소 5% 유지
}

// 강화 실패 시 파괴 확률 계산 함수
function getDestroyChance(plus) {
  // 플러스 수가 높을수록 파괴 확률 증가
  // 예시: +0 → 0%, +1 → 5%, +2 → 10%, ..., +9 → 80%
  const destroyRate = plus * 10;
  return Math.min(destroyRate, 80);
}

// 봇 자산(포인트 합계 등) 계산 함수
function getBotAsset(guildId) {
  const points = loadData(guildId, "points") || {};
  const marketRaw = loadData(guildId, "market");
  const market = Array.isArray(marketRaw) ? marketRaw : [];
  const botAssetRaw = loadData(guildId, "botAsset") || {};

  // 봇 자산, 기본값 보장
  const botBalance = Number(botAssetRaw.points ?? 1000000) || 0;

  let circulatingPoints = 0;
  for (const id in points) {
    if (id !== BOT_ASSET_KEY) {
      circulatingPoints += Number(points[id]?.points || 0) || 0;
    }
  }

  let marketValue = 0;
  for (const item of market) {
    marketValue += Number(item?.price || 0) || 0;
  }

  // 거래 수수료 등으로 얻은 수익
  const tradeFeesRaw = loadData(guildId, "tradeFees") || {};
  const tradeFeesTotal = Number(tradeFeesRaw.total ?? 0) || 0;

  return {
    botBalance,
    circulatingPoints,
    marketValue,
    tradeFees: tradeFeesTotal,
    total: (Number(botBalance) || 0) + (Number(marketValue) || 0)
  };
}

function manageBotTransaction(guildId, amount, type = 'expense') {
  const botAsset = loadData(guildId, "botAsset") || { points: 1000000 };
  const tradeFees = loadData(guildId, "tradeFees") || { total: 0 };

  if (type === 'income') {
    botAsset.points += amount;
    tradeFees.total += amount;
  } else {
    if (botAsset.points < amount) {
      botAsset.points = 1000000; // 자산 부족 시 리필
    }
    botAsset.points -= amount;
  }

  saveData(guildId, "botAsset", botAsset);
  saveData(guildId, "tradeFees", tradeFees);
  return botAsset.points;
}
// === 유저 입장 / 자기소개 미작성 강퇴 ===
client.on("guildMemberAdd", async member => {
  const guildId = member.guild.id;
  ensureServerData(guildId);
  const joinQueue = loadData(guildId, "joinQueue");
  joinQueue[member.id] = { joinTime: new Date().toISOString(), introDone: false };
  saveData(guildId, "joinQueue", joinQueue);

  const config = loadData(guildId, "config");
  const welcomeChannelId = config.channels?.["입장"] || WELCOME_CHANNEL_ID;
  if (welcomeChannelId) {
    const ch = await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
    if (ch && ch.isTextBased())
      ch.send(`🎉 ${member.user.tag}님 입장! 자기소개 채널에서 자기소개를 작성해주세요.`);
  }
});

// 자기소개 미작성자 확인 및 강퇴 (10분마다 실행)
setInterval(async () => {
  for (const guild of client.guilds.cache.values()) {
    const guildId = guild.id;
    ensureServerData(guildId);
      const config = loadData(guildId, "config");
      const joinQueueRaw = loadData(guildId, "joinQueue");
      const joinQueue = (joinQueueRaw && typeof joinQueueRaw === 'object') ? joinQueueRaw : {};
    let updated = false;
    const now = new Date();

    // 로그 채널 확인
    const logChannelId = config.channels?.["로그"];
    const logChannel = logChannelId ? await guild.channels.fetch(logChannelId).catch(() => null) : null;

    for (const [uid, info] of Object.entries(joinQueue)) {
      if (!info.introDone) {
        const joinTime = new Date(info.joinTime);
        const timeLeft = 24 * 60 * 60 * 1000 - (now - joinTime); // 남은 시간 (ms)

        if (timeLeft <= 0) {
          // 강퇴 처리
          const member = await guild.members.fetch(uid).catch(() => null);
          if (member) {
            try {
              await member.kick("자기소개 미작성 (24시간 초과)");
              
              // 로그 기록
              if (logChannel?.isTextBased()) {
                const embed = new EmbedBuilder()
                  .setTitle("🚫 자기소개 미작성으로 강퇴")
                  .setColor(0xff0000)
                  .addFields(
                    { name: "멤버", value: member.user.tag, inline: true },
                    { name: "ID", value: uid, inline: true },
                    { name: "입장 시각", value: new Date(joinTime).toLocaleString("ko-KR"), inline: true }
                  )
                  .setTimestamp();
                logChannel.send({ embeds: [embed] }).catch(() => {});
              }
            } catch (error) {
              console.error(`강퇴 실패 (${uid}):`, error);
              if (logChannel?.isTextBased()) {
                logChannel.send(`⚠️ ${member.user.tag} (${uid}) 강퇴 실패: ${error.message}`).catch(() => {});
              }
              continue; // 강퇴 실패시 큐에서 제거하지 않음
            }
          }
          delete joinQueue[uid];
          updated = true;
        } else if (timeLeft <= 60 * 60 * 1000) { // 1시간 이하 남음
          // 경고 DM 발송
          const member = await guild.members.fetch(uid).catch(() => null);
          if (member) {
            const introChannelId = config.channels?.["자기소개"] || INTRO_CHANNEL_ID;
            const timeLeftMinutes = Math.ceil(timeLeft / (60 * 1000));
            
            member.send(
              `⚠️ **자기소개 작성 필요**\n` +
              `서버: ${guild.name}\n\n` +
              `자기소개를 작성하지 않으면 ${timeLeftMinutes}분 후 자동으로 강퇴됩니다.\n` +
              `자기소개 채널: <#${introChannelId}>\n\n` +
              `※ 자기소개는 10자 이상의 한글을 포함해야 합니다.`
            ).catch(() => {}); // DM 실패는 무시
          }
        }
      } else if (info.introDone) {
        // 자기소개 완료된 항목은 일주일 후 큐에서 제거
        const joinTime = new Date(info.joinTime);
        if (now - joinTime > 7 * 24 * 60 * 60 * 1000) {
          delete joinQueue[uid];
          updated = true;
        }
      }
    }
    
    if (updated) saveData(guildId, "joinQueue", joinQueue);
  }
}, 10 * 60 * 1000); // 10분마다 실행


// === 로그인 ===
client.login(TOKEN);