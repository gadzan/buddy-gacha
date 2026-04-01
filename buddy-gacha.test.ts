import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import {
  compareBuddyRolls,
  formatHelpText,
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

describe("formatHelpText", () => {
  test("shows rarity probabilities matching the configured weights", () => {
    const help = formatHelpText();

    expect(help).toContain("1 = ⚪ common     (50% 概率)");
    expect(help).toContain("2 = 🟢 uncommon   (30% 概率)");
    expect(help).toContain("3 = 🔵 rare       (15% 概率)");
    expect(help).not.toContain("1 = ⚪ common     (60% 概率)");
  });

  test("uses the published CLI command in usage examples", () => {
    const help = formatHelpText();

    expect(help).toContain("buddy-gacha [选项]");
    expect(help).toContain("buddy-gacha --rare 5");
    expect(help).not.toContain("bun buddy-gacha.ts");
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
