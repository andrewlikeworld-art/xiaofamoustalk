#!/usr/bin/env bash
# 一次性脚本:把 uploads/ 里的图原地缩到 1600 宽、JPEG 质量 82、去 EXIF
# 先整体备份到 /data/xiaofamous/backups/,失败可回滚
# 依赖:imagemagick (convert / identify)
# 用法:./scripts/shrink-uploads.sh [--dry-run]

set -euo pipefail

UPLOAD_DIR="/home/andrew/xiaofamoustalk/uploads"
BACKUP_DIR="/data/xiaofamous/backups/uploads-pre-shrink-2026-04-23"
MAX_WIDTH=1600
QUALITY=82
# 小于这个尺寸的图直接跳过(500KB),反正也压不出多少
SKIP_UNDER=512000

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  echo "== DRY RUN 模式:只打印,不改文件 =="
fi

if ! command -v convert >/dev/null || ! command -v identify >/dev/null; then
  echo "❌ 需要 imagemagick,请先跑:sudo apt install -y imagemagick"
  exit 1
fi

if [ ! -d "$UPLOAD_DIR" ]; then
  echo "❌ $UPLOAD_DIR 不存在"
  exit 1
fi

if [ "$DRY_RUN" -eq 0 ]; then
  if [ -e "$BACKUP_DIR" ]; then
    echo "❌ $BACKUP_DIR 已存在,不会覆盖。若确认可删或改日期再跑"
    exit 1
  fi
  echo "[1/3] 备份 $UPLOAD_DIR → $BACKUP_DIR"
  cp -a "$UPLOAD_DIR" "$BACKUP_DIR"
else
  echo "[1/3] (DRY RUN 跳过备份)"
fi

TOTAL_BEFORE=$(du -sb "$UPLOAD_DIR" | cut -f1)

echo "[2/3] 逐张处理..."
processed=0
skipped=0
errors=0

shopt -s nullglob nocaseglob
for f in "$UPLOAD_DIR"/*.jpg "$UPLOAD_DIR"/*.jpeg "$UPLOAD_DIR"/*.png; do
  [ -f "$f" ] || continue
  size_before=$(stat -c%s "$f")
  width=$(identify -format '%w' "$f" 2>/dev/null || echo 0)

  if [ "$width" -eq 0 ]; then
    echo "  ⚠️  $(basename "$f"): 读取失败,跳过"
    errors=$((errors + 1))
    continue
  fi

  if [ "$width" -le "$MAX_WIDTH" ] && [ "$size_before" -le "$SKIP_UNDER" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  [dry] %s: w=%d size=%dKB → 会被压缩\n" "$(basename "$f")" "$width" $((size_before / 1024))
    processed=$((processed + 1))
    continue
  fi

  # 写到 .tmp,成功后再 mv 覆盖,避免中途挂了丢图
  # -auto-orient:先按 EXIF 真正旋转像素,再 -strip 去 metadata(不丢方向)
  # -resize '1600x>':只缩大图,小图不放大
  if convert "$f" -auto-orient -resize "${MAX_WIDTH}x>" -quality "$QUALITY" -strip "$f.tmp" 2>/dev/null; then
    mv "$f.tmp" "$f"
    size_after=$(stat -c%s "$f")
    if [ "$size_before" -gt 0 ]; then
      pct=$(( (size_before - size_after) * 100 / size_before ))
    else
      pct=0
    fi
    printf "  %s: %dKB → %dKB (-%d%%)\n" \
      "$(basename "$f")" $((size_before / 1024)) $((size_after / 1024)) "$pct"
    processed=$((processed + 1))
  else
    rm -f "$f.tmp"
    echo "  ❌ $(basename "$f"): convert 失败,原图未动"
    errors=$((errors + 1))
  fi
done

TOTAL_AFTER=$(du -sb "$UPLOAD_DIR" | cut -f1)

echo "[3/3] 完成"
echo "  处理 $processed 张,跳过 $skipped 张,失败 $errors 张"
if [ "$TOTAL_BEFORE" -gt 0 ]; then
  saved_pct=$(( (TOTAL_BEFORE - TOTAL_AFTER) * 100 / TOTAL_BEFORE ))
else
  saved_pct=0
fi
echo "  总大小: $((TOTAL_BEFORE / 1024 / 1024))MB → $((TOTAL_AFTER / 1024 / 1024))MB  (省 ${saved_pct}%)"

if [ "$DRY_RUN" -eq 0 ]; then
  echo ""
  echo "回滚方法:"
  echo "  rm -rf $UPLOAD_DIR && cp -a $BACKUP_DIR $UPLOAD_DIR"
fi
