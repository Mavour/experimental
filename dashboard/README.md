# Meridian DLMM Dashboard

A local web dashboard for monitoring your DLMM agent's performance, journaling, and lessons.

## Quick Start

```bash
cd dashboard
node server.js
```

Then open **http://localhost:3000** in your browser.

## Access on Smartphone

1. Make sure your phone is on the same WiFi network as your computer
2. Find your local IP address (shown when server starts)
3. On your phone, go to `http://<your-ip>:3000`

## Features

### 📊 Dashboard Stats
- Total P&L (USD and SOL)
- Win Rate
- Average P&L %
- Range Efficiency

### 📝 Daily Journal
- All closed positions grouped by date
- Filter by: All / Profit / Loss / Today / This Week
- Detailed metrics per position

### 🧠 Lessons Learned
- Auto-generated lessons from closed positions
- Filter by: All / Good / Bad / Pinned
- Tags and outcomes for each lesson

### 🏊 Pool Memory
- Historical performance per pool
- Win rate and average P&L per pool
- Notes and deploy history

## Auto-Refresh

The dashboard auto-refreshes every 30 seconds. You can also click the Refresh button manually.

## Files Required

The dashboard reads from these files in the parent directory:
- `state.json` - Performance data
- `lessons.json` - Lessons learned
- `pool-memory.json` - Pool history
