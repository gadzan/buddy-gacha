#!/usr/bin/env bun
// buddy-gacha.ts

import { randomBytes } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parseArgs } from "util";

// ============ Buddy 生成逻辑（复制自 companion.ts） ============
const SALT = "friend-2026-401";
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
const RARITY_WEIGHTS: Record<(typeof RARITIES)[number], number> = {
  common: 60,
  uncommon: 25,
  rare: 10,
  epic: 4,
  legendary: 1,
};
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
type Lang = "zh" | "en";

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
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  if (typeof Bun !== "undefined") {
    return Number(BigInt(Bun.hash(s)) & 0xffffffffn);
  }

  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity];
    if (roll < 0) return rarity;
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

export type AutoRollOptions = {
  shiny?: boolean;
  species?: string;
  maxAttempts?: number;
  minRare?: boolean;
};

export type MatchedRoll = {
  roll: BuddyRoll;
  attempts: number;
};

export function simulateRoll(userID: string): BuddyRoll {
  const key = userID + SALT;
  const rng = mulberry32(hashString(key));
  const rarity = rollRarity(rng);
  const species = pick(rng, SPECIES);
  const eye = pick(rng, EYES);
  const shiny = rng() < 0.01;

  return { userID, rarity, species, eye, shiny };
}

export function matchesAutoRollCriteria(
  roll: BuddyRoll,
  targetLevel: number,
  options: Pick<AutoRollOptions, "shiny" | "species" | "minRare">,
): boolean {
  const rarityMatch = options.minRare
    ? RARITY_LEVEL[roll.rarity] >= targetLevel
    : RARITY_LEVEL[roll.rarity] === targetLevel;
  const shinyMatch = !options.shiny || roll.shiny;
  const speciesMatch = !options.species || roll.species === options.species;

  return rarityMatch && shinyMatch && speciesMatch;
}

export function buildAutoRollResult(matches: MatchedRoll[], maxAttempts: number) {
  if (matches.length === 0) return undefined;

  return {
    matches,
    firstHitAttempts: matches[0]?.attempts ?? maxAttempts,
  };
}

// ============ 显示工具 ============
const RARITY_EMOJI = {
  common: "⚪",
  uncommon: "🟢",
  rare: "🔵",
  epic: "🟣",
  legendary: "🟡",
};

const SPECIES_LABEL: Record<Lang, string> = {
  zh: "种族",
  en: "species",
};

const EYE_LABEL: Record<Lang, string> = {
  zh: "眼睛",
  en: "eyes",
};

type MessageContext = {
  speciesList: string;
};

const MESSAGES = {
  zh: {
    helpTitle: "🎰 Buddy 抽卡系统",
    invalidSelection: "❌ 无效选择",
    eyeLabel: "眼睛",
    readConfigError: (configPath: string) =>
      ["❌ 无法读取配置文件:", configPath, "   请确保 Claude Code 已安装并至少启动过一次"] as const,
    oauthWarning: () =>
      [
        "\n⚠️  警告：你当前使用 OAuth 登录",
        "   Buddy 由 accountUuid 决定，修改 userID 不会生效",
        "   要重置 Buddy，请先退出登录 (/logout) 后使用 API KEY 模式\n",
      ] as const,
    configUpdated: (configPath: string, userID: string) =>
      [
        "\n✅ 配置已更新！",
        `📝 配置文件: ${configPath}`,
        `🆔 新 userID: ${userID}`,
        "\n⚠️  重要：必须完全重启 Claude Code 才能生效",
        "   原因：内存中有缓存 (rollCache)，只有进程重启才能清空",
        "\n🔄 请退出当前会话并重新启动 Claude Code\n",
      ] as const,
    confirmWrite: "是否仍要继续写入？(y/N) ",
    cancelled: "已取消",
    cancelledNoChange: "已取消，配置未修改",
    foundMatches: (count: number) => `\n找到 ${count} 个符合条件的 Buddy，展示前 10 个：`,
    chooseTopMatch: (count: number) => `选择一个 (1-${count})，或输入 0 取消全部: `,
    selectedBuddy: (line: string) => `\n你选择了: ${line}`,
    invalidRarityLevel: (level: number) =>
      [`❌ 无效的稀有度等级: ${level}`, "   可用等级: 1=common, 2=uncommon, 3=rare, 4=epic, 5=legendary"] as const,
    autoRollTitle: "🎰 自动抽卡模式",
    targetRarity: (rarity: Rarity) => `🎯 目标: ${RARITY_EMOJI[rarity]} ${rarity.toUpperCase()}`,
    shinyRequirement: "✨ 额外要求: 必须是闪光",
    speciesRequirement: (species: string) => `🐾 额外要求: 种族必须是 ${species}`,
    theoreticalRate: (rate: number, shiny: boolean) =>
      `📊 理论概率: ${rate}%${shiny ? " × 1% (闪光)" : ""}`,
    maxAttempts: (count: number) => `🔄 最大尝试次数: ${count.toLocaleString()}\n`,
    rolling: "开始抽卡...\n",
    progress: (attempts: number, elapsed: string, speed: string, stats: Record<Rarity, number>) =>
      `\r🔄 已尝试 ${attempts.toLocaleString()} 次 | 用时 ${elapsed}s | 速度 ${speed}/s | 传说=${stats.legendary} 史诗=${stats.epic} 稀有=${stats.rare}`,
    distributionSummary: (matchCount: number, firstHitAttempts: number, elapsed: string, stats: Record<Rarity, number>, attempts: number) =>
      [
        `\n\n🎉 找到了 ${matchCount} 个！第 1 次命中在第 ${firstHitAttempts.toLocaleString()} 次尝试（耗时 ${elapsed}s）\n`,
        "📊 统计分布:",
        `   💎 传说: ${stats.legendary} (${((stats.legendary / attempts) * 100).toFixed(2)}%)`,
        `   🔮 史诗: ${stats.epic} (${((stats.epic / attempts) * 100).toFixed(2)}%)`,
        `   💠 稀有: ${stats.rare} (${((stats.rare / attempts) * 100).toFixed(2)}%)`,
        `   🟢 罕见: ${stats.uncommon} (${((stats.uncommon / attempts) * 100).toFixed(2)}%)`,
        `   ⚪ 普通: ${stats.common} (${((stats.common / attempts) * 100).toFixed(2)}%)`,
      ] as const,
    maxAttemptsReached: (count: number) =>
      [
        `\n\n💔 达到最大尝试次数 (${count.toLocaleString()})，未找到满足条件的 Buddy`,
        "💡 提示: 增加 --max-attempts 参数或降低要求",
      ] as const,
    interactiveTitle: "🎰 Buddy 抽卡系统\n",
    interactiveWarning: "⚠️  注意：请确保 Claude Code 未运行，否则可能出现配置冲突\n",
    generatingCandidates: (count: number) => `正在生成 ${count} 个随机 Buddy...\n`,
    interactiveStats: (stats: { legendary: number; epic: number; rare: number; shiny: number }) =>
      `\n💎 传说: ${stats.legendary} | 🔮 史诗: ${stats.epic} | 💠 稀有: ${stats.rare} | ✨ 闪光: ${stats.shiny}`,
    chooseBuddy: (count: number) => `\n选择一个 Buddy (1-${count})，或输入 0 取消: `,
    invalidRareArg: ["❌ --rare 必须是 1-5 之间的数字", "   1=common, 2=uncommon, 3=rare, 4=epic, 5=legendary"] as const,
    invalidCountArg: "❌ --count 必须是正整数",
    helpText: ({ speciesList }: MessageContext) => `
🎰 Buddy 抽卡系统

用法:
  buddy-gacha [选项]

模式:
  交互模式 (默认):
    显示 N 个随机 Buddy 供你选择

  自动刷稀有度模式:
    使用 --rare 参数，自动刷到精确指定稀有度为止

选项:
  -r, --rare <1-5>        自动刷到精确指定稀有度
                          1=common, 2=uncommon, 3=rare, 4=epic, 5=legendary
  --min-rare             匹配指定稀有度或更高稀有度
  -s, --shiny             要求必须是闪光 (配合 --rare 使用)
  --species <name>        要求特定种族 (配合 --rare 使用)
                          可选: ${speciesList}
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

  # 自动刷精确史诗稀有度，且必须是闪光
  buddy-gacha --rare 4 --shiny

  # 自动刷史诗或更高稀有度，且必须是闪光
  buddy-gacha --rare 4 --min-rare --shiny

  # 自动刷传说稀有度，且必须是 dragon
  buddy-gacha --rare 5 --species dragon

  # 自动刷传说闪光 dragon（欧皇模式）
  buddy-gacha --rare 5 --shiny --species dragon --max-attempts 100000

稀有度对应关系:
  1 = ⚪ common     (60% 概率)
  2 = 🟢 uncommon   (25% 概率)
  3 = 🔵 rare       (10% 概率)
  4 = 🟣 epic       (4% 概率)
  5 = 🟡 legendary  (1% 概率)
  ✨ shiny         (1% 概率，独立判定)

注意事项:
  • 修改配置后必须完全重启 Claude Code
  • OAuth 登录用户需要先 /logout 才能生效
  • 使用自动模式时请耐心等待，传说+闪光期望需要 10,000 次尝试
`,
    optionDescriptions: {
      rare: "自动刷到精确指定稀有度 (1-5: common/uncommon/rare/epic/legendary)",
      shiny: "要求必须是闪光 (配合 --rare 使用)",
      species: "要求特定种族 (duck/cat/dragon等)",
      count: "交互模式下生成的 Buddy 数量",
      maxAttempts: "自动模式最大尝试次数",
      minRare: "匹配指定稀有度或更高稀有度",
      help: "显示帮助信息",
    },
  },
  en: {
    helpTitle: "🎰 Buddy Gacha",
    invalidSelection: "❌ Invalid selection",
    eyeLabel: "eyes",
    readConfigError: (configPath: string) =>
      [
        "❌ Failed to read config file:",
        configPath,
        "   Make sure Claude Code is installed and has been launched at least once",
      ] as const,
    oauthWarning: () =>
      [
        "\n⚠️  Warning: you are currently signed in with OAuth",
        "   Buddy selection is derived from accountUuid, so changing userID may not work",
        "   To reset your buddy, log out first (/logout) and use API key mode\n",
      ] as const,
    configUpdated: (configPath: string, userID: string) =>
      [
        "\n✅ Config updated",
        `📝 Config file: ${configPath}`,
        `🆔 New userID: ${userID}`,
        "\n⚠️  Important: you must fully restart Claude Code for this to take effect",
        "   Reason: the process keeps a cached rollCache in memory until restart",
        "\n🔄 Exit the current session and restart Claude Code\n",
      ] as const,
    confirmWrite: "Do you still want to continue writing? (y/N) ",
    cancelled: "Cancelled",
    cancelledNoChange: "Cancelled, config not changed",
    foundMatches: (count: number) => `\nFound ${count} matching buddies. Showing the top 10:`,
    chooseTopMatch: (count: number) => `Choose one (1-${count}), or enter 0 to cancel: `,
    selectedBuddy: (line: string) => `\nYou selected: ${line}`,
    invalidRarityLevel: (level: number) =>
      [`❌ Invalid rarity level: ${level}`, "   Available levels: 1=common, 2=uncommon, 3=rare, 4=epic, 5=legendary"] as const,
    autoRollTitle: "🎰 Auto-roll mode",
    targetRarity: (rarity: Rarity) => `🎯 Target: ${RARITY_EMOJI[rarity]} ${rarity.toUpperCase()}`,
    shinyRequirement: "✨ Extra requirement: must be shiny",
    speciesRequirement: (species: string) => `🐾 Extra requirement: ${SPECIES_LABEL.en} must be ${species}`,
    theoreticalRate: (rate: number, shiny: boolean) =>
      `📊 Theoretical rate: ${rate}%${shiny ? " × 1% (shiny)" : ""}`,
    maxAttempts: (count: number) => `🔄 Maximum attempts: ${count.toLocaleString()}\n`,
    rolling: "Rolling...\n",
    progress: (attempts: number, elapsed: string, speed: string, stats: Record<Rarity, number>) =>
      `\r🔄 Attempts ${attempts.toLocaleString()} | Elapsed ${elapsed}s | Speed ${speed}/s | legendary=${stats.legendary} epic=${stats.epic} rare=${stats.rare}`,
    distributionSummary: (matchCount: number, firstHitAttempts: number, elapsed: string, stats: Record<Rarity, number>, attempts: number) =>
      [
        `\n\n🎉 Found ${matchCount}! First hit arrived at attempt ${firstHitAttempts.toLocaleString()} (${elapsed}s)\n`,
        "📊 Distribution:",
        `   💎 legendary: ${stats.legendary} (${((stats.legendary / attempts) * 100).toFixed(2)}%)`,
        `   🔮 epic: ${stats.epic} (${((stats.epic / attempts) * 100).toFixed(2)}%)`,
        `   💠 rare: ${stats.rare} (${((stats.rare / attempts) * 100).toFixed(2)}%)`,
        `   🟢 uncommon: ${stats.uncommon} (${((stats.uncommon / attempts) * 100).toFixed(2)}%)`,
        `   ⚪ common: ${stats.common} (${((stats.common / attempts) * 100).toFixed(2)}%)`,
      ] as const,
    maxAttemptsReached: (count: number) =>
      [
        `\n\n💔 Reached the maximum attempts (${count.toLocaleString()}) without finding a matching buddy`,
        "💡 Tip: increase --max-attempts or lower the requirements",
      ] as const,
    interactiveTitle: "🎰 Buddy Gacha\n",
    interactiveWarning: "⚠️  Make sure Claude Code is not running, or config writes may conflict\n",
    generatingCandidates: (count: number) => `Generating ${count} random buddies...\n`,
    interactiveStats: (stats: { legendary: number; epic: number; rare: number; shiny: number }) =>
      `\n💎 legendary: ${stats.legendary} | 🔮 epic: ${stats.epic} | 💠 rare: ${stats.rare} | ✨ shiny: ${stats.shiny}`,
    chooseBuddy: (count: number) => `\nChoose a buddy (1-${count}), or enter 0 to cancel: `,
    invalidRareArg: ["❌ --rare must be a number between 1 and 5", "   1=common, 2=uncommon, 3=rare, 4=epic, 5=legendary"] as const,
    invalidCountArg: "❌ --count must be a positive integer",
    helpText: ({ speciesList }: MessageContext) => `
🎰 Buddy Gacha

Usage:
  buddy-gacha [options]

Modes:
  Interactive mode (default):
    Show N random buddies and let you choose one

  Auto-roll mode:
    Use --rare to keep rolling until the exact target rarity appears

Options:
  -r, --rare <1-5>        Auto-roll until the exact target rarity
                          1=common, 2=uncommon, 3=rare, 4=epic, 5=legendary
  --min-rare             Match the target rarity or higher tiers
  -s, --shiny             Require shiny (used with --rare)
  --species <name>        Require a specific species (used with --rare)
                          Available: ${speciesList}
  -c, --count <N>         Number of buddies in interactive mode (default: 10)
  --max-attempts <N>      Maximum attempts in auto-roll mode (default: 10000)
  -h, --help              Show this help message

Examples:
  # Interactive mode: generate 10 buddies to choose from
  buddy-gacha

  # Interactive mode: generate 50 buddies
  buddy-gacha --count 50

  # Auto-roll for legendary rarity
  buddy-gacha --rare 5

  # Auto-roll for exact epic rarity and require shiny
  buddy-gacha --rare 4 --shiny

  # Auto-roll for epic or higher rarity and require shiny
  buddy-gacha --rare 4 --min-rare --shiny

  # Auto-roll for legendary rarity and require dragon
  buddy-gacha --rare 5 --species dragon

  # Auto-roll for shiny legendary dragon
  buddy-gacha --rare 5 --shiny --species dragon --max-attempts 100000

Rarity table:
  1 = ⚪ common     (60%)
  2 = 🟢 uncommon   (25%)
  3 = 🔵 rare       (10%)
  4 = 🟣 epic       (4%)
  5 = 🟡 legendary  (1%)
  ✨ shiny         (1%, independent roll)

Notes:
  • You must fully restart Claude Code after writing a new userID
  • OAuth users usually need to /logout before the change can take effect
  • Auto-roll can take time; shiny legendary has a 10,000-roll expected rate
`,
    optionDescriptions: {
      rare: "Auto-roll until the exact target rarity (1-5: common/uncommon/rare/epic/legendary)",
      shiny: "Require shiny (used with --rare)",
      species: "Require a specific species (duck/cat/dragon, etc.)",
      count: "Number of buddies in interactive mode",
      maxAttempts: "Maximum attempts in auto-roll mode",
      minRare: "Match the target rarity or higher tiers",
      help: "Show help information",
    },
  },
} as const;

export type Messages = (typeof MESSAGES)[Lang];

export function getMessages(lang: Lang): Messages {
  return MESSAGES[lang];
}

export function detectLanguage(input?: {
  env?: Record<string, string | undefined>;
  locale?: string | string[];
}): Lang {
  const env = input?.env ?? process.env;
  const override = env.BUDDY_GACHA_LANG?.toLowerCase();
  if (override === "zh" || override === "en") return override;

  const candidates = [
    env.LC_ALL,
    env.LC_MESSAGES,
    env.LANG,
    ...(Array.isArray(input?.locale)
      ? input!.locale
        : input?.locale
          ? [input.locale]
          : []),
    Intl.DateTimeFormat().resolvedOptions().locale,
  ].filter(Boolean) as string[];

  const locale = candidates[0]?.toLowerCase() ?? "en";
  return locale.startsWith("zh") ? "zh" : "en";
}

export function compareBuddyRolls(a: BuddyRoll, b: BuddyRoll): number {
  const rarityDiff = RARITY_LEVEL[b.rarity] - RARITY_LEVEL[a.rarity];
  if (rarityDiff !== 0) return rarityDiff;
  if (a.shiny === b.shiny) return 0;
  return a.shiny ? -1 : 1;
}

function getUserIdTail(userID: string, length = 6): string {
  return userID.slice(-length);
}

export function formatBuddy(roll: BuddyRoll, index?: number, lang: Lang = detectLanguage()): string {
  const msg = getMessages(lang);
  const emoji = RARITY_EMOJI[roll.rarity];
  const shinyMark = roll.shiny ? "✨" : "  ";
  const prefix = index ? `${index}. ` : "";
  const tailLabel = lang === "zh" ? "尾号" : "Tail";
  return `${prefix}${emoji} ${shinyMark} ${roll.rarity.toUpperCase().padEnd(10)} | ${roll.species.padEnd(10)} | ${roll.eye} ${msg.eyeLabel} | ${tailLabel}: ${getUserIdTail(roll.userID)}`;
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
    const msg = getMessages(detectLanguage());
    const [title, path, detail] = msg.readConfigError(configPath);
    console.error(title, path);
    console.error(detail);
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
    const msg = getMessages(detectLanguage());
    msg.oauthWarning().forEach((line) => console.log(line));
    return true;
  }
  return false;
}

function writeConfig(userID: string, hasExplicitOAuthConfirmation = false) {
  const configPath = getConfigPath();
  const config = readConfig();
  const msg = getMessages(detectLanguage());

  const performWrite = () => {
    // 清理所有 Buddy 相关状态
    const updated = {
      ...config,
      userID,
      companion: undefined, // 清空灵魂数据
      companionMuted: undefined, // 重置静音状态
    };

    writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf-8");
    msg.configUpdated(configPath, userID).forEach((line) => console.log(line));
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

  rl.question(
    msg.confirmWrite,
    (answer: string) => {
      rl.close();
      if (answer.toLowerCase() !== "y") {
        console.log(msg.cancelled);
        process.exit(0);
      }
      performWrite();
    },
  );
}

// ============ 批量展示并选择 ============
async function selectFromMatches(matches: BuddyRoll[]): Promise<boolean> {
  const lang = detectLanguage();
  const msg = getMessages(lang);
  // 按稀有度和闪光排序
  const sorted = [...matches].sort(compareBuddyRolls);

  // 只展示前 10 个
  const top10 = sorted.slice(0, 10);
  console.log(msg.foundMatches(matches.length));
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  top10.forEach((roll, i) => console.log(formatBuddy(roll, i + 1, lang)));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      lang === "zh"
        ? `选择一个 (1-${top10.length})，或输入 0 取消全部: `
        : `Choose one (1-${top10.length}), or enter 0 to cancel: `,
      (answer: string) => {
      rl.close();

      const choice = parseInt(answer, 10);

      if (choice === 0 || isNaN(choice) || choice < 0 || choice > top10.length) {
          console.log(msg.cancelledNoChange);
          resolve(false);
          return;
        }

        // 从排序后的列表中取，用户看到的第 N 个就是 top10[N-1]
        const selected = top10[choice - 1];
        console.log(msg.selectedBuddy(formatBuddy(selected, choice, lang)));
        writeConfig(selected.userID);
        resolve(true);
      },
    );
  });
}

// ============ 自动刷稀有度模式 ============
async function autoRollMode(
  targetLevel: number,
  options: AutoRollOptions,
) {
  const lang = detectLanguage();
  const msg = getMessages(lang);
  const targetRarity = LEVEL_TO_RARITY[targetLevel];
  if (!targetRarity) {
    msg.invalidRarityLevel(targetLevel).forEach((line) => console.error(line));
    process.exit(1);
  }

  console.log(msg.autoRollTitle);
  console.log(msg.targetRarity(targetRarity));
  if (options.shiny) console.log(msg.shinyRequirement);
  if (options.species)
    console.log(msg.speciesRequirement(options.species));
  console.log(msg.theoreticalRate(RARITY_WEIGHTS[targetRarity], Boolean(options.shiny)));

  const maxAttempts = options.maxAttempts || 10000;
  console.log(msg.maxAttempts(maxAttempts));

  checkOAuthWarning();

  console.log(msg.rolling);

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
      process.stdout.write(msg.progress(attempts, elapsed, speed, stats));
      lastReportTime = Date.now();
    }

    // 检查是否满足条件
    if (matchesAutoRollCriteria(roll, targetLevel, options)) {
      matches.push({ roll, attempts });

      // 收集到 10 个或达到上限时停下来让用户选择
      if (matches.length >= 10 || attempts >= maxAttempts) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const result = buildAutoRollResult(matches, maxAttempts);
        if (!result) break;
        msg
          .distributionSummary(matches.length, result.firstHitAttempts, elapsed, stats, attempts)
          .forEach((line) => console.log(line));

        const chosen = await selectFromMatches(matches.map((m) => m.roll));
        if (chosen) return;

        // 用户取消选择，直接退出
        console.log(`\n${msg.cancelledNoChange}`);
        return;
      }
    }
  }

  const result = buildAutoRollResult(matches, maxAttempts);
  if (result) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    msg
      .distributionSummary(matches.length, result.firstHitAttempts, elapsed, stats, attempts)
      .forEach((line) => console.log(line));

    const chosen = await selectFromMatches(matches.map((m) => m.roll));
    if (chosen) return;

    console.log(`\n${msg.cancelledNoChange}`);
    return;
  }

  msg.maxAttemptsReached(maxAttempts).forEach((line) => console.log(line));
  process.exit(1);
}

// ============ 交互式选择模式 ============
async function interactiveMode(count: number) {
  const lang = detectLanguage();
  const msg = getMessages(lang);
  console.log(msg.interactiveTitle);
  console.log(msg.interactiveWarning);
  console.log(msg.generatingCandidates(count));

  // 1. 生成候选
  const rolls: BuddyRoll[] = [];
  for (let i = 0; i < count; i++) {
    const userID = randomBytes(32).toString("hex");
    rolls.push(simulateRoll(userID));
  }

  // 2. 按稀有度排序显示
  rolls.sort(compareBuddyRolls);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  rolls.forEach((roll, i) => console.log(formatBuddy(roll, i + 1, lang)));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // 统计
  const stats = {
    legendary: rolls.filter((r) => r.rarity === "legendary").length,
    epic: rolls.filter((r) => r.rarity === "epic").length,
    rare: rolls.filter((r) => r.rarity === "rare").length,
    shiny: rolls.filter((r) => r.shiny).length,
  };
  console.log(msg.interactiveStats(stats));

  // 3. 交互式选择
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(
    msg.chooseBuddy(count),
    (answer: string) => {
      rl.close();

      const choice = parseInt(answer, 10);

      if (choice === 0) {
        console.log(msg.cancelledNoChange);
        process.exit(0);
      }

      if (isNaN(choice) || choice < 1 || choice > count) {
        console.log(msg.invalidSelection);
        process.exit(1);
      }

      const selected = rolls[choice - 1];
      console.log(msg.selectedBuddy(formatBuddy(selected, choice, lang)));

      writeConfig(selected.userID);
    },
  );
}

// ============ 命令行参数解析 ============
export function formatHelpText(lang: Lang = detectLanguage()): string {
  return getMessages(lang).helpText({
    speciesList: SPECIES.join(", "),
  });
}

async function main() {
  const msg = getMessages(detectLanguage());
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      rare: {
        type: "string",
        short: "r",
        description: msg.optionDescriptions.rare,
      },
      shiny: {
        type: "boolean",
        short: "s",
        description: msg.optionDescriptions.shiny,
      },
      species: {
        type: "string",
        description: msg.optionDescriptions.species,
      },
      "min-rare": {
        type: "boolean",
        description: msg.optionDescriptions.minRare,
      },
      count: {
        type: "string",
        short: "c",
        default: "10",
        description: msg.optionDescriptions.count,
      },
      "max-attempts": {
        type: "string",
        default: "10000",
        description: msg.optionDescriptions.maxAttempts,
      },
      help: {
        type: "boolean",
        short: "h",
        description: msg.optionDescriptions.help,
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
      getMessages(detectLanguage())
        .invalidRareArg
        .forEach((line) => console.error(line));
      process.exit(1);
    }

    await autoRollMode(targetLevel, {
      shiny: values.shiny as boolean,
      species: values.species as string | undefined,
      minRare: values["min-rare"] as boolean,
      maxAttempts: parseInt(values["max-attempts"] as string, 10),
    });
  } else {
    // 交互式选择模式
    const count = parseInt(values.count as string, 10);
    if (isNaN(count) || count < 1) {
      console.error(getMessages(detectLanguage()).invalidCountArg);
      process.exit(1);
    }
    await interactiveMode(count);
  }
}

if (import.meta.main) {
  void main();
}
