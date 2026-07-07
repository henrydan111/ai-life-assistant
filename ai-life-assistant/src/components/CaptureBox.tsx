"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Mic, Send, Square, X } from "lucide-react";
import type { AssistantItemRef, ParseFeedback } from "@/types/domain";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type StreamingRequestInit = RequestInit & {
  duplex: "half";
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  detail?: string;
};

function mergeAudioChunks(chunks: Float32Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function resampleAudio(samples: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) return samples;
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const before = Math.floor(sourceIndex);
    const after = Math.min(before + 1, samples.length - 1);
    const weight = sourceIndex - before;
    output[index] = samples[before] * (1 - weight) + samples[after] * weight;
  }

  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

function encodePcm16(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function supportsStreamingUpload() {
  if (typeof ReadableStream === "undefined") return false;
  try {
    new Request("/api/ai/asr-stream", {
      method: "POST",
      body: new ReadableStream(),
      duplex: "half"
    } as StreamingRequestInit);
    return true;
  } catch {
    return false;
  }
}

export function CaptureBox({
  onSubmit,
  conversationTarget,
  onClearConversationTarget
}: {
  onSubmit: (text: string, inputType?: "text" | "voice") => ParseFeedback | Promise<ParseFeedback>;
  feedback?: ParseFeedback;
  conversationTarget?: AssistantItemRef;
  onClearConversationTarget?: () => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Float32Array[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const streamControllerRef = useRef<ReadableStreamDefaultController<Uint8Array> | null>(null);
  const streamingTranscriptRef = useRef<Promise<string | undefined> | null>(null);
  const streamingSupportedRef = useRef(false);
  const [supportsSpeech, setSupportsSpeech] = useState(false);
  const [listening, setListening] = useState(false);
  const [recognition, setRecognition] = useState<SpeechRecognitionLike | null>(null);
  const textareaId = useId();
  const textareaDescriptionId = useId();
  const speechStatusId = useId();

  useEffect(() => {
    const win = window as unknown as AudioWindow & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    const AudioContextCtor = window.AudioContext ?? win.webkitAudioContext;
    streamingSupportedRef.current = supportsStreamingUpload();
    setSupportsSpeech(Boolean(navigator.mediaDevices && "getUserMedia" in navigator.mediaDevices && AudioContextCtor) || Boolean(Ctor));
    if (!Ctor) return;
    const instance = new Ctor();
    instance.lang = "zh-CN";
    instance.interimResults = true;
    instance.continuous = false;
    instance.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join("");
      setText(transcript);
    };
    instance.onend = () => setListening(false);
    setRecognition(instance);
  }, []);

  useEffect(() => {
    if (!conversationTarget) return;
    setText("");
    setSpeechStatus(undefined);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [conversationTarget]);

  async function submit(inputType: "text" | "voice" = "text", overrideText = text) {
    const value = overrideText.trim();
    if (!value || submitting) return;
    const timestamp = Date.now();
    setSubmitting(true);
    setText("");
    setMessages((current) => [
      ...current,
      {
        id: `user-${timestamp}`,
        role: "user",
        body: value
      }
    ]);
    try {
      const result = await onSubmit(value, inputType);
      const assistantBody = [result.title, result.detail, result.question].filter(Boolean).join("\n");
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${timestamp}`,
          role: "assistant",
          body: assistantBody,
          detail: result.question
        }
      ]);
    } catch (error) {
      const errorText = error instanceof Error && error.message && !/failed to fetch/i.test(error.message)
        ? error.message
        : "AI 解析失败，未保存这次输入。请稍后重试。";
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${timestamp}`,
          role: "assistant",
          body: errorText
        }
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  async function transcribeAudio(blob: Blob) {
    const formData = new FormData();
    formData.append("audio", blob, "voice-input.wav");
    const response = await fetch("/api/ai/asr", {
      method: "POST",
      body: formData
    });
    const payload = (await response.json()) as { transcript?: string; error?: string };
    if (!response.ok || !payload.transcript) {
      throw new Error(payload.error ?? "Speech recognition failed.");
    }
    return payload.transcript;
  }

  function startStreamingTranscription() {
    if (!streamingSupportedRef.current) return false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamControllerRef.current = controller;
      },
      cancel() {
        streamControllerRef.current = null;
      }
    });

    try {
      streamingTranscriptRef.current = fetch("/api/ai/asr-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Audio-Format": "pcm",
          "X-Audio-Sample-Rate": "16000"
        },
        body: stream,
        duplex: "half"
      } as StreamingRequestInit)
        .then(async (response) => {
          const payload = (await response.json()) as { transcript?: string; error?: string };
          if (!response.ok || !payload.transcript) {
            throw new Error(payload.error ?? "Streaming speech recognition failed.");
          }
          return payload.transcript;
        })
        .catch(() => {
          streamControllerRef.current = null;
          streamingSupportedRef.current = false;
          return undefined;
        });
    } catch {
      streamControllerRef.current = null;
      streamingTranscriptRef.current = null;
      streamingSupportedRef.current = false;
      return false;
    }

    return true;
  }

  function enqueueStreamingAudio(samples: Float32Array, sampleRate: number) {
    const controller = streamControllerRef.current;
    if (!controller) return;
    try {
      controller.enqueue(encodePcm16(resampleAudio(samples, sampleRate, 16000)));
    } catch {
      streamControllerRef.current = null;
    }
  }

  function finishStreamingTranscription() {
    const controller = streamControllerRef.current;
    streamControllerRef.current = null;
    if (!controller) return;
    try {
      controller.close();
    } catch {
      // The fetch stream may already be closed if the browser or server aborted it.
    }
  }

  async function transcribeBufferedAudio(sampleRate: number) {
    const samples = mergeAudioChunks(audioChunksRef.current);
    if (!samples.length) throw new Error("No voice input was captured.");
    const wavBlob = encodeWav(resampleAudio(samples, sampleRate, 16000), 16000);
    return transcribeAudio(wavBlob);
  }

  async function startRecording() {
    setSpeechStatus(undefined);
    const win = window as unknown as AudioWindow;
    const AudioContextCtor = window.AudioContext ?? win.webkitAudioContext;
    if (!AudioContextCtor) throw new Error("Audio recording is unavailable in this browser.");

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    streamRef.current = stream;
    audioContextRef.current = audioContext;
    audioSourceRef.current = source;
    audioProcessorRef.current = processor;
    silentGainRef.current = silentGain;
    audioChunksRef.current = [];
    startStreamingTranscription();

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const samples = new Float32Array(input);
      audioChunksRef.current.push(samples);
      enqueueStreamingAudio(samples, audioContext.sampleRate);
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    setRecording(true);
  }

  async function stopRecording() {
    if (!recording || speechBusy) return;

    setRecording(false);
    setSpeechBusy(true);

    const audioContext = audioContextRef.current;
    const sampleRate = audioContext?.sampleRate ?? 48000;

    audioProcessorRef.current?.disconnect();
    audioSourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    audioProcessorRef.current = null;
    audioSourceRef.current = null;
    silentGainRef.current = null;
    finishStreamingTranscription();

    try {
      await audioContext?.close();
      const streamingTranscript = streamingTranscriptRef.current ? await streamingTranscriptRef.current : undefined;
      const transcript = streamingTranscript?.trim() || (await transcribeBufferedAudio(sampleRate));
      setText(transcript);
      await submit("voice", transcript);
    } catch (error) {
      setSpeechStatus(error instanceof Error ? error.message : "Speech recognition failed.");
    } finally {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      audioContextRef.current = null;
      audioChunksRef.current = [];
      streamingTranscriptRef.current = null;
      streamControllerRef.current = null;
      setSpeechBusy(false);
    }
  }

  async function toggleSpeech() {
    if (recording) {
      await stopRecording();
      return;
    }

    if (supportsSpeech) {
      try {
        await startRecording();
        return;
      } catch (error) {
        setSpeechStatus(error instanceof Error ? error.message : "Could not start recording.");
      }
    }

    if (!recognition) return;
    if (listening) {
      recognition.stop();
      setListening(false);
      return;
    }
    setListening(true);
    recognition.start();
  }

  const voiceLabel = recording || listening ? "停止语音输入" : "开始语音输入";
  const voiceState = recording || listening ? "正在实时识别" : speechBusy ? "正在收尾" : "点按开始说话";
  const hasChat = messages.length > 0;

  return (
    <section className={hasChat ? "voice-card capture-panel has-chat" : "voice-card capture-panel"} aria-labelledby={`${textareaId}-heading`} aria-busy={submitting || speechBusy}>
      <div className="voice-intro">
        <p className="eyebrow">Voice first</p>
        <h1 id={`${textareaId}-heading`} className="voice-title">
          说出来就好
        </h1>
        <p className="voice-subtitle">我会把它整理成待办、日程、问题或下一步</p>
      </div>

      <div className="voice-orb-wrap">
        <button
          className={recording || listening ? "voice-orb recording" : "voice-orb"}
          type="button"
          onClick={() => void toggleSpeech()}
          disabled={speechBusy || submitting || (!supportsSpeech && !recognition)}
          aria-label={voiceLabel}
          aria-pressed={recording || listening}
        >
          {recording || listening ? <Square size={42} aria-hidden="true" /> : <Mic size={48} aria-hidden="true" />}
        </button>
        <p className="voice-state">{voiceState}</p>
      </div>

      {messages.length > 0 ? (
        <div className="chat-thread" role="log" aria-live="polite" aria-label="Conversation">
          {messages.map((message) => (
            <article className={message.role === "user" ? "chat-message user" : "chat-message assistant"} key={message.id}>
              <span className="chat-role">{message.role === "user" ? "你" : "助手"}</span>
              <p>{message.body}</p>
            </article>
          ))}
        </div>
      ) : null}

      <div className="voice-composer">
        <label className="sr-only" htmlFor={textareaId}>
          Life input
        </label>
        <p id={textareaDescriptionId} className="sr-only">
          Add a task, event, shopping item, check-in, or note.
        </p>
        {conversationTarget ? (
          <div className="update-target" role="status">
            <div>
              <span>正在更新</span>
              <strong>{conversationTarget.title}</strong>
            </div>
            {onClearConversationTarget ? (
              <button className="icon-button compact" type="button" onClick={onClearConversationTarget} aria-label="退出事项更新">
                <X size={15} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          id={textareaId}
          className="capture-textarea voice-textarea"
          value={text}
          placeholder={conversationTarget ? "说出变化，例如：改到周五、标记完成、改成请假两天..." : "也可以打字，例如：明天下午提醒我整理方案..."}
          aria-describedby={textareaDescriptionId}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit("text");
          }}
        />
        <div className="voice-composer-actions">
          <button className="text-button primary" type="button" onClick={() => void submit("text")} disabled={!text.trim() || submitting}>
            <Send size={17} aria-hidden="true" />
            {submitting ? "发送中" : "发送"}
          </button>
        </div>
      </div>
      {speechStatus ? (
        <p id={speechStatusId} className="state-line voice-status" role="status" aria-live="polite">
          {speechStatus}
        </p>
      ) : null}
    </section>
  );
}
