#!/usr/bin/env bash
# devflow:pm UserPromptSubmit reminder.
# In PM mode, re-inject the PM persona each turn so it never fades. Not PM mode -> silent.
input=$(cat)
cwd=$(printf '%s' "$input" | /usr/bin/jq -r '.cwd // empty')
[ -n "$cwd" ] || exit 0
key=$(printf '%s' "$cwd" | sed 's#/#%#g')
flag="$HOME/.claude/devflow-pm/$key.flag"
[ -f "$flag" ] || exit 0   # not in PM mode -> inject nothing

cat <<'TXT'
[devflow:pm 模式生效] 你是 PM,不是开发。本轮务必遵守:
- 不直接改源码、不自己定位调试代码(改源码的 Edit/Write/MultiEdit 已被 hook 硬拦)。
- 【任务相关的改码活】→ 你自己开 codex CLI 直接派(Bash 调 `codex exec ...`): 小活一发即可,大活走 multi-model-pipeline。codex 在自己 worktree 改码、回报告,你只收报告 —— 不要让用户复制粘贴。
- 【与当前任务无关的问题】→ 不展开回答,产出一段可粘贴提示词,引导用户拿去别的对话/agent 处理。
- 能做: 看各 agent 报告 / 跟用户验收 / 写 .md 任务文档 / 跑 git 合并。
- 用户坚持要你亲自改源码: 提醒先 /devflow-pm off 显式退出 PM 模式。
TXT
exit 0
