# buddy-gacha

A small CLI for rolling a new Claude Code buddy profile by generating candidate `userID` values and writing the chosen one into `~/.claude.json`.

## What It Does

- Generates deterministic buddy results from random `userID` candidates.
- Lets you pick from a sorted list in interactive mode.
- Supports auto-roll mode for target rarity, optional shiny, and optional species filters.
- Clears cached companion-related fields so the new buddy can take effect after restart.

## Install

No global install is required. Run it directly with `npx`:

```bash
npx buddy-gacha --help
```

If you prefer, you can still install it globally:

```bash
npm install -g buddy-gacha
```

## Requirements

- Node.js 18+
- Claude Code launched at least once on the machine
- Access to `~/.claude.json`

## Usage

Run the CLI:

```bash
npx buddy-gacha
```

Show help:

```bash
npx buddy-gacha --help
```

Interactive mode with more candidates:

```bash
npx buddy-gacha --count 50
```

Auto-roll for a target rarity:

```bash
npx buddy-gacha --rare 5
```

Auto-roll for a shiny dragon:

```bash
npx buddy-gacha --rare 5 --shiny --species dragon --max-attempts 100000
```

## Rarity Table

| Level | Rarity | Weight |
| --- | --- | --- |
| 1 | common | 50% |
| 2 | uncommon | 30% |
| 3 | rare | 15% |
| 4 | epic | 4% |
| 5 | legendary | 1% |

Shiny is an independent 1% roll.

## Important Notes

- You must fully restart Claude Code after writing a new `userID`.
- If you are using OAuth login, changing `userID` may not take effect because Claude Code can derive the buddy from `accountUuid`.
- The tool warns before writing in OAuth scenarios, but the safest path is still logging out and using API key mode if you want deterministic resets.
- This tool edits your local Claude Code config file. Review the script before using it on a machine you care about.

## What Changing `userID` Affects

If you manually delete or modify `~/.claude.json` and change the `userID` field:

- Session history is not affected. You can still access conversations by project path.
- Permission records are not affected. They are stored in project-level config.
- OAuth account information is not affected. It is stored in the `oauthAccount` field.
- Your buddy will change completely. Species, rarity, and appearance are regenerated.
- Your buddy's "soul" can be lost or mismatched. Data stored in `config.companion`, such as name, level, and experience, may no longer match the new buddy shell.

## Development

This repo uses Bun for local development and testing.

Install dependencies:

```bash
npm install
```

Build the publishable CLI:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Show CLI help through the package script:

```bash
npm run help
```

Run the CLI:

```bash
npm start
```
