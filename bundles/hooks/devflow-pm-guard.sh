#!/usr/bin/env bash
# devflow:pm PreToolUse guard.
# In PM mode (flag present for cwd), block direct source edits.
# Allow: .md task docs, DevFlow runtime/tasks paths. Not PM mode -> allow everything.
input=$(cat)
cwd=$(printf '%s' "$input" | /usr/bin/jq -r '.cwd // empty')
[ -n "$cwd" ] || exit 0
key=$(printf '%s' "$cwd" | sed 's#/#%#g')
flag="$HOME/.claude/devflow-pm/$key.flag"
[ -f "$flag" ] || exit 0   # not in PM mode -> allow

fp=$(printf '%s' "$input" | /usr/bin/jq -r '.tool_input.file_path // .tool_input.notebook_path // .tool_input.path // empty')

# allow markdown task documents
case "$fp" in
  *.md|*.markdown|*.mdx) exit 0 ;;
esac
# allow DevFlow task-state locations
case "$fp" in
  */runtime/tasks/*|*/devflow/runtime/*) exit 0 ;;
esac

# otherwise: this is source code -> block (exit 2 feeds stderr back to the model)
>&2 echo "🚫 devflow:pm 模式 — 不直接改源码。"
>&2 echo "目标: $fp"
>&2 echo "把这处改动打成任务派给开发 agent(codex 子会话 / multi-model-pipeline / 新开发会话),只接收报告。"
>&2 echo "• 合并分支用 git 命令即可;遇到源码冲突也请派发。"
>&2 echo "• 确需亲自改: 先运行 /devflow-pm off 显式退出 PM 模式, 改完再 /devflow-pm 开回来。"
exit 2
