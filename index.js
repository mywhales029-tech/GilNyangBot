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

banmalMode, banmalReplies, lastBanmal, jondaetReplies, lastJondaet
botVersion, DEV_IDS
pointsData, attendance, itemsData, marketData
getRandomGrade(), getDestroyChance(), getUpgradeSuccessRate()

// === 기본 유틸 ===
function validateIntro(content) {
  return content.length >= 10 && /[가-힣]/.test(content);
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
      const joinQueue = loadData(guildId, "joinQueue");
      const defaultRoleData = loadData(guildId, "defaultRole");

      if (joinQueue[author.id]) {
        if (validateIntro(content)) {
          joinQueue[author.id].introDone = true;
          saveData(guildId, "joinQueue", joinQueue);

          if (defaultRoleData?.id) {
            const role = guild.roles.cache.get(defaultRoleData.id);
            const member = await guild.members.fetch(author.id).catch(() => null);
            if (role && member) member.roles.add(role).catch(() => {});
          }
          return message.reply("✅ 자기소개 확인 완료! 기본 역할이 지급되었습니다.");
        } else {
          return message.reply("⚠️ 자기소개 양식이 올바르지 않습니다. 기본 역할이 지급되지 않았습니다.");
        }
      }
      return;
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
        case "출석":{
          const userId=author.id;
          const now=new Date();
          const last=attendance[userId]?.lastCheck?new Date(attendance[userId].lastCheck):null;
          if(last && now-last<24*60*60*1000) return message.reply("⏰ 이미 오늘 출석했습니다. 24시간 후 다시 출석 가능!");
          attendance[userId]={ username:author.username, lastCheck: now.toISOString() };
          saveData(guildId,"attendance",attendance);
          pointsData[userId]={ username:author.username, points:(pointsData[userId]?.points||0)+2000 };
          saveData(guildId,"points",pointsData);
          return message.reply("✅ 출석 완료! 3500 포인트 획득");
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
        case "봇자산": {
          const asset = getBotAsset(guildId);
          return message.reply(`💰 길냥이봇 재산: ${asset.total.toLocaleString()}pt`);
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
        case "냥이설명서":{
          const embed = new EmbedBuilder()
          .setTitle("📘 길냥이봇 설명서")
          .setColor(0x00cc99)
          .setDescription("길냥이봇의 주요 기능과 명령어들을 안내드립니다!")
          .addFields(
            {
              name: "💬 기본 명령어",
              value: [
                "`&안녕` — 인사하기",
                "`&시간` — 현재 시간 확인",
                "`&반모` / `&반종` — 반말 / 존댓말 모드 전환",
                "`&길냥이봇정보` — 봇의 정보 및 버전 확인",
                "`&냥이설명서` — 이 도움말 보기"
              ].join("\n"),
              inline: false
            },
            {
              name: "🎁 출석 및 포인트",
              value: [
                "`&출석` — 하루 1회 출석 시 2000pt 획득",
                "`&포인트` — 내 포인트 확인",
                "`&포인트랭킹` — 상위 10명 랭킹 확인"
              ].join("\n"),
              inline: false
            },
            {
              name: "⚙️ 아이템 시스템",
              value: [
                "`&아이템 제작 <이름>` — 새 아이템 제작 (250pt 소모)",
                "`&아이템 강화 <이름>` — 아이템 강화 (확률형)",
                "`&아이템 등급 <이름>` — 아이템 등급 조회",
                "`&아이템 판매 <이름> <가격>` — 시장에 등록",
                "`&아이템 구입 <이름>` — 시장 아이템 구매",
                "`&아이템 시장` — 현재 시장 목록 보기",
                "`&아이템 목록` — 내 아이템 목록 보기"
              ].join("\n"),
              inline: false
            },
            {
              name: "🏦 시스템 및 관리",
              value: [
                "`&봇자산` — 길냥이봇의 전체 재산 확인",
                "`&채널생성 <카테고리명> <채널명>` — 새 채널 생성",
                "`&기본역할 <@역할>` — 자기소개 완료 시 자동 부여 역할 설정",
                "`&공지 <내용>` — 공지 채널로 메시지 전송 (관리자용)",
                "`&맨인블랙 <숫자>` — 최근 메시지 삭제 (1~100개)",
                "`&시공의폭풍` — 채널 전체 메시지 삭제 (확인 버튼 포함)"
              ].join("\n"),
              inline: false
            },
            {
              name: "🔧 개발자 전용",
              value: [
                "`&devpoint 지급 <유저ID>` — 포인트 지급",
                "`&devpoint 복원 <유저ID>` — 포인트 복원"
              ].join("\n"),
              inline: false
            }
          )
          .setFooter({ text: "🐾 길냥이봇 — by NobleNetick2", iconURL: client.user.displayAvatarURL() })
          .setTimestamp();

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
  const points = loadData(guildId, "points");
  const market = loadData(guildId, "market");

  let totalPoints = 0;
  for (const id in points) totalPoints += points[id] || 0;

  let marketValue = 0;
  for (const item of market) marketValue += item.price || 0;

  return {
    totalPoints,
    marketValue,
    total: totalPoints + marketValue
  };
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

setInterval(async () => {
  for (const guild of client.guilds.cache.values()) {
    const guildId = guild.id;
    ensureServerData(guildId);
    const joinQueue = loadData(guildId, "joinQueue");
    let updated = false;
    const now = new Date();
    for (const [uid, info] of Object.entries(joinQueue)) {
      if (!info.introDone) {
        const joinTime = new Date(info.joinTime);
        if (now - joinTime > 24 * 60 * 60 * 1000) {
          const m = await guild.members.fetch(uid).catch(() => null);
          if (m) await m.kick("자기소개 미작성").catch(() => { });
          delete joinQueue[uid];
          updated = true;
        }
      }
    }
    if (updated) saveData(guildId, "joinQueue", joinQueue);
  }
}, 10 * 60 * 1000);


// === 로그인 ===
client.login(TOKEN);