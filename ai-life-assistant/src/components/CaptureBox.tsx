"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Keyboard, Mic, Send, Square, X } from "lucide-react";
import type {
  AiProcessingStage,
  AiProcessingStatus,
  AiProcessingUpdate,
  AssistantItemRef,
  ParseFeedback,
  TranscriptRepair
} from "@/types/domain";

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

type SubmitMetadata = {
  originalText?: string;
  transcriptRepair?: TranscriptRepair;
};

type TranscriptionResult = {
  transcript: string;
  rawTranscript?: string;
  repair?: TranscriptRepair;
};

type ProcessingFlowState = {
  inputType: "text" | "voice";
  updates: Partial<Record<AiProcessingStage, AiProcessingUpdate>>;
  latest?: AiProcessingUpdate;
};

const processingStepLabels: Record<AiProcessingStage, string> = {
  speech: "语音转文字",
  transcript_repair: "转写校准",
  understanding: "理解原文",
  coverage: "检查遗漏",
  planning: "整理事项",
  saving: "保存总览",
  done: "完成"
};

const processingStageOrder: AiProcessingStage[] = ["understanding", "coverage", "planning", "saving"];
const voiceProcessingStageOrder: AiProcessingStage[] = ["speech", "transcript_repair", ...processingStageOrder];

function initialProcessingFlow(inputType: "text" | "voice"): ProcessingFlowState {
  const updates: Partial<Record<AiProcessingStage, AiProcessingUpdate>> = {};
  if (inputType === "voice") {
    updates.speech = {
      stage: "speech",
      status: "complete",
      title: "语音转文字",
      detail: "已完成语音识别。"
    };
    updates.transcript_repair = {
      stage: "transcript_repair",
      status: "complete",
      title: "转写校准",
      detail: "已生成正式文本。"
    };
  }
  updates.understanding = {
    stage: "understanding",
    status: "active",
    title: "理解原文",
    detail: "正在拆解你说到的每件事。"
  };
  return {
    inputType,
    updates,
    latest: updates.understanding
  };
}

function initialVoiceTranscriptionFlow(): ProcessingFlowState {
  const speechUpdate: AiProcessingUpdate = {
    stage: "speech",
    status: "active",
    title: "语音转文字",
    detail: "正在收尾并生成原始转写。"
  };
  return {
    inputType: "voice",
    updates: {
      speech: speechUpdate,
      transcript_repair: {
        stage: "transcript_repair",
        status: "waiting",
        title: "转写校准",
        detail: "等待原始转写。"
      }
    },
    latest: speechUpdate
  };
}

function flowStages(inputType: "text" | "voice") {
  return inputType === "voice" ? voiceProcessingStageOrder : processingStageOrder;
}

function ProcessingFlow({ flow }: { flow: ProcessingFlowState }) {
  const stages = flowStages(flow.inputType);
  const latest = flow.latest;

  return (
    <div className="processing-flow" role="status" aria-live="polite">
      <div className="processing-flow-head">
        <span>正在整理你的安排</span>
        <small>{latest?.status === "complete" && latest.stage === "done" ? "已完成" : "实时处理中"}</small>
      </div>
      <ol className="processing-steps" aria-label="AI 处理进度">
        {stages.map((stage) => {
          const update = flow.updates[stage];
          const status: AiProcessingStatus = update?.status ?? "waiting";
          return (
            <li className={`processing-step ${status}`} key={stage}>
              <span className="processing-node" aria-hidden="true">
                {status === "complete" ? <Check size={12} /> : status === "attention" ? "!" : null}
              </span>
              <span>{processingStepLabels[stage]}</span>
            </li>
          );
        })}
      </ol>
      <p>{latest?.detail ?? "我会逐步检查、整理并保存。"}</p>
    </div>
  );
}

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
  timezone,
  conversationTarget,
  onClearConversationTarget
}: {
  onSubmit: (
    text: string,
    inputType?: "text" | "voice",
    onProgress?: (update: AiProcessingUpdate) => void,
    metadata?: SubmitMetadata
  ) => ParseFeedback | Promise<ParseFeedback>;
  feedback?: ParseFeedback;
  timezone?: string;
  conversationTarget?: AssistantItemRef;
  onClearConversationTarget?: () => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [processingFlow, setProcessingFlow] = useState<ProcessingFlowState | undefined>();
  const [inputMode, setInputMode] = useState<"voice" | "text">("voice");
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Float32Array[]>([]);
  const recordingStartedAtRef = useRef<number | undefined>(undefined);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const streamControllerRef = useRef<ReadableStreamDefaultController<Uint8Array> | null>(null);
  const streamingTranscriptRef = useRef<Promise<TranscriptionResult | undefined> | null>(null);
  const streamingSupportedRef = useRef(false);
  const flowClearTimerRef = useRef<number | undefined>(undefined);
  const speechStatusTimerRef = useRef<number | undefined>(undefined);
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
      setInputMode("text");
    };
    instance.onend = () => setListening(false);
    setRecognition(instance);
  }, []);

  useEffect(() => {
    return () => {
      if (flowClearTimerRef.current) window.clearTimeout(flowClearTimerRef.current);
      if (speechStatusTimerRef.current) window.clearTimeout(speechStatusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!conversationTarget) return;
    setText("");
    setInputMode("text");
    setSpeechStatus(undefined);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [conversationTarget]);

  useEffect(() => {
    if (inputMode !== "text") return;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [inputMode]);

  useEffect(() => {
    const thread = chatThreadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [messages]);

  function clearFlowLater(delay = 2600) {
    if (flowClearTimerRef.current) window.clearTimeout(flowClearTimerRef.current);
    flowClearTimerRef.current = window.setTimeout(() => setProcessingFlow(undefined), delay);
  }

  function updateProcessingFlow(update: AiProcessingUpdate) {
    setProcessingFlow((current) => {
      const next = current ?? initialProcessingFlow(update.stage === "speech" || update.stage === "transcript_repair" ? "voice" : "text");
      const updates = {
        ...next.updates,
        [update.stage]: update
      };
      return {
        ...next,
        updates,
        latest: update
      };
    });
  }

  function showSpeechStatus(message: string, delay = 2400) {
    setSpeechStatus(message);
    if (speechStatusTimerRef.current) window.clearTimeout(speechStatusTimerRef.current);
    speechStatusTimerRef.current = window.setTimeout(() => setSpeechStatus(undefined), delay);
  }

  async function submit(inputType: "text" | "voice" = "text", overrideText = text, metadata?: SubmitMetadata) {
    const value = overrideText.trim();
    if (!value || submitting) return;
    const timestamp = Date.now();
    setSubmitting(true);
    setText("");
    setInputMode("voice");
    if (flowClearTimerRef.current) window.clearTimeout(flowClearTimerRef.current);
    setProcessingFlow(initialProcessingFlow(inputType));
    setMessages((current) => [
      ...current,
      {
        id: `user-${timestamp}`,
        role: "user",
        body: value
      }
    ]);
    try {
      const result = await onSubmit(value, inputType, updateProcessingFlow, metadata);
      updateProcessingFlow({
        stage: "done",
        status: "complete",
        title: "整理完成",
        detail: result.detail
      });
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
      clearFlowLater();
    } catch (error) {
      const errorText = error instanceof Error && error.message && !/failed to fetch/i.test(error.message)
        ? error.message
        : "AI 解析失败，未保存这次输入。请稍后重试。";
      updateProcessingFlow({
        stage: "saving",
        status: "error",
        title: "处理失败",
        detail: errorText
      });
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${timestamp}`,
          role: "assistant",
          body: errorText
        }
      ]);
      clearFlowLater(4200);
    } finally {
      setSubmitting(false);
    }
  }

  async function transcribeAudio(blob: Blob): Promise<TranscriptionResult> {
    const formData = new FormData();
    formData.append("audio", blob, "voice-input.wav");
    if (timezone) formData.append("timezone", timezone);
    const response = await fetch("/api/ai/asr", {
      method: "POST",
      headers: timezone ? { "X-Assistant-Timezone": timezone } : undefined,
      body: formData
    });
    const payload = (await response.json()) as {
      transcript?: string;
      rawTranscript?: string;
      repair?: TranscriptRepair;
      error?: string;
    };
    if (!response.ok || !payload.transcript) {
      throw new Error(payload.error ?? "Speech recognition failed.");
    }
    return {
      transcript: payload.transcript,
      rawTranscript: payload.rawTranscript,
      repair: payload.repair
    };
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
          "X-Audio-Sample-Rate": "16000",
          ...(timezone ? { "X-Assistant-Timezone": timezone } : {})
        },
        body: stream,
        duplex: "half"
      } as StreamingRequestInit)
        .then(async (response) => {
          const payload = (await response.json()) as {
            transcript?: string;
            rawTranscript?: string;
            repair?: TranscriptRepair;
            error?: string;
          };
          if (!response.ok || !payload.transcript) {
            throw new Error(payload.error ?? "Streaming speech recognition failed.");
          }
          return {
            transcript: payload.transcript,
            rawTranscript: payload.rawTranscript,
            repair: payload.repair
          };
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

  function capturedEnoughAudio() {
    const recordedMs = recordingStartedAtRef.current ? Date.now() - recordingStartedAtRef.current : 0;
    const samples = audioChunksRef.current.reduce((total, chunk) => total + chunk.length, 0);
    return recordedMs >= 700 && samples > 0;
  }

  function transcriptionScore(result: TranscriptionResult) {
    const confidence = result.repair?.confidence ?? 0.55;
    return confidence + (result.repair?.needsUserConfirmation ? 0 : 0.25);
  }

  function chooseTranscription(primary: TranscriptionResult | undefined, fallback: TranscriptionResult) {
    if (!primary || !primary.transcript.trim()) return fallback;
    return transcriptionScore(fallback) > transcriptionScore(primary) ? fallback : primary;
  }

  async function handleVoiceTranscription(result: TranscriptionResult) {
    const transcript = result.transcript.trim();
    if (!transcript) throw new Error("Speech recognition failed.");

    updateProcessingFlow({
      stage: "speech",
      status: "complete",
      title: "语音转文字",
      detail: "已完成原始转写。"
    });

    const repairNeedsConfirmation = result.repair?.needsUserConfirmation;
    updateProcessingFlow({
      stage: "transcript_repair",
      status: repairNeedsConfirmation ? "attention" : "complete",
      title: "转写校准",
      detail: repairNeedsConfirmation ? "有一处内容需要你确认。" : "已校准成正式文本。"
    });

    if (repairNeedsConfirmation) {
      const timestamp = Date.now();
      setText(transcript);
      setInputMode("text");
      setMessages((current) => [
        ...current,
        {
          id: `assistant-transcript-${timestamp}`,
          role: "assistant",
          body: [
            result.repair?.question ?? "我不太确定刚才的语音内容是否准确，请确认后再发送。",
            "我先把候选内容放在输入框里，你可以直接发送，也可以改完再发送。"
          ].join("\n")
        }
      ]);
      return;
    }

    await submit("voice", transcript, {
      originalText: result.rawTranscript,
      transcriptRepair: result.repair
    });
  }

  async function startRecording() {
    setSpeechStatus(undefined);
    if (speechStatusTimerRef.current) window.clearTimeout(speechStatusTimerRef.current);
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
    recordingStartedAtRef.current = Date.now();
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
    if (flowClearTimerRef.current) window.clearTimeout(flowClearTimerRef.current);

    const audioContext = audioContextRef.current;
    const sampleRate = audioContext?.sampleRate ?? 48000;
    const hasEnoughAudio = capturedEnoughAudio();

    audioProcessorRef.current?.disconnect();
    audioSourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    audioProcessorRef.current = null;
    audioSourceRef.current = null;
    silentGainRef.current = null;
    finishStreamingTranscription();

    try {
      await audioContext?.close();
      if (!hasEnoughAudio) {
        setProcessingFlow(undefined);
        setSpeechStatus(undefined);
        return;
      }
      setProcessingFlow(initialVoiceTranscriptionFlow());
      const streamingResult = streamingTranscriptRef.current ? await streamingTranscriptRef.current : undefined;
      let transcription = streamingResult?.transcript.trim() ? streamingResult : undefined;
      if (!transcription || transcription.repair?.needsUserConfirmation) {
        try {
          transcription = chooseTranscription(transcription, await transcribeBufferedAudio(sampleRate));
        } catch (fallbackError) {
          if (!transcription) throw fallbackError;
        }
      }
      if (!transcription) {
        setProcessingFlow(undefined);
        showSpeechStatus("没有听到有效内容。");
        return;
      }
      await handleVoiceTranscription(transcription);
    } catch (error) {
      setProcessingFlow(undefined);
      const message = error instanceof Error ? error.message : "";
      showSpeechStatus(/no transcript|no voice input|speech recognition/i.test(message) ? "没有听到有效内容。" : message || "语音识别失败，请再试一次。");
    } finally {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      audioContextRef.current = null;
      audioChunksRef.current = [];
      recordingStartedAtRef.current = undefined;
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
        setInputMode("voice");
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
  const voiceState = recording || listening ? "正在听，点按结束" : speechBusy ? "正在收尾" : "点按开始说话";
  const hasChat = messages.length > 0;
  const composerState = recording || listening ? "listening" : speechBusy ? "busy" : "";
  const textPlaceholder = recording || listening
    ? "正在听，你可以继续说..."
    : speechBusy
      ? "正在整理语音..."
      : conversationTarget
        ? "说出变化，例如：改到周五、标记完成、改成请假两天..."
        : "先说出来，我来整理；也可以打字补充...";

  return (
    <section className={hasChat ? "voice-card capture-panel has-chat" : "voice-card capture-panel"} aria-labelledby={`${textareaId}-heading`} aria-busy={submitting || speechBusy}>
      <div className="voice-intro">
        <p className="eyebrow">Capture</p>
        <h1 id={`${textareaId}-heading`} className="voice-title">
          说或写，都可以
        </h1>
        <p className="voice-subtitle">我会把一句话整理成待办、日程、问题或下一步</p>
      </div>

      {messages.length > 0 ? (
        <div className="chat-thread" ref={chatThreadRef} role="log" aria-live="polite" aria-label="Conversation">
          {messages.map((message) => (
            <article className={message.role === "user" ? "chat-message user" : "chat-message assistant"} key={message.id}>
              <span className="chat-role">{message.role === "user" ? "你" : "助手"}</span>
              <p>{message.body}</p>
            </article>
          ))}
        </div>
      ) : null}

      {processingFlow ? <ProcessingFlow flow={processingFlow} /> : null}

      <div className={composerState ? `voice-composer ${composerState}` : "voice-composer"}>
        <label className="sr-only" htmlFor={textareaId}>
          Life input
        </label>
        <p id={textareaDescriptionId} className="sr-only">
          Add a task, event, shopping item, check-in, or note.
        </p>
        {!conversationTarget ? <p className="voice-composer-hint">更适合直接说：提醒、计划、琐事都可以一口气讲完</p> : null}
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
        <div className={inputMode === "text" ? "voice-composer-shell text-mode" : "voice-composer-shell voice-mode"}>
          <button
            className={inputMode === "text" ? "composer-keyboard-button active" : "composer-keyboard-button"}
            type="button"
            onClick={() => setInputMode((current) => (current === "text" ? "voice" : "text"))}
            disabled={recording || listening || speechBusy || submitting}
            aria-label={inputMode === "text" ? "切换回语音输入" : "切换到文字输入"}
            aria-pressed={inputMode === "text"}
            title={inputMode === "text" ? "切换回语音输入" : "切换到文字输入"}
          >
            <Keyboard size={17} aria-hidden="true" />
          </button>
          {inputMode === "voice" ? (
            <>
              <button
                className={recording || listening ? "composer-voice-main recording" : "composer-voice-main"}
                type="button"
                onClick={() => void toggleSpeech()}
                disabled={speechBusy || submitting || (!supportsSpeech && !recognition)}
                aria-label={voiceLabel}
                aria-pressed={recording || listening}
                title={voiceState}
              >
                {recording || listening ? <Square size={18} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
                <span>{voiceState}</span>
              </button>
              <span className="composer-side-balance" aria-hidden="true" />
            </>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                id={textareaId}
                className="capture-textarea voice-textarea"
                rows={1}
                value={text}
                placeholder={textPlaceholder}
                aria-describedby={textareaDescriptionId}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit("text");
                }}
              />
              <button className="composer-send-button" type="button" onClick={() => void submit("text")} disabled={!text.trim() || submitting || recording || listening || speechBusy}>
                <Send size={16} aria-hidden="true" />
                <span>{submitting ? "发送中" : "发送"}</span>
              </button>
            </>
          )}
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
