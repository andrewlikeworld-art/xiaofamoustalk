#!/usr/bin/env bash
# 手动备份：
#   ./scripts/backup-db.sh
# 用 sqlite3 .backup 做一致快照（含 WAL 中未合并写入），
# 输出到 /data/xiaofamous/backups/data-YYYYMMDD-HHMMSS.sqlite
# 同时保留最近 30 份。
set -euo pipefail

DB_PATH="${DB_PATH:-/data/xiaofamous/data.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-/data/xiaofamous/backups}"
KEEP="${KEEP:-30}"

if [ ! -f "$DB_PATH" ]; then
  echo "❌ 找不到数据库: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/data-$TS.sqlite"

sqlite3 "$DB_PATH" ".backup '$OUT'"
sqlite3 "$OUT" "PRAGMA integrity_check;" | grep -q '^ok$' || { echo "❌ integrity_check 失败: $OUT" >&2; exit 2; }

SIZE="$(du -h "$OUT" | cut -f1)"
echo "✅ 备份完成: $OUT ($SIZE)"

# 清理旧备份，只保留最近 $KEEP 份
ls -1t "$BACKUP_DIR"/data-*.sqlite 2>/dev/null | tail -n +"$((KEEP+1))" | xargs -r rm -v
