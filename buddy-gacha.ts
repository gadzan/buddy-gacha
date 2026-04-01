#!/usr/bin/env bun
// buddy-gacha.ts

import { randomBytes, createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parseArgs } from "util";

// ============ Buddy 生成逻辑（复制自 companion.ts） ============
const SALT = "friend-2026-401";
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
const RARITY_WEIGHTS = [50, 30, 15, 4, 1];
const SPECIES = [
  "duck",
  "goose",
  "blob",
  "cat",
  "dragon",
  "octopus",
  "owl",
  "penguin",
  "turtle",
  "snail",
  "ghost",
  "axolotl",
  "capybara",
  "cactus",
  "robot",
  "rabbit",
  "mushroom",
  "chonk",
] as const;
const EYES = ["·", "✦", "×", "◉", "@", "°"] as const;

type Rarity = (typeof RARITIES)[number];

// 稀有度对应的数字等级
const RARITY_LEVEL: Record<Rarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

// 反向映射：数字到稀有度
const LEVEL_TO_RARITY: Record<number, Rarity> = {
  1: "common",
  2: "uncommon",
  3: "rare",
  4: "epic",
  5: "legendary",
};

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  const hash = createHash("md5").update(s).digest();
  return hash.readUInt32LE(0);
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function rollRarity(rng: () => number): Rarity {
  const roll = rng() * 100;
  let cumulative = 0;
  for (let i = 0; i < RARITIES.length; i++) {
    cumulative += RARITY_WEIGHTS[i];
    if (roll < cumulative) return RARITIES[i];
  }
  return "common";
}

export type BuddyRoll = {
  userID: string;
  rarity: Rarity;
  species: string;
  eye: string;
  shiny: boolean;
};

function simulateRoll(userID: string): BuddyRoll {
  const key = userID + SALT;
  const rng = mulberry32(hashString(key));
  const rarity = rollRarity(rng);
  const species = pick(rng, SPECIES);
  const eye = pick(rng, EYES);
  const shiny = rng() < 0.01;

  return { userID, rarity, species, eye, shiny };
}

// ============ 显示工具 ============
const RARITY_EMOJI = {
  common: "⚪",
  uncommon: "🟢",
  rare: "🔵",
  epic: "🟣",
  legendary: "🟡",
};

export function compareBuddyRolls(a: BuddyRoll, b: BuddyRoll): number {
  const rarityDiff = RARITY_LEVEL[b.rarity] - RARITY_LEVEL[a.rarity];
  if (rarityDiff !== 0) return rarityDiff;
  if (a.shiny === b.shiny) return 0;
  return a.shiny ? -1 : 1;
}

function formatBuddy(roll: BuddyRoll, index?: number): string {
  const emoji = RARITY_EMOJI[roll.rarity];
  const shinyMark = roll.shiny ? "✨" : "  ";
  const prefix = index ? `${index}. ` : "";
  return `${prefix}${emoji} ${shinyMark} ${roll.rarity.toUpperCase().padEnd(10)} | ${roll.species.padEnd(10)} | ${roll.eye} 眼睛`;
}

// ============ 配置文件操作 ============
function getConfigPath(): string {
  return join(homedir(), ".claude.json");
}

function readConfig() {
  const configPath = getConfigPath();
  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ 无法读取配置文件:", configPath);
    console.error("   请确保 Claude Code 已安装并至少启动过一次");
    process.exit(1);
  }
}

function hasOAuthAccount(config: any): boolean {
  return Boolean(config.oauthAccount?.accountUuid);
}

export function shouldProceedWithOAuthWrite(
  isOAuthUser: boolean,
  hasExplicitConfirmation: boolean,
): boolean {
  return !isOAuthUser || hasExplicitConfirmation;
}

function checkOAuthWarning(): boolean {
  const config = readConfig();
  if (hasOAuthAccount(config)) {
    console.log("\n⚠️  警告：你当前使用 OAuth 登录");
    console.log("   Buddy 由 accountUuid 决定，修改 userID 不会生效");
    console.log(
      "   要重置 Buddy，请先退出登录 (/logout) 后使用 API KEY 模式\n",
    );
    return true;
  }
  return false;
}

function writeConfig(userID: string, hasExplicitOAuthConfirmation = false) {
  const configPath = getConfigPath();
  const config = readConfig();

  const performWrite = () => {
    // 清理所有 Buddy 相关状态
    const updated = {
      ...config,
      userID,
      companion: undefined, // 清空灵魂数据
      companionMuted: undefined, // 重置静音状态
    };

    writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf-8");
    console.log("\n✅ 配置已更新！");
    console.log(`📝 配置文件: ${configPath}`);
    console.log(`🆔 新 userID: ${userID}`);
    console.log("\n⚠️  重要：必须完全重启 Claude Code 才能生效");
    console.log("   原因：内存中有缓存 (rollCache)，只有进程重启才能清空");
    console.log("\n🔄 请退出当前会话并重新启动 Claude Code\n");
  };

  if (
    shouldProceedWithOAuthWrite(
      hasOAuthAccount(config),
      hasExplicitOAuthConfirmation,
    )
  ) {
    performWrite();
    return;
  }

  // OAuth 警告交互
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("是否仍要继续写入？(y/N) ", (answer: string) => {
    rl.close();
    if (answer.toLowerCase() !== "y") {
      console.log("已取消");
      process.exit(0);
    }
    performWrite();
  });
}

// ============ 批量展示并选择 ============
async function selectFromMatches(matches: BuddyRoll[]): Promise<boolean> {
  // 按稀有度和闪光排序
  const sorted = [...matches].sort(compareBuddyRolls);

  // 只展示前 10 个
  const top10 = sorted.slice(0, 10);
  console.log(`\n找到 ${matches.length} 个符合条件的 Buddy，展示前 10 个：`);
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  top10.forEach((roll, i) => console.log(formatBuddy(roll, i + 1)));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `选择一个 (1-${top10.length})，或输入 0 取消全部: `,
      (answer: string) => {
        rl.close();

        const choice = parseInt(answer, 10);

        if (choice === 0 || isNaN(choice) || choice < 0 || choice > top10.length) {
          console.log("已取消，配置未修改");
          resolve(false);
          return;
        }

        // 从排序后的列表中取，用户看到的第 N 个就是 top10[N-1]
        const selected = top10[choice - 1];
        console.log(`\n你选择了: ${formatBuddy(selected, choice)}`);
        writeConfig(selected.userID);
        resolve(true);
      },
    );
  });
}

// ============ 自动刷稀有度模式 ============
async function autoRollMode(
  targetLevel: number,
  options: {
    shiny?: boolean;
    species?: string;
    maxAttempts?: number;
  },
) {
  const targetRarity = LEVEL_TO_RARITY[targetLevel];
  if (!targetRarity) {
    console.error(`❌ 无效的稀有度等级: ${targetLevel}`);
    console.error(
      "   可用等级: 1=common, 2=uncommon, 3=rare, 4=epic, 5=legendary",
    );
    process.exit(1);
  }

  console.log(`🎰 自动抽卡模式`);
  console.log(
    `🎯 目标: ${RARITY_EMOJI[targetRarity]} ${targetRarity.toUpperCase()}`,
  );
  if (options.shiny) console.log(`✨ 额外要求: 必须是闪光`);
  if (options.species)
    console.log(`🐾 额外要求: 种族必须是 ${options.species}`);
  console.log(
    `📊 理论概率: ${RARITY_WEIGHTS[RARITIES.indexOf(targetRarity)]}%${options.shiny ? " × 1% (闪光)" : ""}`,
  );

  const maxAttempts = options.maxAttempts || 10000;
  console.log(`🔄 最大尝试次数: ${maxAttempts.toLocaleString()}\n`);

  checkOAuthWarning();

  console.log("开始抽卡...\n");

  let attempts = 0;
  let lastReportTime = Date.now();
  const startTime = Date.now();
  const matches: { roll: BuddyRoll; attempts: number }[] = [];

  // 统计各稀有度出现次数
  const stats: Record<Rarity, number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
  };

  while (attempts < maxAttempts) {
    attempts++;
    const userID = randomBytes(32).toString("hex");
    const roll = simulateRoll(userID);

    stats[roll.rarity]++;

    // 每1000次报告一次进度
    if (attempts % 1000 === 0 || Date.now() - lastReportTime > 2000) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const speed = ((attempts / (Date.now() - startTime)) * 1000).toFixed(0);
      process.stdout.write(
        `\r🔄 已尝试 ${attempts.toLocaleString()} 次 | 用时 ${elapsed}s | 速度 ${speed}/s | 传说=${stats.legendary} 史诗=${stats.epic} 稀有=${stats.rare}`,
      );
      lastReportTime = Date.now();
    }

    // 检查是否满足条件
    const rarityMatch = RARITY_LEVEL[roll.rarity] >= targetLevel;
    const shinyMatch = !options.shiny || roll.shiny;
    const speciesMatch = !options.species || roll.species === options.species;

    if (rarityMatch && shinyMatch && speciesMatch) {
      matches.push({ roll, attempts });

      // 收集到 10 个或达到上限时停下来让用户选择
      if (matches.length >= 10 || attempts >= maxAttempts) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(
          `\n\n🎉 找到了 ${matches.length} 个！第 1 次命中在第 ${matches[0].attempts.toLocaleString()} 次尝试（耗时 ${elapsed}s）\n`,
        );
        console.log(`📊 统计分布:`);
        console.log(
          `   💎 传说: ${stats.legendary} (${((stats.legendary / attempts) * 100).toFixed(2)}%)`,
        );
        console.log(
          `   🔮 史诗: ${stats.epic} (${((stats.epic / attempts) * 100).toFixed(2)}%)`,
        );
        console.log(
          `   💠 稀有: ${stats.rare} (${((stats.rare / attempts) * 100).toFixed(2)}%)`,
        );
        console.log(
          `   🟢 罕见: ${stats.uncommon} (${((stats.uncommon / attempts) * 100).toFixed(2)}%)`,
        );
        console.log(
          `   ⚪ 普通: ${stats.common} (${((stats.common / attempts) * 100).toFixed(2)}%)`,
        );

        const chosen = await selectFromMatches(matches.map((m) => m.roll));
        if (chosen) return;

        // 用户取消选择，直接退出
        console.log("\n已取消，配置未修改");
        return;
      }
    }
  }

  console.log(
    `\n\n💔 达到最大尝试次数 (${maxAttempts.toLocaleString()})，未找到满足条件的 Buddy`,
  );
  console.log(`💡 提示: 增加 --max-attempts 参数或降低要求`);
  process.exit(1);
}

// ============ 交互式选择模式 ============
async function interactiveMode(count: number) {
  console.log("🎰 Buddy 抽卡系统\n");
  console.log(`⚠️  注意：请确保 Claude Code 未运行，否则可能出现配置冲突\n`);
  console.log(`正在生成 ${count} 个随机 Buddy...\n`);

  // 1. 生成候选
  const rolls: BuddyRoll[] = [];
  for (let i = 0; i < count; i++) {
    const userID = randomBytes(32).toString("hex");
    rolls.push(simulateRoll(userID));
  }

  // 2. 按稀有度排序显示
  rolls.sort(compareBuddyRolls);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  rolls.forEach((roll, i) => console.log(formatBuddy(roll, i + 1)));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // 统计
  const stats = {
    legendary: rolls.filter((r) => r.rarity === "legendary").length,
    epic: rolls.filter((r) => r.rarity === "epic").length,
    rare: rolls.filter((r) => r.rarity === "rare").length,
    shiny: rolls.filter((r) => r.shiny).length,
  };
  console.log(
    `\n💎 传说: ${stats.legendary} | 🔮 史诗: ${stats.epic} | 💠 稀有: ${stats.rare} | ✨ 闪光: ${stats.shiny}`,
  );

  // 3. 交互式选择
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(
    `\n选择一个 Buddy (1-${count})，或输入 0 取消: `,
    (answer: string) => {
      rl.close();

      const choice = parseInt(answer, 10);

      if (choice === 0) {
        console.log("已取消，配置未修改");
        process.exit(0);
      }

      if (isNaN(choice) || choice < 1 || choice > count) {
        console.log("❌ 无效选择");
        process.exit(1);
      }

      const selected = rolls[choice - 1];
      console.log(`\n你选择了: ${formatBuddy(selected, choice)}`);

      writeConfig(selected.userID);
    },
  );
}

// ============ 命令行参数解析 ============
export function formatHelpText(): string {
  return `
🎰 Buddy 抽卡系统

用法:
  buddy-gacha [选项]

模式:
  交互模式 (默认):
    显示 N 个随机 Buddy 供你选择

  自动刷稀有度模式:
    使用 --rare 参数，自动刷到指定稀有度为止

选项:
  -r, --rare <1-5>        自动刷到指定稀有度
                          1=common, 2=uncommon, 3=rare, 4=epic, 5=legendary
  -s, --shiny             要求必须是闪光 (配合 --rare 使用)
  --species <name>        要求特定种族 (配合 --rare 使用)
                          可选: ${SPECIES.join(", ")}
  -c, --count <N>         交互模式下生成的数量 (默认: 10)
  --max-attempts <N>      自动模式最大尝试次数 (默认: 10000)
  -h, --help              显示此帮助信息

示例:
  # 交互模式：生成 10 个 Buddy 供选择
  buddy-gacha

  # 交互模式：生成 50 个 Buddy
  buddy-gacha --count 50

  # 自动刷传说稀有度
  buddy-gacha --rare 5

  # 自动刷史诗稀有度，且必须是闪光
  buddy-gacha --rare 4 --shiny

  # 自动刷传说稀有度，且必须是 dragon
  buddy-gacha --rare 5 --species dragon

  # 自动刷传说闪光 dragon（欧皇模式）
  buddy-gacha --rare 5 --shiny --species dragon --max-attempts 100000

稀有度对应关系:
  1 = ⚪ common     (50% 概率)
  2 = 🟢 uncommon   (30% 概率)
  3 = 🔵 rare       (15% 概率)
  4 = 🟣 epic       (4% 概率)
  5 = 🟡 legendary  (1% 概率)
  ✨ shiny         (1% 概率，独立判定)

注意事项:
  • 修改配置后必须完全重启 Claude Code
  • OAuth 登录用户需要先 /logout 才能生效
  • 使用自动模式时请耐心等待，传说+闪光期望需要 10,000 次尝试
`;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      rare: {
        type: "string",
        short: "r",
        description:
          "自动刷到指定稀有度 (1-5: common/uncommon/rare/epic/legendary)",
      },
      shiny: {
        type: "boolean",
        short: "s",
        description: "要求必须是闪光 (配合 --rare 使用)",
      },
      species: {
        type: "string",
        description: "要求特定种族 (duck/cat/dragon等)",
      },
      count: {
        type: "string",
        short: "c",
        default: "10",
        description: "交互模式下生成的 Buddy 数量",
      },
      "max-attempts": {
        type: "string",
        default: "10000",
        description: "自动模式最大尝试次数",
      },
      help: {
        type: "boolean",
        short: "h",
        description: "显示帮助信息",
      },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(formatHelpText());
    process.exit(0);
  }

  // 自动刷稀有度模式
  if (values.rare) {
    const targetLevel = parseInt(values.rare as string, 10);
    if (isNaN(targetLevel) || targetLevel < 1 || targetLevel > 5) {
      console.error("❌ --rare 必须是 1-5 之间的数字");
      console.error("   1=common, 2=uncommon, 3=rare, 4=epic, 5=legendary");
      process.exit(1);
    }

    await autoRollMode(targetLevel, {
      shiny: values.shiny as boolean,
      species: values.species as string | undefined,
      maxAttempts: parseInt(values["max-attempts"] as string, 10),
    });
  } else {
    // 交互式选择模式
    const count = parseInt(values.count as string, 10);
    if (isNaN(count) || count < 1) {
      console.error("❌ --count 必须是正整数");
      process.exit(1);
    }
    await interactiveMode(count);
  }
}

if (import.meta.main) {
  void main();
}
