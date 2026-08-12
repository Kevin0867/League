"use client";

import { useEffect, useRef, useState } from "react";

// A textarea with a tap-to-dictate microphone (Web Speech API). Dictated words
// are appended to whatever's already there and the coach can freely edit the
// result. Mobile-first: a big round mic tap-target. Where the browser has no
// speech API (e.g. iOS Safari), the mic hides and the phone keyboard's own
// dictation still works — nothing breaks.
export function SpeechToTextArea({
  name,
  defaultValue = "",
  rows = 4,
  placeholder,
  id,
  ariaLabel,
  className = "",
}: {
  name: string;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef(""); // committed text before the current dictation run

  useEffect(() => {
    const SR = getSR();
    if (SR) setSupported(true);
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const start = () => {
    const SR = getSR();
    if (!SR) return;
    const rec: SpeechRecognitionLike = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    baseRef.current = value ? value.replace(/\s+$/, "") + " " : "";
    rec.onresult = (e: SpeechResultEvent) => {
      let finalText = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const alt = e.results[i][0]?.transcript ?? "";
        if (e.results[i].isFinal) finalText += alt;
        else interim += alt;
      }
      if (finalText) baseRef.current = (baseRef.current + finalText).replace(/\s{2,}/g, " ") + " ";
      setValue((baseRef.current + interim).replace(/^\s+/, ""));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };

  const stop = () => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  };

  return (
    <div className={className}>
      <div className="relative">
        <textarea
          id={id}
          name={name}
          rows={rows}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="input pr-14"
        />
        {supported && (
          <button
            type="button"
            onClick={listening ? stop : start}
            aria-pressed={listening}
            aria-label={listening ? "Stop dictation" : "Dictate with your voice"}
            title={listening ? "Stop dictation" : "Dictate with your voice"}
            className={`absolute bottom-2.5 right-2.5 grid h-11 w-11 place-items-center rounded-full shadow-sm transition ${
              listening ? "animate-pulse bg-rose-600 text-white" : "bg-brand-600 text-white hover:bg-brand-700"
            }`}
          >
            <MicIcon />
          </button>
        )}
      </div>
      {supported && (
        <p className={`mt-1 text-xs ${listening ? "text-rose-600" : "text-slate-400"}`}>
          {listening ? "Listening… tap the mic to stop, then edit the text." : "Tap the mic to dictate, then edit."}
        </p>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

// Minimal typings for the Web Speech API (not in lib.dom for all targets).
type SpeechResultEvent = { resultIndex: number; results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>> };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: SpeechResultEvent) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
};
function getSR(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
