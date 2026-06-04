#!/usr/bin/env bash
# devflow:pm mode toggle. Flag is keyed by current working directory.
action="${1:-on}"
cwd="${PWD}"
mkdir -p "$HOME/.claude/devflow-pm"
key=$(printf '%s' "$cwd" | sed 's#/#%#g')
flag="$HOME/.claude/devflow-pm/$key.flag"
case "$action" in
  on)
    printf 'devflow:pm ON\ncwd: %s\n' "$cwd" > "$flag"
    echo "✅ devflow:pm 已开启(目录: $cwd)"
    echo "本对话现在是 PM 模式: 可读码 / 可写 .md 任务文档 / 可 git 合并, 但不能直接改源码。"
    ;;
  off)
    rm -f "$flag"
    echo "⭕️ devflow:pm 已关闭(目录: $cwd)— 恢复普通模式, 可正常改代码。"
    ;;
  status)
    if [ -f "$flag" ]; then echo "devflow:pm = ON  ($cwd)"; else echo "devflow:pm = OFF ($cwd)"; fi
    ;;
  *)
    echo "用法: devflow-pm-toggle.sh [on|off|status]"; exit 1 ;;
esac
