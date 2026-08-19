"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser dictation via the Web Speech API — no dependency, no audio upload.
 * Unsupported browsers report `supported: false` so the caller can hide the
 * control rather than offer something that cannot work.
 *
 * Refinement happens in `/api/refine`, which applies the mode saved in
 * Settings → Behavior. "No refinement" returns the transcript untouched.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation({
  refine,
  onText,
}: {
  /** False for "No refinement": the raw transcript is inserted as-is. */
  refine: boolean;
  onText: (text: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const transcript = useRef("");
  const cancelled = useRef(false);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => recognition.current?.abort();
  }, []);

  const finish = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;

      if (!refine) {
        onText(clean);
        return;
      }

      setRefining(true);
      try {
        const res = await fetch("/api/refine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean }),
        });
        const data = await res.json().catch(() => null);
        // The route returns the raw text when refinement is unavailable.
        onText(data?.text?.trim() || clean);
        if (data?.error) setError(data.error);
      } catch (err) {
        console.error("[ugnay] Refinement failed:", err);
        onText(clean);
      } finally {
        setRefining(false);
      }
    },
    [refine, onText],
  );

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    setError(null);
    transcript.current = "";
    cancelled.current = false;

    const instance = new Ctor();
    instance.lang = navigator.language || "en-US";
    instance.continuous = true;
    instance.interimResults = false;

    instance.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) transcript.current += event.results[i][0].transcript;
      }
    };

    instance.onerror = (event: any) => {
      // "not-allowed" means the microphone permission was denied or dismissed.
      setError(
        event?.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in your browser's site settings."
          : "Dictation stopped unexpectedly.",
      );
      setListening(false);
    };

    instance.onend = () => {
      setListening(false);
      recognition.current = null;
      if (!cancelled.current) void finish(transcript.current);
    };

    recognition.current = instance;
    setListening(true);
    instance.start();
  }, [finish]);

  /** Stop and keep what was heard. */
  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  /** Stop and discard the transcript. */
  const cancel = useCallback(() => {
    cancelled.current = true;
    recognition.current?.abort();
    setListening(false);
  }, []);

  return { supported, listening, refining, error, start, stop, cancel };
}
