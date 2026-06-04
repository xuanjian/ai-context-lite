#!/usr/bin/env bash
# devflow:pm hooks 安装器 —— 把 guard / reminder 两个 hook 注册进 ~/.claude/settings.json。
#
# 设计目标:仓库里不留任何写死的用户路径。
#   - hook 脚本在仓内版本管理,安装时 symlink 到一个 $HOME 锚定的稳定位置
#     (~/.claude/devflow-pm/hooks/,跟 flag 目录放一起)。
#   - settings.json 里写的是这个稳定位置解析出的绝对路径(机器本地、由本脚本生成,
#     不依赖 hook runner 是否展开 $HOME)。
#   - symlink 指回仓里的真实脚本,所以改仓里脚本即时生效,无需重装。
#
# 幂等:重复跑不会重复注册。装完需重启 Claude 会话,hook 才会加载。
#
# 用法: bash install-pm-hooks.sh [install|uninstall|status]
set -euo pipefail

action="${1:-install}"

# jq:优先 PATH,回退 /usr/bin/jq(现有 hook 脚本用的就是这个)。
JQ="$(command -v jq || true)"
[ -n "$JQ" ] || JQ="/usr/bin/jq"
if ! "$JQ" --version >/dev/null 2>&1; then
  echo "❌ 需要 jq,但没找到。先安装:brew install jq" >&2
  exit 1
fi

# 仓内真实脚本(与本安装器同目录)。
src_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
guard_src="$src_dir/devflow-pm-guard.sh"
reminder_src="$src_dir/devflow-pm-reminder.sh"

# $HOME 锚定的稳定部署位置。
dest_dir="$HOME/.claude/devflow-pm/hooks"
guard_dest="$dest_dir/devflow-pm-guard.sh"
reminder_dest="$dest_dir/devflow-pm-reminder.sh"

settings="$HOME/.claude/settings.json"

# settings.json 里某 hook 数组是否已含某 command。
has_cmd() { # $1=eventName  $2=command
  [ -f "$settings" ] || return 1
  "$JQ" -e --arg ev "$1" --arg c "$2" \
    '[(.hooks[$ev] // [])[]?.hooks[]?.command] | any(. == $c)' \
    "$settings" >/dev/null 2>&1
}

do_install() {
  for f in "$guard_src" "$reminder_src"; do
    [ -f "$f" ] || { echo "❌ 缺少 hook 脚本: $f" >&2; exit 1; }
  done

  mkdir -p "$dest_dir"
  ln -sf "$guard_src" "$guard_dest"
  ln -sf "$reminder_src" "$reminder_dest"
  echo "🔗 已链接 hook 脚本 → $dest_dir/"

  mkdir -p "$(dirname "$settings")"
  [ -f "$settings" ] || echo '{}' > "$settings"

  # 校验现有 settings 是合法 JSON,避免把坏文件越改越坏。
  if ! "$JQ" -e . "$settings" >/dev/null 2>&1; then
    echo "❌ $settings 不是合法 JSON,先手动修好再装。" >&2
    exit 1
  fi

  local changed=0
  has_cmd PreToolUse "$guard_dest" || changed=1
  has_cmd UserPromptSubmit "$reminder_dest" || changed=1
  if [ "$changed" -eq 0 ]; then
    echo "✅ settings.json 已注册过,无需改动(幂等)。"
    echo "   若刚装好还没生效,重启 Claude 会话即可。"
    return
  fi

  local backup="$settings.bak.$(date +%Y%m%d%H%M%S)"
  cp "$settings" "$backup"

  local tmp
  tmp="$(mktemp)"
  "$JQ" \
    --arg guard "$guard_dest" \
    --arg reminder "$reminder_dest" '
    def hasCmd($arr; $c): ([ $arr[]?.hooks[]?.command ] | any(. == $c));
    .hooks = (.hooks // {})
    | .hooks.PreToolUse = (.hooks.PreToolUse // [])
    | .hooks.UserPromptSubmit = (.hooks.UserPromptSubmit // [])
    | (if hasCmd(.hooks.PreToolUse; $guard) then .
       else .hooks.PreToolUse += [{
         matcher: "Edit|Write|MultiEdit|NotebookEdit",
         hooks: [{ type: "command", command: $guard }]
       }] end)
    | (if hasCmd(.hooks.UserPromptSubmit; $reminder) then .
       else .hooks.UserPromptSubmit += [{
         hooks: [{ type: "command", command: $reminder }]
       }] end)
  ' "$settings" > "$tmp"

  # 写回前再校验一次输出。
  if ! "$JQ" -e . "$tmp" >/dev/null 2>&1; then
    echo "❌ 合并结果不是合法 JSON,已放弃。原文件未动,备份在 $backup" >&2
    rm -f "$tmp"
    exit 1
  fi
  mv "$tmp" "$settings"

  echo "✅ 已注册 guard(PreToolUse)+ reminder(UserPromptSubmit) → $settings"
  echo "   备份: $backup"
  echo "⚠️  重启 Claude 会话后 hook 才会加载生效。"
}

do_uninstall() {
  if [ -f "$settings" ] && "$JQ" -e . "$settings" >/dev/null 2>&1; then
    if has_cmd PreToolUse "$guard_dest" || has_cmd UserPromptSubmit "$reminder_dest"; then
      local backup="$settings.bak.$(date +%Y%m%d%H%M%S)"
      cp "$settings" "$backup"
      local tmp
      tmp="$(mktemp)"
      # 用 [ ... ] 数组构造确保 RHS 永远是单个数组(可能为空),绝不产生 empty
      # —— jq 里 `.x = empty` 会让整个输出变空、写坏文件。空数组再用 del 清掉。
      "$JQ" \
        --arg guard "$guard_dest" \
        --arg reminder "$reminder_dest" '
        .hooks.PreToolUse = [ (.hooks.PreToolUse // [])[]
          | select(([.hooks[]?.command] | any(. == $guard)) | not) ]
        | .hooks.UserPromptSubmit = [ (.hooks.UserPromptSubmit // [])[]
          | select(([.hooks[]?.command] | any(. == $reminder)) | not) ]
        | (if (.hooks.PreToolUse | length) == 0 then del(.hooks.PreToolUse) else . end)
        | (if (.hooks.UserPromptSubmit | length) == 0 then del(.hooks.UserPromptSubmit) else . end)
        | (if (.hooks // {} | length) == 0 then del(.hooks) else . end)
      ' "$settings" > "$tmp"
      # 写回前校验,避免把 settings 写坏(install 同款保护)。
      if ! "$JQ" -e . "$tmp" >/dev/null 2>&1; then
        echo "❌ 卸载结果不是合法 JSON,已放弃。原文件未动,备份在 $backup" >&2
        rm -f "$tmp"
        exit 1
      fi
      mv "$tmp" "$settings"
      echo "✅ 已从 settings.json 移除 PM hook 注册。备份: $backup"
      echo "⚠️  重启 Claude 会话后生效。"
    else
      echo "ℹ️  settings.json 里没有 PM hook 注册,跳过。"
    fi
  fi
  rm -f "$guard_dest" "$reminder_dest"
  echo "🧹 已移除 symlink: $dest_dir/"
}

do_status() {
  echo "src 仓内脚本: $src_dir"
  echo "symlink 部署: $dest_dir"
  printf '  guard    symlink: %s\n' "$([ -L "$guard_dest" ] && echo "✓ → $(readlink "$guard_dest")" || echo "✗ 未部署")"
  printf '  reminder symlink: %s\n' "$([ -L "$reminder_dest" ] && echo "✓ → $(readlink "$reminder_dest")" || echo "✗ 未部署")"
  printf '  PreToolUse 注册:  %s\n' "$(has_cmd PreToolUse "$guard_dest" && echo "✓ 已注册" || echo "✗ 未注册")"
  printf '  UserPromptSubmit: %s\n' "$(has_cmd UserPromptSubmit "$reminder_dest" && echo "✓ 已注册" || echo "✗ 未注册")"
}

case "$action" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
  status)    do_status ;;
  *) echo "用法: bash install-pm-hooks.sh [install|uninstall|status]"; exit 1 ;;
esac
