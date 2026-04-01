import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import {
  buildAutoRollResult,
  compareBuddyRolls,
  detectLanguage,
  formatHelpText,
  formatBuddy,
  getMessages,
  hashString,
  matchesAutoRollCriteria,
  simulateRoll,
  shouldProceedWithOAuthWrite,
  type BuddyRoll,
} from "./buddy-gacha";

describe("shouldProceedWithOAuthWrite", () => {
  test("blocks OAuth writes unless explicitly confirmed", () => {
    expect(shouldProceedWithOAuthWrite(false, false)).toBe(true);
    expect(shouldProceedWithOAuthWrite(true, false)).toBe(false);
    expect(shouldProceedWithOAuthWrite(true, true)).toBe(true);
  });
});

describe("compareBuddyRolls", () => {
  test("puts shiny buddies before non-shiny when rarity is equal", () => {
    const shinyRare: BuddyRoll = {
      userID: "a",
      rarity: "rare",
      species: "duck",
      eye: "·",
      shiny: true,
    };
    const normalRare: BuddyRoll = {
      userID: "b",
      rarity: "rare",
      species: "duck",
      eye: "·",
      shiny: false,
    };

    expect(compareBuddyRolls(shinyRare, normalRare)).toBeLessThan(0);
    expect(compareBuddyRolls(normalRare, shinyRare)).toBeGreaterThan(0);
    expect(compareBuddyRolls(shinyRare, shinyRare)).toBe(0);
  });
});

describe("formatBuddy", () => {
  test("shows the last 6 characters of the user id in the option line", () => {
    const roll: BuddyRoll = {
      userID: "1234567890abcdef",
      rarity: "epic",
      species: "dragon",
      eye: "@",
      shiny: true,
    };

    const line = formatBuddy(roll, 3, "en");

    expect(line).toContain("3.");
    expect(line).toContain("Tail: abcdef");
  });
});

describe("matchesAutoRollCriteria", () => {
  test("treats --rare as an exact rarity match by default", () => {
    const epicShiny: BuddyRoll = {
      userID: "epic-shiny",
      rarity: "epic",
      species: "dragon",
      eye: "@",
      shiny: true,
    };
    const legendaryShiny: BuddyRoll = {
      userID: "legendary-shiny",
      rarity: "legendary",
      species: "dragon",
      eye: "@",
      shiny: true,
    };

    expect(matchesAutoRollCriteria(epicShiny, 4, { shiny: true })).toBe(true);
    expect(matchesAutoRollCriteria(legendaryShiny, 4, { shiny: true })).toBe(false);
  });

  test("still supports minimum-rarity matching when explicitly requested", () => {
    const legendaryShiny: BuddyRoll = {
      userID: "legendary-shiny",
      rarity: "legendary",
      species: "dragon",
      eye: "@",
      shiny: true,
    };

    expect(
      matchesAutoRollCriteria(legendaryShiny, 4, { shiny: true, minRare: true }),
    ).toBe(true);
  });
});

describe("buildAutoRollResult", () => {
  test("returns partial matches when max attempts is reached after finding some", () => {
    const partialMatches = [
      {
        roll: {
          userID: "one",
          rarity: "legendary",
          species: "duck",
          eye: "·",
          shiny: true,
        },
        attempts: 120,
      },
      {
        roll: {
          userID: "two",
          rarity: "legendary",
          species: "cat",
          eye: "@",
          shiny: true,
        },
        attempts: 250,
      },
    ];

    expect(buildAutoRollResult(partialMatches, 5000)?.matches).toHaveLength(2);
  });

  test("returns no selection payload when nothing matched", () => {
    expect(buildAutoRollResult([], 5000)).toBeUndefined();
  });
});

describe("Claude Code compatibility", () => {
  test("uses the same hash output as Claude Code for seeded buddy rolls", () => {
    expect(hashString("cada3177aa96f7d61f23edb0c60e4a3fe8dcb7b361a9b764dae15d563a720649friend-2026-401")).toBe(
      1681748562,
    );
  });

  test("matches Claude Code buddy rarity for a known user id", () => {
    const roll = simulateRoll(
      "cada3177aa96f7d61f23edb0c60e4a3fe8dcb7b361a9b764dae15d563a720649",
    );

    expect(roll.rarity).toBe("rare");
  });
});

describe("formatHelpText", () => {
  test("shows rarity probabilities matching the configured weights", () => {
    const help = formatHelpText("zh");

    expect(help).toContain("1 = ⚪ common     (60% 概率)");
    expect(help).toContain("2 = 🟢 uncommon   (25% 概率)");
    expect(help).toContain("3 = 🔵 rare       (10% 概率)");
    expect(help).not.toContain("1 = ⚪ common     (50% 概率)");
  });

  test("uses the published CLI command in usage examples", () => {
    const help = formatHelpText("zh");

    expect(help).toContain("buddy-gacha [选项]");
    expect(help).toContain("buddy-gacha --rare 5");
    expect(help).not.toContain("bun buddy-gacha.ts");
  });

  test("defaults to English help text for non-Chinese locales", () => {
    const help = formatHelpText("en");

    expect(help).toContain("Usage:");
    expect(help).toContain("buddy-gacha [options]");
    expect(help).toContain("Auto-roll for legendary rarity");
    expect(help).not.toContain("用法:");
  });
});

describe("detectLanguage", () => {
  test("picks Chinese for zh locales and English otherwise", () => {
    expect(detectLanguage({ env: { LANG: "zh_CN.UTF-8" } })).toBe("zh");
    expect(detectLanguage({ env: { LC_ALL: "zh-TW" } })).toBe("zh");
    expect(detectLanguage({ env: { LANG: "en_US.UTF-8" } })).toBe("en");
    expect(detectLanguage({ env: {}, locale: "en-US" })).toBe("en");
    expect(detectLanguage({ env: {}, locale: "zh-CN" })).toBe("zh");
  });
});

describe("getMessages", () => {
  test("returns language-specific labels from one message factory", () => {
    const zh = getMessages("zh");
    const en = getMessages("en");

    expect(zh.helpTitle).toContain("Buddy 抽卡系统");
    expect(en.helpTitle).toContain("Buddy Gacha");
    expect(zh.invalidSelection).toBe("❌ 无效选择");
    expect(en.invalidSelection).toBe("❌ Invalid selection");
    expect(zh.optionDescriptions.help).toBe("显示帮助信息");
    expect(en.optionDescriptions.help).toBe("Show help information");
  });
});

describe("package metadata", () => {
  test("publishes a built JavaScript CLI entrypoint", () => {
    const packageJson = JSON.parse(readFileSync("./package.json", "utf8"));

    expect(packageJson.bin["buddy-gacha"]).toBe("./dist/buddy-gacha.js");
    expect(packageJson.scripts.build).toBeDefined();
    expect(packageJson.scripts.prepublishOnly).toBe("npm run build");
  });

  test("documents npm installation for end users", () => {
    const readme = readFileSync("./README.md", "utf8");

    expect(readme).toContain("npx buddy-gacha --help");
    expect(readme).toContain("No global install is required");
  });
});

describe("release workflow", () => {
  test("uses release-published trigger with Bun-based verify and publish jobs", () => {
    const workflow = readFileSync("./.github/workflows/release.yml", "utf8");

    expect(workflow).toContain("release:");
    expect(workflow).toContain("types: [published]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("oven-sh/setup-bun@v2");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm publish");
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(workflow).not.toContain("cache: npm");
    expect(workflow).not.toContain("bun install --frozen-lockfile");
  });
});
