export default function PersonaView({ document, loading, error }) {
  const markdown = document?.markdown || "";
  const sourcePath = document?.sourcePath || "未创建";

  return (
    <section className="persona-view" aria-label="画像文档">
      <div className="persona-header">
        <div>
          <h2>画像文档</h2>
          <p>{sourcePath}</p>
        </div>
      </div>
      {loading ? <p className="state-message">正在读取画像文档...</p> : null}
      {error ? <p className="state-message error-message" role="alert">{error}</p> : null}
      {!loading && !markdown ? <p className="muted">{document?.message || "画像文档为空。"}</p> : null}
      {markdown ? <MarkdownDocument markdown={markdown} /> : null}
    </section>
  );
}

function MarkdownDocument({ markdown }) {
  const blocks = parseMarkdownBlocks(markdown);
  return (
    <article className="markdown-document">
      {blocks.map((block, index) => renderBlock(block, index))}
    </article>
  );
}

function renderBlock(block, index) {
  if (block.type === "heading") {
    const Heading = `h${block.level}`;
    return <Heading key={index}>{block.text}</Heading>;
  }
  if (block.type === "quote") {
    return <blockquote key={index}>{block.text}</blockquote>;
  }
  if (block.type === "list") {
    const List = block.ordered ? "ol" : "ul";
    return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</List>;
  }
  return <p key={index}>{block.text}</p>;
}

function parseMarkdownBlocks(markdown) {
  const blocks = [];
  const lines = String(markdown || "").replace(/^---[\s\S]*?---\s*/, "").split(/\r?\n/);
  let paragraph = [];
  let listItems = [];
  let listOrdered = false;

  function flushParagraph() {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  }

  function flushList() {
    if (listItems.length) {
      blocks.push({ type: "list", ordered: listOrdered, items: listItems });
      listItems = [];
      listOrdered = false;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length + 1, text: heading[2] });
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: line.replace(/^>\s?/, "") });
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(line);
    if (listItem) {
      flushParagraph();
      if (listItems.length && listOrdered) flushList();
      listOrdered = false;
      listItems.push(listItem[1]);
      continue;
    }

    const orderedListItem = /^\d+\.\s+(.+)$/.exec(line);
    if (orderedListItem) {
      flushParagraph();
      if (listItems.length && !listOrdered) flushList();
      listOrdered = true;
      listItems.push(orderedListItem[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}
