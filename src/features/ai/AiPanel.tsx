import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useSession } from '@/contexts/session';
import type { PermissionKey } from '@/constants/permissions';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import { handleOperatorTurn, type PendingOperator } from './actions/operator';
import { aiAccessDeniedText, assertCanAccessZelveroAi, canAccessZelveroAi } from './aiAccess';
import { aiLayerClassNames } from './aiDock';
import { publishedKnowledge } from './catalog';
import { scrollTopForLatest, shouldFollowLatest, shouldStickToBottom } from './chatScroll';
import { answerQuestion, conversationStorageKey, shouldConsultModel, type AiLang, type Answer } from './engine';
import { isGenericUnsupportedAnswer } from './fallbackAnswer';
import { AiMessageText } from './AiMessageText';
import {
  answerBrainIntent,
  compareAnswer,
  detectBrainIntent,
  looksInternal,
  missReply,
  presentAnswer,
  renderRead,
  replyLang,
  smallTalkReply,
  suggestionsFor,
  type BrainAnswer,
} from './brain/brain';
import { localModelUrl, phraseWithLocalModel, probeLocalModel } from './localModel';
import { emptyMemory, rememberClarify, rememberCompare, rememberInsight, rememberOther, rememberRead, rememberTurn, type CopilotMemory } from './copilot/memory';
import { planTurn } from './copilot/orchestrator';
import { planWithLocalModel } from './copilot/modelPlanner';
import { comparePeriods } from './copilot/periodCompare';
import { serverAiReadSource } from './serverReadSource';
import { copilotRead } from './copilotTransport';
import { runInsight } from './copilot/insights';
import { composeLiveAnswer } from './liveWording';
import { loadReadSnapshot, type ReadSession, type ReadSnapshot } from './readSnapshot';
import {
  createBrowserSpeechAdapter,
  resolveSpeechLocale,
  transcriptMayNeedArabicCorrection,
  type SpeechAdapter,
  type SpeechStatus,
} from './speech';
import { shouldCommitSpeechTranscript, speechOutcomeMessageKey, voiceInputAvailable, type SpeechFeedbackKey } from './speechErrors';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  verified?: string;
  aside?: string;
  sources?: Answer['sources'];
  mode?: 'verified' | 'model';
  basis?: 'knowledge' | 'live';
  tone?: 'error';
  /** Tappable follow-up questions shown under the latest answer. */
  suggestions?: string[];
}

const STARTERS: Array<{ icon: IconName; key: 'business' | 'reorder' | 'grow' | 'debts' }> = [
  { icon: 'chart', key: 'business' },
  { icon: 'package', key: 'reorder' },
  { icon: 'arrowUp', key: 'grow' },
  { icon: 'users', key: 'debts' },
];

function readHistory(key: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ChatMessage => !!item && typeof item === 'object' && (item as ChatMessage).role !== undefined && typeof (item as ChatMessage).text === 'string')
      .slice(-30);
  } catch {
    return [];
  }
}

export function AiPanel({
  onClose,
  onRestore,
  minimized = false,
  route,
}: {
  onClose: () => void;
  onRestore?: () => void;
  minimized?: boolean;
  route: string;
}) {
  const { t, lang } = useI18n();
  const session = useSession();
  const navigate = useNavigate();
  const titleId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const pinOnShowRef = useRef(true);
  const speechRef = useRef<SpeechAdapter | null>(null);
  const draftBaseRef = useRef('');
  const pendingRef = useRef<PendingOperator | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [phrasing, setPhrasing] = useState(false);
  /** Bounded, in-panel conversation memory. Reset whenever the store or user changes. */
  const memoryRef = useRef<CopilotMemory>(emptyMemory());
  const sendingRef = useRef(false);
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>('idle');
  const [speechMessageKey, setSpeechMessageKey] = useState<SpeechFeedbackKey | null>(null);
  const [speechHint, setSpeechHint] = useState<TranslationKey | null>(null);
  // Server-enforced data path: the server picks the store (own internal demo) and refuses others.
  const readSource = useRef(serverAiReadSource(copilotRead));
  const storageKey = session.user ? conversationStorageKey(session.tenantId, session.user.uid) : null;
  // The optional llama.cpp helper only exists on a developer machine. On the live site the
  // probe is blocked by the content security policy and only fills the console with errors.
  const onDevMachine = typeof window !== 'undefined' && /^(?:localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const origin = onDevMachine ? localModelUrl(import.meta.env.VITE_ZELVERO_AI_URL) : null;
  const [historyKey, setHistoryKey] = useState(storageKey);
  const [messages, setMessages] = useState<ChatMessage[]>(() => (storageKey ? readHistory(storageKey) : []));
  const [probeOrigin, setProbeOrigin] = useState(origin);
  const [probe, setProbe] = useState<'unknown' | 'ready' | 'down'>('unknown');
  if (storageKey !== historyKey) {
    setHistoryKey(storageKey);
    setMessages([]);
    setDraft('');
    setSpeechMessageKey(null);
    setSpeechHint(null);
  }
  useEffect(() => {
    pendingRef.current = null;
    memoryRef.current = emptyMemory();
  }, [storageKey]);
  if (origin !== probeOrigin) {
    setProbeOrigin(origin);
    setProbe('unknown');
  }
  const modelState = !origin ? 'unavailable' : probe === 'ready' ? 'ready' : probe === 'down' ? 'unavailable' : 'checking';
  const listening =
    speechStatus === 'listening' ||
    speechStatus === 'processing' ||
    speechStatus === 'loading-model' ||
    speechStatus === 'transcribing';
  const engineSupported = useMemo(() => createBrowserSpeechAdapter(resolveSpeechLocale(lang)).supported, [lang]);
  const voiceChannelOff = !voiceInputAvailable(import.meta.env.VITE_APP_CHANNEL);
  const speechSupported = !voiceChannelOff && engineSupported;

  useEffect(() => {
    if (!canAccessZelveroAi(session)) {
      pendingRef.current = null;
      onClose();
    }
  }, [session, onClose]);

  useEffect(() => {
    if (minimized) return;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, minimized]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-30)));
    } catch {
      /* private mode keeps the conversation in memory only */
    }
  }, [messages, storageKey]);

  useEffect(() => {
    if (!origin) return;
    let cancel = false;
    void probeLocalModel(origin).then((ok) => {
      if (!cancel) setProbe(ok ? 'ready' : 'down');
    });
    return () => {
      cancel = true;
    };
  }, [origin]);

  useEffect(() => {
    return () => {
      speechRef.current?.cancel();
      speechRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (minimized) {
      pinOnShowRef.current = true;
      return;
    }
    const opening = pinOnShowRef.current;
    pinOnShowRef.current = false;
    if (opening) stickRef.current = true;
    if (!shouldFollowLatest({ opening, nearBottom: stickRef.current })) return;
    const pin = () => {
      const el = logRef.current;
      if (!el || !shouldFollowLatest({ opening, nearBottom: stickRef.current })) return;
      el.scrollTop = scrollTopForLatest(el);
    };
    pin();
    let second = 0;
    const first = requestAnimationFrame(() => {
      pin();
      second = requestAnimationFrame(pin);
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [messages, loading, reading, minimized]);

  function onLogScroll() {
    const el = logRef.current;
    if (!el) return;
    stickRef.current = shouldStickToBottom(el);
  }

  function pushLive(snapshot: ReadSnapshot, wording?: string, suggestions?: string[]) {
    const composed = composeLiveAnswer(presentAnswer(snapshot.text), wording ?? null);
    setMessages((current) => [
      ...current,
      {
        role: 'assistant',
        text: composed.text,
        aside: composed.wording ?? undefined,
        mode: composed.wording ? 'model' : 'verified',
        basis: 'live',
        suggestions,
      },
    ]);
  }

  function pushBrain(answer: BrainAnswer, basis: 'knowledge' | 'live') {
    setMessages((current) => [...current, { role: 'assistant', text: answer.text, mode: 'verified', basis, suggestions: answer.suggestions }]);
  }

  function readSessionNow(tenantId: string): ReadSession {
    // The store is always the signed-in session's tenant. Nothing in the question can change it.
    return { tenantId, route, isOwner: session.isOwner, can: (permission) => session.can(permission) };
  }

  async function submit(override?: string) {
    const question = (override ?? draft).trim();
    if (!question || sendingRef.current || loading || !session.user) return;
    sendingRef.current = true;
    let failed = false;
    stickRef.current = true;
    const access = assertCanAccessZelveroAi(session);
    if (!access.ok) {
      setMessages((current) => [
        ...current,
        { role: 'user', text: question },
        { role: 'assistant', text: aiAccessDeniedText(lang), mode: 'verified', basis: 'knowledge' },
      ]);
      pendingRef.current = null;
      sendingRef.current = false;
      setDraft('');
      onClose();
      return;
    }
    try {
    if (listening) {
      speechRef.current?.stop();
    }
    stickRef.current = true;
    setSpeechMessageKey(null);
    setSpeechHint(null);
    setDraft('');
    draftBaseRef.current = '';
    setMessages((current) => [...current, { role: 'user', text: question }]);
    const reply: AiLang = replyLang(question, lang);
    const now = new Date();

    // 1. Everyday conversation (greetings, thanks, "what can you do", time…). No store read.
    const talk = smallTalkReply(question, reply, now);
    if (talk) {
      memoryRef.current = rememberTurn(rememberTurn(memoryRef.current, 'user', question), 'assistant', talk);
      setMessages((current) => [...current, { role: 'assistant', text: talk, mode: 'verified', basis: 'knowledge' }]);
      return;
    }

    // 2. Zelvero AI's own understanding: store briefing, advice, one figure, one product's stock.
    const tenantId = session.tenantId;
    const intent = tenantId ? detectBrainIntent(question, lang, now) : null;
    if (tenantId && intent && (intent.kind === 'briefing' || intent.kind === 'advice' || intent.kind === 'metric' || intent.kind === 'stock')) {
      setLoading(true);
      setReading(true);
      try {
        const answer = await answerBrainIntent(intent, readSessionNow(tenantId), readSource.current, reply, now);
        memoryRef.current = rememberOther(rememberTurn(memoryRef.current, 'user', question), 'knowledge');
        memoryRef.current = rememberTurn(memoryRef.current, 'assistant', answer.text);
        pushBrain(answer, 'live');
      } catch {
        failed = true;
        const missed = reply === 'ar' ? 'ما قدرت اقرا المحل هلّق. جرّب كمان شوي.' : "I couldn't read the store just now. Please try again in a moment.";
        setMessages((current) => [...current, { role: 'assistant', text: missed, mode: 'verified', basis: 'live', tone: 'error' }]);
      } finally {
        setLoading(false);
        setReading(false);
      }
      return;
    }

    // 3. The operator: navigation, how-to guides, cart and product drafts, pending confirmations.
    setLoading(true);
    try {
      const operatorContext = {
        lang: reply,
        tenantId: session.tenantId,
        route,
        isOwner: session.isOwner,
        can: (permission: PermissionKey) => session.can(permission),
        navigate: (path: string) => {
          navigate(path);
        },
        label: (key: string) => t(key as TranslationKey),
      };
      let operated = await handleOperatorTurn(question, operatorContext, pendingRef.current);
      if (!operated.handled && intent?.kind === 'operator') {
        // Arabizi how-to ("kif ba3mel return"): same guides, read from the Arabic routing text.
        operated = await handleOperatorTurn(intent.text, { ...operatorContext, lang: 'ar' }, pendingRef.current);
      }
      pendingRef.current = operated.pending;
      if (operated.handled) {
        setMessages((current) => [...current, { role: 'assistant', text: operated.text, mode: 'verified', basis: 'knowledge' }]);
        return;
      }
    } catch {
      failed = true;
      const missed = reply === 'ar' ? 'ما تم تنفيذ الطلب. النص بقي بمربع الكتابة.' : 'The request did not finish. The text is still in the box.';
      setMessages((current) => [...current, { role: 'assistant', text: missed, mode: 'verified', basis: 'knowledge', tone: 'error' }]);
      return;
    } finally {
      setLoading(false);
    }

    // 4. The tested rule planner, on the person's words or on the brain's plain rewrite of them.
    const planText = intent?.kind === 'rewrite' ? intent.text : question;
    let turn = planTurn({ text: planText, uiLang: lang, memory: memoryRef.current, now, hasTenant: Boolean(session.tenantId) });
    if (turn.kind === 'pass' && session.tenantId && modelState === 'ready' && origin) {
      // Rules found no data read: the local model may pick ONE schema-checked, read-only tool.
      setLoading(true);
      try {
        turn = (await planWithLocalModel(origin, turn.routingText, memoryRef.current, turn.lang, now)) ?? turn;
      } finally {
        setLoading(false);
      }
    }
    memoryRef.current = rememberTurn(memoryRef.current, 'user', question);
    if (turn.kind === 'clarify' || turn.kind === 'refuse') {
      memoryRef.current = turn.kind === 'clarify' ? rememberClarify(memoryRef.current, turn.pending) : rememberOther(memoryRef.current, 'refuse');
      memoryRef.current = rememberTurn(memoryRef.current, 'assistant', turn.text);
      setMessages((current) => [...current, { role: 'assistant', text: turn.text, mode: 'verified', basis: 'knowledge' }]);
      return;
    }
    if ((turn.kind === 'read' || turn.kind === 'compare' || turn.kind === 'insight') && tenantId) {
      setLoading(true);
      setReading(true);
      try {
        const readSession = readSessionNow(tenantId);
        // Answer in the language the person wrote in, even when the planner read a rewrite.
        if (turn.kind === 'read') {
          const request = { ...turn.request, lang: reply };
          const [snapshot, nice] = await Promise.all([
            loadReadSnapshot(readSession, request, readSource.current),
            renderRead(request, readSession, readSource.current, reply, now),
          ]);
          memoryRef.current = rememberRead(memoryRef.current, request, snapshot.text);
          memoryRef.current = rememberTurn(memoryRef.current, 'assistant', snapshot.text);
          setReading(false);
          if (nice) {
            pushBrain(nice, 'live');
          } else if (snapshot.consultModel && modelState === 'ready' && origin) {
            setPhrasing(true);
            try {
              const wording = await phraseWithLocalModel(origin, question, snapshot.text, snapshot.lang, undefined, 'live');
              pushLive(snapshot, wording, suggestionsFor('read', reply));
            } catch {
              pushLive(snapshot, undefined, suggestionsFor('read', reply));
            } finally {
              setPhrasing(false);
            }
          } else {
            pushLive(snapshot, undefined, suggestionsFor('read', reply));
          }
        } else if (turn.kind === 'compare') {
          const [snapshot, nice] = await Promise.all([
            comparePeriods(readSession, turn.spec, readSource.current, reply),
            compareAnswer(turn.spec, readSession, readSource.current, reply),
          ]);
          memoryRef.current = rememberCompare(memoryRef.current, turn.spec, reply, snapshot.text);
          memoryRef.current = rememberTurn(memoryRef.current, 'assistant', snapshot.text);
          setReading(false);
          pushBrain(nice, 'live');
        } else {
          const snapshot = await runInsight(readSession, turn.spec, readSource.current, reply);
          memoryRef.current = rememberInsight(memoryRef.current, turn.spec, reply, snapshot.text);
          memoryRef.current = rememberTurn(memoryRef.current, 'assistant', snapshot.text);
          setReading(false);
          pushLive(snapshot, undefined, suggestionsFor('insight', reply));
        }
      } catch {
        failed = true;
        setReading(false);
        setPhrasing(false);
        const missed = reply === 'ar' ? 'ما قدرت اقرا المحل هلّق. ما في رقم فيني اعرضه.' : "I couldn't read the store just now. No figure is available.";
        setMessages((current) => [...current, { role: 'assistant', text: missed, mode: 'verified', basis: 'live', tone: 'error' }]);
      } finally {
        setLoading(false);
        setReading(false);
      }
      return;
    }
    memoryRef.current = rememberOther(memoryRef.current, 'knowledge');
    const asked = answerQuestion(publishedKnowledge, {
      question,
      lang: reply,
      route,
      isOwner: session.isOwner,
      isSuperAdmin: session.isSuperAdmin,
      can: (permission) => session.can(permission as PermissionKey),
    });
    if (isGenericUnsupportedAnswer(asked.text) || looksInternal(asked.text)) {
      pushBrain(missReply(reply), 'knowledge');
      return;
    }
    if (!shouldConsultModel(asked) || modelState !== 'ready' || !origin) {
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: asked.text, sources: asked.sources, mode: 'verified', basis: 'knowledge', suggestions: suggestionsFor('knowledge', reply) },
      ]);
      return;
    }
    setLoading(true);
    try {
      const wording = await phraseWithLocalModel(origin, question, asked.text, asked.lang);
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: wording, verified: asked.text, sources: asked.sources, mode: 'model', basis: 'knowledge' },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: asked.text, sources: asked.sources, mode: 'verified', basis: 'knowledge' },
      ]);
    } finally {
      setLoading(false);
    }
    } finally {
      sendingRef.current = false;
      if (failed) {
        // Keep what the person typed so they can try again.
        setDraft(question);
        draftBaseRef.current = question;
      }
    }
  }

  function newChat() {
    setMessages([]);
    setDraft('');
    pendingRef.current = null;
    memoryRef.current = emptyMemory();
    inputRef.current?.focus();
  }

  async function toggleVoice() {
    setSpeechMessageKey(null);
    setSpeechHint(null);
    if (listening) {
      speechRef.current?.stop();
      return;
    }
    if (voiceChannelOff) {
      setSpeechStatus('unsupported');
      setSpeechMessageKey('ai.voiceDisabled');
      return;
    }
    const adapter = createBrowserSpeechAdapter(resolveSpeechLocale(lang));
    if (!adapter.supported) {
      setSpeechStatus('unsupported');
      setSpeechMessageKey('ai.speechUnsupported');
      return;
    }
    speechRef.current?.cancel();
    speechRef.current = adapter;
    const originalDraft = draft;
    draftBaseRef.current = originalDraft;
    setSpeechStatus('listening');
    try {
      await adapter.start(
        (result) => {
          setSpeechStatus(result.isFinal ? 'processing' : 'listening');
        },
        (outcome) => {
          setSpeechStatus(outcome.status === 'idle' ? 'idle' : outcome.status);
          const key = speechOutcomeMessageKey(outcome);
          if (shouldCommitSpeechTranscript(outcome)) {
            const next = `${originalDraft.trim() ? `${originalDraft.trim()} ` : ''}${outcome.lastTranscript}`.trim();
            draftBaseRef.current = next;
            setDraft(next);
            setSpeechMessageKey(null);
            if (transcriptMayNeedArabicCorrection(outcome.lastTranscript, lang)) {
              setSpeechHint('ai.speechDialectUnverified');
            }
          } else {
            draftBaseRef.current = originalDraft;
            setSpeechHint(null);
            setSpeechMessageKey(outcome.reason === 'aborted' ? null : (key ?? 'ai.speechError'));
          }
          inputRef.current?.focus();
        },
        (nextStatus) => {
          setSpeechStatus(nextStatus);
          if (nextStatus === 'loading-model') setSpeechMessageKey('ai.speechLoadingModel');
          else if (nextStatus === 'transcribing') setSpeechMessageKey('ai.speechTranscribing');
          else if (nextStatus === 'listening') setSpeechMessageKey(null);
        },
      );
    } catch {
      setSpeechStatus(adapter.status === 'unsupported' ? 'unsupported' : 'error');
      setSpeechMessageKey(adapter.status === 'unsupported' ? 'ai.speechUnsupported' : 'ai.speechError');
    }
  }

  const layerClass = aiLayerClassNames(minimized ? 'minimized' : 'open', lang === 'ar').join(' ');
  const lastIndex = messages.length - 1;
  const busyText = reading ? t('ai.reading') : phrasing ? t('ai.thinking') : t('ai.working');

  if (minimized) {
    return (
      <div className={layerClass}>
        <button type="button" className="ai-dock-chip" onClick={() => onRestore?.()}>
          <span className="ai-avatar ai-avatar--sm" aria-hidden="true">Z</span>
          <span className="ai-dock-chip__title">{t('ai.title')}</span>
          <span className="ai-dock-chip__action">{t('ai.restore')}</span>
        </button>
      </div>
    );
  }

  return (
    <div className={layerClass}>
      <button
        type="button"
        className="ai-backdrop ai-backdrop--dock"
        aria-label={t('ai.close')}
        onClick={onClose}
      />
      <section className="ai-panel ai-panel--docked" role="complementary" aria-labelledby={titleId}>
        <header className="ai-panel__head">
          <div className="ai-panel__brand">
            <span className="ai-avatar" aria-hidden="true">Z</span>
            <div>
              <h2 id={titleId}>{t('ai.title')}</h2>
              <p className="ai-panel__tagline">{t('ai.tagline')}</p>
            </div>
          </div>
          <div className="ai-panel__head-actions">
            {messages.length > 0 && (
              <button type="button" className="ai-icon-btn" onClick={newChat} aria-label={t('ai.newChat')} title={t('ai.newChat')}>
                <Icon name="plus" size={18} />
              </button>
            )}
            <button type="button" className="ai-icon-btn" onClick={onClose} aria-label={t('ai.close')} title={t('ai.close')}>
              <Icon name="x" size={18} />
            </button>
          </div>
        </header>
        <div className="ai-panel__log" ref={logRef} onScroll={onLogScroll} aria-live="polite">
          {messages.length === 0 && (
            <div className="ai-welcome">
              <span className="ai-avatar ai-avatar--lg" aria-hidden="true">Z</span>
              <h3 className="ai-welcome__title">{t('ai.greeting')}</h3>
              <p className="ai-welcome__sub">{t('ai.greetingSub')}</p>
              <div className="ai-starters">
                {STARTERS.map((starter) => (
                  <button
                    key={starter.key}
                    type="button"
                    className="ai-starter"
                    disabled={loading}
                    onClick={() => void submit(t(`ai.starter.${starter.key}` as TranslationKey))}
                  >
                    <span className="ai-starter__icon" aria-hidden="true">
                      <Icon name={starter.icon} size={16} />
                    </span>
                    <span className="ai-starter__label">{t(`ai.starter.${starter.key}` as TranslationKey)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message, index) =>
            message.role === 'user' ? (
              <article key={`user-${index}`} className="ai-msg ai-msg--user">
                <p className="ai-msg__text">{message.text}</p>
              </article>
            ) : (
              <article key={`assistant-${index}`} className={message.tone === 'error' ? 'ai-msg ai-msg--bot ai-msg--error' : 'ai-msg ai-msg--bot'}>
                <span className="ai-avatar ai-avatar--sm" aria-hidden="true">Z</span>
                <div className="ai-msg__body">
                  <AiMessageText text={message.text} />
                  {message.aside && (
                    <div className="ai-msg__aside">
                      <p className="ai-msg__tag">{t('ai.wording')}</p>
                      <AiMessageText text={message.aside} />
                    </div>
                  )}
                  {message.verified && (
                    <div className="ai-msg__aside">
                      <p className="ai-msg__tag">{t('ai.verified')}</p>
                      <AiMessageText text={message.verified} />
                    </div>
                  )}
                  <div className="ai-msg__meta">
                    {message.basis === 'live' && message.tone !== 'error' && (
                      <span className="ai-msg__badge">
                        <Icon name="shield" size={12} />
                        {t('ai.fromStore')}
                      </span>
                    )}
                    <CopyButton text={message.text} label={t('ai.copy')} done={t('ai.copied')} />
                  </div>
                  {index === lastIndex && !loading && message.suggestions && message.suggestions.length > 0 && (
                    <div className="ai-chips">
                      {message.suggestions.map((suggestion) => (
                        <button key={suggestion} type="button" className="ai-chip" onClick={() => void submit(suggestion)}>
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ),
          )}
          {loading && (
            <div className="ai-msg ai-msg--bot ai-msg--typing" role="status">
              <span className="ai-avatar ai-avatar--sm" aria-hidden="true">Z</span>
              <div className="ai-typing">
                <span className="ai-typing__dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="ai-typing__text">{busyText}</span>
              </div>
            </div>
          )}
          <div className="ai-panel__bottom" aria-hidden="true" />
        </div>
        <form
          className="ai-panel__form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {listening && (
            <p className="ai-panel__status" role="status">
              {speechStatus === 'loading-model'
                ? t('ai.speechLoadingModel')
                : speechStatus === 'transcribing'
                  ? t('ai.speechTranscribing')
                  : speechStatus === 'processing'
                    ? t('ai.speechProcessing')
                    : t('ai.listening')}
            </p>
          )}
          {speechMessageKey && (
            <p className="ai-panel__status" role="alert">
              {t(speechMessageKey)}
            </p>
          )}
          {speechHint && (
            <p className="ai-panel__status" role="status">
              {t(speechHint)}
            </p>
          )}
          <div className={listening ? 'ai-composer ai-composer--listening' : 'ai-composer'}>
            <textarea
              ref={inputRef}
              name="zelvero-ai-question"
              value={draft}
              rows={1}
              placeholder={t('ai.placeholder')}
              autoComplete="off"
              dir="auto"
              onChange={(event) => {
                setDraft(event.target.value);
                const el = event.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="ai-composer__actions">
              <button
                type="button"
                className={listening ? 'ai-icon-btn ai-icon-btn--active' : 'ai-icon-btn'}
                aria-pressed={listening}
                disabled={!speechSupported}
                aria-label={speechSupported ? (listening ? t('ai.stopListening') : t('ai.pushToTalk')) : voiceChannelOff ? t('ai.voiceDisabled') : t('ai.speechUnsupported')}
                title={speechSupported ? (listening ? t('ai.stopListening') : t('ai.pushToTalk')) : voiceChannelOff ? t('ai.voiceDisabled') : t('ai.speechUnsupported')}
                onClick={() => void toggleVoice()}
              >
                <Icon name="mic" size={18} />
              </button>
              <button type="submit" className="ai-send" disabled={loading || draft.trim() === ''} aria-label={t('ai.send')} title={t('ai.send')}>
                <Icon name="arrowUp" size={18} />
              </button>
            </div>
          </div>
          <p className="ai-panel__foot">{t('ai.footnote')}</p>
        </form>
      </section>
    </div>
  );
}

function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ai-msg__copy"
      onClick={() => {
        const plain = text.replace(/\*\*/g, '').replace(/^_(.+)_$/gm, '$1').replace(/[\u2066-\u2069]/g, '');
        void navigator.clipboard?.writeText(plain).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        );
      }}
    >
      <Icon name={copied ? 'check' : 'clipboard'} size={12} />
      {copied ? done : label}
    </button>
  );
}
