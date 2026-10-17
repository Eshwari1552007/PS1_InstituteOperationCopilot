import { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Bot, LoaderCircle, RotateCcw, Send, Sparkles } from 'lucide-react';
import { auth } from '../firebase';
import './copilot.css';

const SUGGESTIONS = {
  OWNER: ['How many students are enrolled?', 'Which batches have fewer students?', 'Show pending fees', 'Which batches have incomplete weekly teaching hours?', 'What needs my attention?'],
  COUNSELOR: ['How many students are enrolled?', 'Which batches have fewer students?', 'Which students need follow-up?', 'What needs my attention?'],
  TRAINER: ['Show my assigned batches', 'Which batches have incomplete weekly teaching hours?', 'Show my timetable', 'Summarize attendance'],
  ACCOUNTS: ['Show pending fees', 'Summarize recorded payments', 'What needs my attention?'],
  STUDENT: ['Show my timetable', 'Summarize my attendance', 'Show my pending fees', 'Show my enrollments'],
};

const firstMessage = {
  role: 'assistant',
  content: 'Ask a question about your EDUPILOT workspace. The AI helps interpret your question, while figures are calculated from records your role is allowed to access. This assistant is read-only.',
};

export default function Copilot({ profile, onNavigate }) {
  const [messages, setMessages] = useState([firstMessage]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const suggestions = useMemo(() => SUGGESTIONS[profile.role] || [], [profile.role]);

  const ask = async (input = text, { retry = false } = {}) => {
    const question = String(input || '').trim();
    if (!question || busy) return;
    setBusy(true); setError(''); setText('');
    let historyItems = messages.filter((item) => item.role !== 'assistant' || item !== firstMessage);
    if (retry) {
      let lastUserIndex = -1;
      for (let index = historyItems.length - 1; index >= 0; index -= 1) {
        if (historyItems[index].role === 'user') { lastUserIndex = index; break; }
      }
      if (lastUserIndex >= 0) historyItems = historyItems.filter((_, index) => index !== lastUserIndex);
    }
    const history = historyItems.slice(-8).map((item) => ({
      role: item.role,
      content: item.role === 'user' ? item.content : (item.verifiedAnswer || item.answer || item.content || ''),
    }));
    if (!retry) setMessages((current) => [...current, { role: 'user', content: question }]);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Your sign-in expired. Sign in again and retry.');
      const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/copilot/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: question, history }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Copilot could not complete that request.');
      setMessages((current) => [...current, { role: 'assistant', ...result }]);
    } catch (failure) { setError(failure.message || 'Copilot could not reach EDUPILOT. Retry when your connection is available.'); }
    finally { setBusy(false); }
  };

  return <section className="ep-copilot">
    <header className="ep-copilot__header"><div className="ep-copilot__mark"><Sparkles size={20}/></div><div><p className="ep-eyebrow">EDUPILOT · VERIFIED DATA</p><h1>AI Copilot</h1><p>Ask questions about records available to your {profile.role.toLowerCase()} account.</p></div></header>
    <div className="ep-copilot__scope"><Bot size={16}/><span>Read-only assistant · signed in as <strong>{profile.name || profile.email || profile.role}</strong> · only authorized EDUPILOT records are queried. Your question and a minimized summary may be sent to configured AI providers in fallback order; raw Firestore documents are not sent. Do not enter passwords, API keys, or secrets.</span></div>
    <div className="ep-copilot__conversation" aria-live="polite" aria-label="Copilot conversation">
      {messages.map((message, index) => <article className={`ep-copilot__message ep-copilot__message--${message.role}`} key={`${message.role}-${index}`}>
        {message.role === 'assistant' && <span className="ep-copilot__avatar"><Bot size={16}/></span>}
        <div className="ep-copilot__bubble">
          {message.title && <strong className="ep-copilot__answer-title">{message.title}</strong>}
          {message.content && <p>{message.content}</p>}
          {message.answer && <div className="ep-copilot__answer">{message.answer.split('\n').map((line, lineIndex) => line ? <p key={lineIndex}>{line}</p> : <br key={lineIndex}/>)}</div>}
          {message.providerLabel && <span className="ep-copilot__provider">Generated with {message.providerLabel}</span>}
          {message.verifiedAnswer && message.verifiedAnswer !== message.answer && <details className="ep-copilot__verified"><summary>Verified figures and source</summary><div className="ep-copilot__answer">{message.verifiedAnswer.split('\n').map((line, lineIndex) => line ? <p key={lineIndex}>{line}</p> : <br key={lineIndex}/>)}</div></details>}
          {!!message.truncated?.length && <small>Some records exceeded the safe query limit. The figures may be incomplete; narrow the question or ask an administrator to review the dataset.</small>}
          {message.links?.length > 0 && <div className="ep-copilot__links">{message.links.map((link) => <button key={link.route} type="button" onClick={() => onNavigate(link.route)}>{link.label}<ArrowRight size={14}/></button>)}</div>}
        </div>
      </article>)}
      {busy && <div className="ep-copilot__processing"><LoaderCircle size={16} className="ep-copilot__spin"/> Checking authorized records and generating an answer…</div>}
    </div>
    {error && <p className="ep-copilot__error" role="alert"><AlertCircle size={16}/>{error}<button type="button" onClick={() => { const previous = messages.filter((item) => item.role === 'user'); ask(previous[previous.length - 1]?.content, { retry: true }); }}><RotateCcw size={13}/> Retry</button></p>}
    <div className="ep-copilot__suggestions"><span>Try asking</span>{suggestions.map((suggestion) => <button type="button" key={suggestion} disabled={busy} onClick={() => ask(suggestion)}>{suggestion}</button>)}</div>
    <form className="ep-copilot__composer" onSubmit={(event) => { event.preventDefault(); ask(); }}><label className="sr-only" htmlFor="copilot-question">Ask EDUPILOT Copilot</label><input id="copilot-question" value={text} onChange={(event) => setText(event.target.value)} maxLength={500} placeholder="Ask about your EDUPILOT records…" disabled={busy}/><button type="submit" disabled={busy || !text.trim()}><Send size={16}/> Ask</button></form>
    <p className="ep-copilot__footnote">Answers use current stored data. No schedule, payment, student record, or message is changed by this assistant.</p>
  </section>;
}
