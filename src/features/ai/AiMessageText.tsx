/**
 * Renders Zelvero AI answer text with light formatting: **bold**, _italic line_, "• " bullets and
 * "1. " numbered steps. Built from React elements only (no HTML injection), so store data such as
 * product names is always shown as plain text.
 */
import type { ReactNode } from 'react';

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      out.push(<strong key={`${keyBase}-b${i}`}>{part.slice(2, -2)}</strong>);
    } else {
      out.push(part);
    }
  });
  return out;
}

type Block =
  | { kind: 'p'; text: string; muted: boolean }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'gap' };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      if (out.length > 0 && out[out.length - 1]!.kind !== 'gap') out.push({ kind: 'gap' });
      continue;
    }
    const bullet = /^[•\-–]\s+(.*)$/.exec(line);
    const numbered = /^\d{1,2}[.)]\s+(.*)$/.exec(line);
    const last = out[out.length - 1];
    if (bullet) {
      if (last?.kind === 'ul') last.items.push(bullet[1]!);
      else out.push({ kind: 'ul', items: [bullet[1]!] });
    } else if (numbered) {
      if (last?.kind === 'ol') last.items.push(numbered[1]!);
      else out.push({ kind: 'ol', items: [numbered[1]!] });
    } else {
      const muted = /^_.+_$/.test(line);
      out.push({ kind: 'p', text: muted ? line.slice(1, -1) : line, muted });
    }
  }
  while (out.length > 0 && out[out.length - 1]!.kind === 'gap') out.pop();
  return out;
}

export function AiMessageText({ text }: { text: string }) {
  return (
    <div className="ai-md">
      {blocks(text).map((block, i) => {
        if (block.kind === 'gap') return <div key={i} className="ai-md__gap" aria-hidden="true" />;
        if (block.kind === 'ul') {
          return (
            <ul key={i} className="ai-md__list">
              {block.items.map((item, j) => (
                <li key={j}>{inline(item, `${i}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'ol') {
          return (
            <ol key={i} className="ai-md__list ai-md__list--ol">
              {block.items.map((item, j) => (
                <li key={j}>{inline(item, `${i}-${j}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i} className={block.muted ? 'ai-md__p ai-md__p--muted' : 'ai-md__p'}>
            {inline(block.text, `${i}`)}
          </p>
        );
      })}
    </div>
  );
}
