import {
  VIEW_LABELS
} from "../labels.js";
import {
  FolderKanban,
  Route
} from "lucide-react";

const VIEW_ICONS = {
  relations: Route,
  tasks: FolderKanban
};

export default function Sidebar({ activeView, onViewChange }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <span className="brand-mark">CS</span>
        <div>
          <h1>上下文工作台</h1>
          <p>DevFlow 关系图谱</p>
        </div>
      </div>
      <nav aria-label="主导航">
        {VIEW_LABELS.map((view) => {
          const Icon = VIEW_ICONS[view.key];
          return (
          <button
            className={activeView === view.key ? "active" : ""}
            key={view.key}
            onClick={() => onViewChange(view.key)}
            type="button"
          >
            <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
            {view.label}
          </button>
          );
        })}
      </nav>
    </aside>
  );
}
