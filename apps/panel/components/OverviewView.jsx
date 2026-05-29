import { labelForStatus, titleForNode } from "../labels.js";

export default function OverviewView({ graph, checks, onSelectNode, onViewChange }) {
  const nodes = graph.nodes || [];
  const byType = countBy(nodes, "type");
  const installChecks = (checks || []).filter((check) => ["install", "entries", "config", "profile"].includes(check.area));
  const activeTask = nodes.find((node) => node.type === "task" && node.raw?.isActive) || nodes.find((node) => node.type === "task");
  const profile = nodes.find((node) => node.type === "profile");
  const failedChecks = (checks || []).filter((check) => ["fail", "warning", "missing"].includes(check.status));

  return (
    <section className="overview-view" aria-label="DevFlow 总览">
      <OverviewCard
        title="安装与 AI 工具配置"
        subtitle="来自 /api/checks，确认必要文件、目录和 Codex / Claude Code / Agents 链接。"
        actionLabel="查看检查"
        onAction={() => onViewChange("checks")}
      >
        {installChecks.slice(0, 8).map((check) => (
          <MetricRow key={check.id} label={check.title} value={labelForStatus(check.status)} status={check.status} />
        ))}
      </OverviewCard>

      <OverviewCard
        title="项目 / 技能 / 规则 / 模板"
        subtitle="来自 SQLite 索引中的 projects、skills、rules、scene_templates。"
        actionLabel="查看关系"
        onAction={() => onViewChange("relations")}
      >
        <MetricRow label="项目" value={byType.project || 0} />
        <MetricRow label="技能" value={byType.skill || 0} />
        <MetricRow label="规则" value={byType.rule || 0} />
        <MetricRow label="场景模板" value={byType.sceneTemplate || 0} />
        <MetricRow label="关系线" value={(graph.edges || []).length} />
      </OverviewCard>

      <OverviewCard
        title="工作流与 Tasks"
        subtitle="来自 SQLite task/workset 索引与 runtime/tasks/<task-id>/handoff.md。"
        actionLabel="查看任务"
        onAction={() => onViewChange("tasks")}
      >
        {activeTask ? (
          <>
            <MetricRow label="当前任务" value={titleForNode(activeTask)} />
            <MetricRow label="当前 Gate" value={activeTask.raw?.currentGate || "未记录"} status="warning" />
            <MetricRow label="任务状态" value={activeTask.raw?.status || activeTask.status} />
            <MetricRow label="项目数" value={activeTask.raw?.projectIds?.length || 0} />
          </>
        ) : (
          <p className="muted">没有 active task。</p>
        )}
      </OverviewCard>

      <OverviewCard
        title="个人画像"
        subtitle="来自 config/profile.json 和 docs/person/profile.md。"
        actionLabel="查看画像"
        onAction={() => {
          if (profile) onSelectNode(profile.id);
          onViewChange("persona");
        }}
      >
        {profile ? (
          <>
            <MetricRow label="角色" value={profile.raw?.role || profile.summary} />
            <MetricRow label="产品" value={(profile.raw?.products || []).join("、") || "未记录"} />
            <MetricRow label="技术" value={(profile.raw?.strengths || []).slice(0, 3).join("、") || "未记录"} />
            <MetricRow label="来源" value={profile.docPath || profile.sourcePath} />
          </>
        ) : (
          <p className="muted">没有 profile 节点。</p>
        )}
      </OverviewCard>

      <section className="overview-wide">
        <div>
          <h2>当前执行状态</h2>
          <p>superpowers 推进流程，runtime task state 记录任务走到哪一步。中途补充引导或处理权限后，继续回到原任务恢复点。</p>
        </div>
        <div className="overview-summary-list">
          <SummaryPill label="节点总数" value={nodes.length} />
          <SummaryPill label="预警" value={failedChecks.length} tone={failedChecks.length ? "warning" : "ok"} />
          <SummaryPill label="当前任务" value={activeTask?.raw?.currentGate || "无"} tone="info" />
          <SummaryPill label="数据源" value="SQLite + handoff" tone="info" />
        </div>
      </section>
    </section>
  );
}

function OverviewCard({ title, subtitle, actionLabel, onAction, children }) {
  return (
    <article className="overview-card">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="metric-list">{children}</div>
      <button type="button" onClick={onAction}>{actionLabel}</button>
    </article>
  );
}

function MetricRow({ label, value, status = "ok" }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong className={`badge status-${status}`}>{String(value)}</strong>
    </div>
  );
}

function SummaryPill({ label, value, tone = "ok" }) {
  return (
    <div className={`summary-pill tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    counts[item[key]] = (counts[item[key]] || 0) + 1;
    return counts;
  }, {});
}
