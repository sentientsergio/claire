# Gateway Operations Guide

How to start, stop, and manage the claire gateways (Claire and Claire.dev).

---

## Quick Reference

| Command           | What it does                    |
| ----------------- | ------------------------------- |
| `gw-status`       | Show if gateways are running    |
| `gw-start-dev`    | Start dev gateway (Claire.dev)  |
| `gw-start-prod`   | Start prod gateway (Claire)     |
| `gw-stop-dev`     | Gracefully stop dev gateway     |
| `gw-stop-prod`    | Gracefully stop prod gateway    |
| `gw-restart-dev`  | Restart dev gateway             |
| `gw-restart-prod` | Restart prod gateway            |
| `gw-logs-dev`     | Tail dev logs (Ctrl+C to exit)  |
| `gw-logs-prod`    | Tail prod logs (Ctrl+C to exit) |

These aliases work from any directory in any terminal.

---

## How It Works

The gateways run as **macOS LaunchAgents**—background services managed by `launchctl`. This means:

- They run independently of Cursor or any terminal
- They survive quitting apps
- Prod auto-starts on login
- They restart automatically if they crash

### Service Details

| Gateway              | Port  | Telegram Bot               | Auto-start     |
| -------------------- | ----- | -------------------------- | -------------- |
| **prod** (Claire)    | 18789 | @sergios_assistant_bot     | Yes (on login) |
| **dev** (Claire.dev) | 18889 | @sergios_dev_assistant_bot | No (manual)    |

---

## Common Tasks

### After making gateway code changes

```bash
cd ~/sentientsergio/claire/gateway
npm run build && npm run restart:dev
```

Or from anywhere:

```bash
gw-restart-dev
```

(Note: `gw-restart-dev` doesn't rebuild—use `npm run build` first if you changed code)

### Check if everything is running

```bash
gw-status
```

### Something's wrong—check logs

```bash
gw-logs-dev    # Watch dev logs
gw-logs-prod   # Watch prod logs
```

Press `Ctrl+C` to stop watching.

### Stop everything (going offline)

```bash
gw-stop-dev
gw-stop-prod
```

### Start everything back up

```bash
gw-start-dev
gw-start-prod
```

---

## File Locations

| What                | Where                                                  |
| ------------------- | ------------------------------------------------------ |
| Control script      | `gateway/scripts/gateways.sh`                          |
| Dev plist (source)  | `gateway/bot.assistant.gateway.dev.plist`              |
| Prod plist (source) | `gateway/bot.assistant.gateway.prod.plist`             |
| Installed plists    | `~/Library/LaunchAgents/bot.assistant.gateway.*.plist` |
| Dev logs            | `~/Library/Logs/claire/gateway.dev.log`         |
| Prod logs           | `~/Library/Logs/claire/gateway.prod.log`        |
| Error logs          | `~/Library/Logs/claire/gateway.*.error.log`     |
| Shell aliases       | `~/.zshrc`                                             |

---

## Reinstalling / Updating

If you need to reinstall (e.g., after changing plist files):

```bash
cd ~/sentientsergio/claire/gateway
./scripts/gateways.sh uninstall
./scripts/gateways.sh install
./scripts/gateways.sh start all
```

---

## Troubleshooting

### "Command not found: gw-status"

New terminal needed, or run:

```bash
source ~/.zshrc
```

### Gateway won't start

Check error logs:

```bash
cat ~/Library/Logs/claire/gateway.dev.error.log
```

### Gateway starts then immediately stops

Usually a code error. Check the regular log:

```bash
tail -50 ~/Library/Logs/claire/gateway.dev.log
```

### Need to see what launchctl thinks

```bash
launchctl list | grep gateway
```

---

## npm Scripts (alternative)

From the `gateway/` directory, you can also use:

```bash
npm run restart:dev
npm run restart:prod
npm run stop:dev
npm run stop:prod
npm run logs:dev
npm run logs:prod
```

These do the same thing as the `gw-*` aliases.
