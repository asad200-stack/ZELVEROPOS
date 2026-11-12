import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { track } from '../analytics';
import { SUGGESTED_PROMPTS, answerZelvero, type AiReply, type AiSession } from '../content/ai';
import { withContext, writeSalesContext } from '../sales/context';
import { haptic } from '../haptics';
import { playSound } from '../sound/engine';
import { Button } from './Button';

export function AIWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [session] = useState<AiSession>(() => ({}));
  const [messages, setMessages] = useState<{ role: 'ai' | 'you'; reply: AiReply }[]>([{ role: 'ai', reply: answerZelvero('') }]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ask = (text: string) => {
    const reply = answerZelvero(text, session);
    writeSalesContext({
      businessType: session.industrySlug,
      interestedFeatures: reply.chips,
    });
    setMessages((m) => [...m, { role: 'you', reply: { text, actions: [] } }, { role: 'ai', reply }]);
    playSound('aiResponse');
    if (reply.unknown) track('ai_lead');
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    playSound('aiSend');
    haptic(12);
    setInput('');
    ask(text);
  };

  return (
    <>
      <button
        type="button"
        className={`zw-ai-fab ${open ? 'is-open' : ''}`}
        aria-expanded={open}
        aria-controls="zw-ai-panel"
        onClick={() => {
          playSound('aiOpen');
          setOpen((v) => {
            if (!v) track('ai_open');
            return !v;
          });
        }}
      >
        ✦ AI
      </button>
      {open && (
        <section id="zw-ai-panel" className="zw-ai-panel is-open" aria-label="ZELVERO AI" role="dialog">
          <header>
            <div>
              <span className="zw-logo__mark" aria-hidden />
              <div>
                <strong>ZELVERO AI</strong>
                <p className="zw-note zw-ai-sub">Ask about ZELVERO or tell me what kind of business you run.</p>
              </div>
            </div>
            <button type="button" className="zw-link" onClick={() => setOpen(false)} aria-label="Close assistant">
              Close
            </button>
          </header>
          <div className="zw-ai-log">
            {messages.map((m, i) => (
              <article key={i} className={m.role === 'ai' ? 'is-ai' : 'is-you'}>
                <p>{m.reply.text}</p>
                {m.reply.chips && (
                  <div className="zw-prompts">
                    {m.reply.chips.map((c) => (
                      <span key={c} className="zw-chip">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                {m.reply.steps && (
                  <ol className="zw-ai-steps">
                    {m.reply.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                )}
                {m.reply.bullets && (
                  <ul>
                    {m.reply.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                {m.reply.actions.length > 0 && (
                  <div className="zw-hero__cta">
                    {m.reply.actions.map((a) => (
                      <Link key={a.id} className="zw-btn zw-btn--sm zw-btn--secondary" to={withContext(a.to, { businessType: session.industrySlug, interestedFeatures: m.reply.chips })}>
                        {a.label}
                      </Link>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {messages.length < 3 && (
              <div className="zw-prompts">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button key={p} type="button" className="zw-chip" onClick={() => ask(p)}>
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
          <form onSubmit={send}>
            <label className="zw-field">
              Message
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about ZELVERO" />
            </label>
            <Button type="submit" size="sm">
              Send
            </Button>
          </form>
        </section>
      )}
    </>
  );
}
