import { labelForArea, labelForStatus } from "../labels.js";

export default function ChecksView({ checks, onRunAction }) {
  const groups = groupByArea(checks || []);

  return (
    <section className="checks-view">
      {[...groups.entries()].map(([area, items]) => (
        <div className="check-group" key={area}>
          <h2>{labelForArea(area)}</h2>
          {items.map((check) => (
            <article className={`check-card status-${check.status}`} key={check.id}>
              <div>
                <h3>{check.title}</h3>
                <p>
                  <span className={`status-dot status-${check.status}`} aria-hidden="true" />
                  {labelForStatus(check.status)} · {check.message}
                </p>
              </div>
              {check.actionId ? (
                <button onClick={() => onRunAction(check.actionId, {})} type="button">
                  修复 {check.title}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ))}
    </section>
  );
}

function groupByArea(checks) {
  return checks.reduce((groups, check) => {
    const list = groups.get(check.area) || [];
    list.push(check);
    groups.set(check.area, list);
    return groups;
  }, new Map());
}
