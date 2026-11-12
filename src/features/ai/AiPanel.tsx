import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/contexts/session';
import type { PermissionKey } from '@/constants/permissions';
import { useI18n, type TranslationKey } from '@/i18n/i18n';
import { handleOperatorTurn, type PendingOperator } from './actions/operator';
import { aiAccessDeniedText, assertCanAccessZelveroAi, canAccessZelveroAi } from './aiAccess';
import { aiLayerClassNames } from './aiDock';
import { publishedKnowledge } from './catalog';
import { scrollTopForLatest, shouldFollowLatest, shouldStickToBottom } from './chatScroll';
import { answerQuestion, conversationStorageKey, shouldConsultModel, type Answer } from './engine';
import { greetingReply, isGenericUnsupportedAnswer, replyLanguage } from './fallbackAnswer';
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
}

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
  const origin = localModelUrl(import.meta.env.VITE_ZELVERO_AI_URL);
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
    pendingRef.current = null;
    memoryRef.current = emptyMemory();
  }
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

  function pushLive(snapshot: ReadSnapshot, wording?: string) {
    const composed = composeLiveAnswer(snapshot.text, wording ?? null);
    setMessages((current) => [
      ...current,
      {
        role: 'assistant',
        text: composed.text,
        aside: composed.wording ?? undefined,
        mode: composed.wording ? 'model' : 'verified',
        basis: 'live',
      },
    ]);
  }

  async function submit() {
    const question = draft.trim();
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
    setMessages((current) => [...current, { role: 'user', text: question }]);
    const reply = replyLanguage(question, lang);
    const hello = greetingReply(question, reply);
    if (hello) {
      setMessages((current) => [...current, { role: 'assistant', text: hello, mode: 'verified', basis: 'knowledge' }]);
      return;
    }

    setLoading(true);
    try {
      const operated = await handleOperatorTurn(
        question,
        {
          lang: reply,
          tenantId: session.tenantId,
          route,
          isOwner: session.isOwner,
          can: (permission) => session.can(permission),
          navigate: (path) => {
            navigate(path);
          },
          label: (key) => t(key as TranslationKey),
        },
        pendingRef.current,
      );
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

    let turn = planTurn({ text: question, uiLang: lang, memory: memoryRef.current, now: new Date(), hasTenant: Boolean(session.tenantId) });
    if (turn.kind === 'pass' && session.tenantId && modelState === 'ready' && origin) {
      // Rules found no data read: the local model may pick ONE schema-checked, read-only tool.
      setLoading(true);
      try {
        turn = (await planWithLocalModel(origin, turn.routingText, memoryRef.current, turn.lang, new Date())) ?? turn;
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
    if ((turn.kind === 'read' || turn.kind === 'compare' || turn.kind === 'insight') && session.tenantId) {
      setLoading(true);
      setReading(true);
      try {
        // The store is always the signed-in session's tenant. Nothing in the question can change it.
        const readSession: ReadSession = { tenantId: session.tenantId, route, isOwner: session.isOwner, can: (permission) => session.can(permission) };
        const snapshot: ReadSnapshot =
          turn.kind === 'read'
            ? await loadReadSnapshot(readSession, turn.request, readSource.current)
            : turn.kind === 'compare'
              ? await comparePeriods(readSession, turn.spec, readSource.current, turn.lang)
              : await runInsight(readSession, turn.spec, readSource.current, turn.lang);
        memoryRef.current =
          turn.kind === 'read'
            ? rememberRead(memoryRef.current, turn.request, snapshot.text)
            : turn.kind === 'compare'
              ? rememberCompare(memoryRef.current, turn.spec, turn.lang, snapshot.text)
              : rememberInsight(memoryRef.current, turn.spec, turn.lang, snapshot.text);
        memoryRef.current = rememberTurn(memoryRef.current, 'assistant', snapshot.text);
        setReading(false);
        if (snapshot.consultModel && modelState === 'ready' && origin) {
          setPhrasing(true);
          try {
            const wording = await phraseWithLocalModel(origin, question, snapshot.text, snapshot.lang, undefined, 'live');
            pushLive(snapshot, wording);
          } catch {
            pushLive(snapshot);
          } finally {
            setPhrasing(false);
          }
        } else {
          pushLive(snapshot);
        }
      } catch {
        failed = true;
        setReading(false);
        setPhrasing(false);
        const missed = turn.lang === 'ar' ? 'تعذّرت قراءة المتجر. لا يوجد رقم يمكن عرضه.' : 'The store could not be read. No figure is available.';
        setMessages((current) => [...current, { role: 'assistant', text: missed, mode: 'verified', basis: 'live', tone: 'error' }]);
      } finally {
        setLoading(false);
        setReading(false);
      }
      return;
    }
    memoryRef.current = rememberOther(memoryRef.current, 'knowledge');
    if (/high\s+stock|low\s+sales|overstock|reorder|which products|hasn'?t sold|losing popularity|days of (?:stock|cover)|gross profit/i.test(question)) {
      const unmet = reply === 'ar'
        ? 'هالسؤال بده مقارنة مخزون بمبيعات كل منتج. ما بفتح صفحة المنتجات، وما في رقم تغطية محسوب بهالجواب.'
        : 'This asks for a product-by-product stock and sales comparison. Products is not opened, and days of cover are not calculated in this answer.';
      setMessages((current) => [...current, { role: 'assistant', text: unmet, mode: 'verified', basis: 'knowledge' }]);
      return;
    }
    const asked = answerQuestion(publishedKnowledge, {
      question,
      lang: reply,
      route,
      isOwner: session.isOwner,
      isSuperAdmin: session.isSuperAdmin,
      can: (permission) => session.can(permission as PermissionKey),
    });
    const safeText = isGenericUnsupportedAnswer(asked.text)
      ? reply === 'ar'
        ? 'بساعد ضمن Zelvero POS: الشاشات، الصلاحيات، خطوات العمل، والتنقّل. شو بدك تعمل أو تعرف؟'
        : 'I help with Zelvero POS screens, permissions, workflows, and navigation. What do you want to do or know?'
      : asked.text;
    if (!shouldConsultModel(asked) || modelState !== 'ready' || !origin) {
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: safeText, sources: asked.sources, mode: 'verified', basis: 'knowledge' },
      ]);
      return;
    }
    setLoading(true);
    try {
      const wording = await phraseWithLocalModel(origin, question, safeText, asked.lang);
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: wording, verified: safeText, sources: asked.sources, mode: 'model', basis: 'knowledge' },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: safeText, sources: asked.sources, mode: 'verified', basis: 'knowledge' },
      ]);
    } finally {
      setLoading(false);
    }
    } finally {
      sendingRef.current = false;
      if (!failed) {
        setDraft('');
        draftBaseRef.current = '';
      }
    }
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

  if (minimized) {
    return (
      <div className={layerClass}>
        <button type="button" className="ai-dock-chip" onClick={() => onRestore?.()}>
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
          <div>
            <h2 id={titleId}>{t('ai.title')}</h2>
          </div>
          <div className="ai-panel__head-actions">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('ai.close')}
            </Button>
          </div>
        </header>
        <div className="ai-panel__log" ref={logRef} onScroll={onLogScroll}>
          {messages.length === 0 && <p className="ai-panel__empty">{t('ai.empty')}</p>}
          {messages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={message.role === 'user' ? 'ai-msg ai-msg--user' : message.tone === 'error' ? 'ai-msg ai-msg--error' : 'ai-msg'}>
              {message.basis === 'live' && message.mode === 'model' && <p className="ai-msg__tag">{t('ai.liveData')}</p>}
              {message.basis === 'live' && message.mode !== 'model' && <p className="ai-msg__tag">{t('ai.liveVerified')}</p>}
              {message.mode === 'model' && message.basis !== 'live' && <p className="ai-msg__tag">{t('ai.wording')}</p>}
              <p className="ai-msg__text">{message.text}</p>
              {message.aside && (
                <>
                  <p className="ai-msg__tag">{t('ai.wording')}</p>
                  <p className="ai-msg__text">{message.aside}</p>
                </>
              )}
              {message.verified && (
                <>
                  <p className="ai-msg__tag">{t('ai.verified')}</p>
                  <p className="ai-msg__text">{message.verified}</p>
                </>
              )}
              {message.sources && message.sources.length > 0 && (
                <ul className="ai-sources">
                  {message.sources.map((source) => (
                    <li key={source.id}>
                      {t('ai.sources')}: {source.path}:{source.startLine}-{source.endLine} ({source.symbol})
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
          {reading && <p className="ai-panel__status" role="status">{t('ai.reading')}</p>}
          {phrasing && <p className="ai-panel__status" role="status">{t('ai.thinking')}</p>}
          {loading && !reading && !phrasing && <p className="ai-panel__status" role="status">{t('ai.working')}</p>}
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
          <div className="ai-panel__composer">
            <textarea
              ref={inputRef}
              name="zelvero-ai-question"
              value={draft}
              rows={2}
              placeholder={t('ai.placeholder')}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <Button
              type="button"
              variant={listening ? 'primary' : 'secondary'}
              size="sm"
              icon="mic"
              aria-pressed={listening}
              disabled={!speechSupported}
              aria-label={speechSupported ? (listening ? t('ai.stopListening') : t('ai.pushToTalk')) : voiceChannelOff ? t('ai.voiceDisabled') : t('ai.speechUnsupported')}
              title={speechSupported ? undefined : voiceChannelOff ? t('ai.voiceDisabled') : t('ai.speechUnsupported')}
              onClick={() => void toggleVoice()}
            >
              {speechSupported ? (listening ? t('ai.stopListening') : t('ai.pushToTalk')) : t('ai.voiceOff')}
            </Button>
            <Button type="submit" icon="send" disabled={loading || draft.trim() === ''}>
              {t('ai.send')}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
