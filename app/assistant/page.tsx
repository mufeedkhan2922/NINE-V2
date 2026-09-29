"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import "./page.css";

import { Bot, Mic, MicOff, Send, ShieldCheck, Volume2, VolumeX, Activity } from "lucide-react";

type Message = { id: string; role: "user" | "assistant"; content: string; intent?: string; createdAt?: number; evidence?: Evidence[]; actionStatus?: string };
type Evidence = { label: string; value: string };
type Reply = { message: string; evidence?: Evidence[]; actionStatus?: string };

export default function NINEAssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "assistant", content: "NINE Assistant online. I’m ready." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    fetch("/api/nine/assistant?limit=20")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.messages) && data.messages.length) {
          setMessages(data.messages.map((m: any) => ({ ...m, id: String(m.id) })));
        }
      })
      .catch(() => undefined);
  }, []);

  const speak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const send = async (event?: FormEvent, forcedValue?: string) => {
    event?.preventDefault();
    const value = (forcedValue ?? input).trim();
    if (!value || busy) return;
    setInput("");
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: value }]);
    setBusy(true);
    try {
      const response = await fetch("/api/nine/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: value }),
      });
      const data = await response.json() as Reply & { ok?: boolean; error?: string };
      const content = data.message || data.error || "NINE could not complete the request.";
      setMessages((current) => [...current, { id: `reply-${Date.now()}`, role: "assistant", content, evidence: data.evidence, actionStatus: data.actionStatus }]);
      if (data.message) speak(data.message);
    } catch {
      setMessages((current) => [...current, { id: `error-${Date.now()}`, role: "assistant", content: "Assistant connection failed. The trading engine remains isolated." }]);
    } finally {
      setBusy(false);
    }
  };

  const toggleVoice = () => {
    if (voice) {
      recognitionRef.current?.stop?.();
      recognitionRef.current = null;
      setVoice(false);
      return;
    }

    const browserWindow = window as typeof window & { webkitSpeechRecognition?: any };
    const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setMessages((current) => [...current, { id: `voice-${Date.now()}`, role: "assistant", content: "Voice input is not available in this browser. Text assistant remains available." }]);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        setInput(transcript);
        void send(undefined, transcript);
      }
    };
    recognition.onend = () => {
      setVoice(false);
      recognitionRef.current = null;
    };
    recognition.onerror = () => {
      setVoice(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    recognition.start();
    setVoice(true);
  };

  return (
    <main className="nine-assistant-page">
      <section className="nine-assistant-shell">
        <header className="nine-assistant-header">
          <div>
            <div className="nine-assistant-kicker"><Bot size={15} /> NINE PERSONAL ASSISTANT</div>
            <h1>JARVIS LAYER</h1>
            <p>Natural-language control surface for the NINE XAUUSD workstation.</p>
          </div>
          <div className="nine-assistant-security"><ShieldCheck size={15} /> SENTINEL PROTECTED</div>
        </header>

        <div className="nine-assistant-status">
          <span><Activity size={13} /> NINE CORE ONLINE</span>
          <span>TRADING: PAPER / SAFETY LOCKED</span>
          <span>AI: GEMINI SERVER-SIDE</span>
          <span>{speaking ? "VOICE OUTPUT ACTIVE" : "VOICE READY"}</span>
        </div>

        <div className="nine-assistant-messages">
          {messages.map((message) => (
            <article key={message.id} className={`nine-assistant-message ${message.role}`}>
              <span className="nine-assistant-role">{message.role === "assistant" ? "NINE" : "YOU"}</span>
              <p>{message.content}</p>
              {message.evidence?.length ? <div className="nine-assistant-evidence">{message.evidence.map((item) => <span key={`${item.label}-${item.value}`}><b>{item.label}</b> {item.value}</span>)}</div> : null}
            </article>
          ))}
          {busy && <article className="nine-assistant-message assistant"><span className="nine-assistant-role">NINE</span><p>Thinking…</p></article>}
        </div>

        <form className="nine-assistant-composer" onSubmit={send}>
          <button type="button" className={voice ? "active" : ""} onClick={toggleVoice} title="Voice input">
            {voice ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask NINE anything about the workstation…" />
          <button type="button" onClick={() => { window.speechSynthesis?.cancel(); setSpeaking(false); }} title="Stop voice output">
            {speaking ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button type="submit" disabled={busy || !input.trim()} title="Send"><Send size={18} /></button>
        </form>

        <div className="nine-assistant-suggestions">
          {["NINE status", "Paper performance", "Open positions", "Risk status", "Analyze XAUUSD", "What can you do?"].map((item) => (
            <button key={item} type="button" onClick={() => setInput(item)}>{item}</button>
          ))}
        </div>
      </section>
    </main>
  );
}
