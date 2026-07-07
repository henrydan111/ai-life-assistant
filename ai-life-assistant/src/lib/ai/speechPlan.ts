import WebSocket from "ws";
import { gunzipSync, gzipSync } from "zlib";
import { createId } from "@/lib/id";

type SpeechSocketResult = {
  jsonMessages: unknown[];
  binaryMessages: Buffer[];
};

type SpeechError = Error & {
  statusCode?: number;
};

type TtsAttemptResult = {
  ok: boolean;
  status: number;
  contentType?: string | null;
  audio?: Buffer;
  error?: string;
};

function apiKey() {
  return process.env.ARK_AGENT_PLAN_API_KEY;
}

function speechHeaders(resourceId: string, connectId: string) {
  const key = apiKey();
  if (!key) throw new Error("Agent Plan API key is not configured.");

  return {
    "X-Api-Key": key,
    "X-Api-Resource-Id": resourceId,
    "X-Api-Request-Id": connectId,
    "X-Api-Connect-Id": connectId,
    "X-Api-Sequence": "-1",
    "X-Control-Require-Usage-Tokens-Return": "*"
  };
}

function httpSpeechHeaders(resourceId: string, requestId: string) {
  const key = apiKey();
  if (!key) throw new Error("Agent Plan API key is not configured.");

  return {
    "Content-Type": "application/json",
    Connection: "keep-alive",
    "X-Api-Key": key,
    "X-Api-Resource-Id": resourceId,
    "X-Api-Request-Id": requestId,
    "X-Control-Require-Usage-Tokens-Return": "*"
  };
}

function parseJsonMessage(data: Buffer) {
  const text = data.toString("utf8");
  if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function findText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    return value.map(findText).find(Boolean);
  }

  const record = value as Record<string, unknown>;
  const directKeys = ["text", "transcript", "utterance", "result_text"];
  for (const key of directKeys) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) return item.trim();
  }

  for (const nested of ["result", "payload", "data", "message"]) {
    const found = findText(record[nested]);
    if (found) return found;
  }

  return undefined;
}

function collectTextCandidates(value: unknown, candidates: string[] = []) {
  if (!value || typeof value !== "object") return candidates;
  if (Array.isArray(value)) {
    value.forEach((item) => collectTextCandidates(item, candidates));
    return candidates;
  }

  const record = value as Record<string, unknown>;
  const directKeys = ["text", "transcript", "utterance", "result_text", "sentence", "display_text"];
  for (const key of directKeys) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) candidates.push(item.trim());
  }

  for (const nested of ["result", "payload", "data", "message", "utterances"]) {
    collectTextCandidates(record[nested], candidates);
  }

  return candidates;
}

function collapseRepeatedChineseSpans(text: string) {
  let next = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const before = next;
    for (let size = 8; size >= 2; size -= 1) {
      next = next.replace(new RegExp(`([\\u4e00-\\u9fff]{${size}})\\1`, "g"), "$1");
    }
    if (before === next) break;
  }
  return next;
}

function cleanAsrTranscript(text: string) {
  let result = text.trim().replace(/\s+/g, " ");
  if (!/[\u4e00-\u9fff]/.test(result)) return result;

  result = result
    .replace(/\s+/g, "")
    .replace(/[。！？!?；;，,、]+/g, "")
    .replace(/晚晚饭/g, "晚饭")
    .replace(/早早饭/g, "早饭")
    .replace(/午午饭/g, "午饭");

  result = collapseRepeatedChineseSpans(result)
    .replace(/然后/g, "，然后")
    .replace(/到时候/g, "，到时候")
    .replace(/(.)(提醒我)/g, "$1，$2")
    .replace(/，+/g, "，")
    .replace(/^，|，$/g, "");

  return result;
}

function findAudio(value: unknown): Buffer | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    return value.map(findAudio).find(Boolean);
  }

  const record = value as Record<string, unknown>;
  const directKeys = ["audio", "data", "audio_data", "payload"];
  for (const key of directKeys) {
    const item = record[key];
    if (typeof item === "string" && item.length > 32) {
      try {
        return Buffer.from(item, "base64");
      } catch {
        continue;
      }
    }
  }

  for (const nested of ["result", "payload", "data", "message"]) {
    const found = findAudio(record[nested]);
    if (found) return found;
  }

  return undefined;
}

function parseTtsJsonLines(bytes: Buffer) {
  const text = bytes.toString("utf8");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length || !lines.every((line) => line.startsWith("{"))) return undefined;

  const audioChunks: Buffer[] = [];
  const errors: string[] = [];

  for (const line of lines) {
    let item: Record<string, unknown>;
    try {
      item = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return undefined;
    }

    const code = typeof item.code === "number" ? item.code : 0;
    const message = typeof item.message === "string" ? item.message : "";
    if (typeof item.data === "string" && item.data) {
      audioChunks.push(Buffer.from(item.data, "base64"));
    }
    if (code > 0 && code !== 20000000) {
      errors.push(message ? `${code}: ${message}` : `TTS returned code ${code}.`);
    }
  }

  return {
    audio: audioChunks.length ? Buffer.concat(audioChunks) : undefined,
    error: errors.join(" | ") || undefined
  };
}

function requestSpeechSocket({
  url,
  resourceId,
  onOpen,
  timeoutMs = 25000
}: {
  url: string;
  resourceId: string;
  onOpen: (socket: WebSocket, connectId: string) => void;
  timeoutMs?: number;
}) {
  const connectId = createId("speech");
  const jsonMessages: unknown[] = [];
  const binaryMessages: Buffer[] = [];

  return new Promise<SpeechSocketResult>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: speechHeaders(resourceId, connectId) });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("Agent Plan speech request timed out."));
    }, timeoutMs);

    socket.on("open", () => {
      try {
        onOpen(socket, connectId);
      } catch (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
    });

    socket.on("message", (data) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const json = parseJsonMessage(buffer);
      if (json) {
        jsonMessages.push(json);
        const record = json as Record<string, unknown>;
        if (record.event === "done" || record.is_final === true || record.final === true) {
          socket.close();
        }
        return;
      }
      binaryMessages.push(buffer);
    });

    socket.on("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      const error = new Error(`Agent Plan speech WebSocket handshake failed with ${response.statusCode}.`) as SpeechError;
      error.statusCode = response.statusCode;
      reject(error);
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    socket.on("close", () => {
      clearTimeout(timer);
      resolve({ jsonMessages, binaryMessages });
    });
  });
}

async function requestTtsHttp(url: string, resourceId: string, body: unknown): Promise<TtsAttemptResult> {
  const requestId = createId("tts");
  const response = await fetch(url, {
    method: "POST",
    headers: httpSpeechHeaders(resourceId, requestId),
    body: JSON.stringify(body)
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type");
  const ttsStream = parseTtsJsonLines(bytes);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      contentType,
      error: ttsStream?.error ?? bytes.toString("utf8", 0, Math.min(bytes.length, 500))
    };
  }

  if (ttsStream) {
    if (ttsStream.audio?.length) {
      return { ok: true, status: response.status, contentType: "audio/mpeg", audio: ttsStream.audio };
    }
    return {
      ok: false,
      status: response.status,
      contentType,
      error: ttsStream.error ?? bytes.toString("utf8", 0, Math.min(bytes.length, 500))
    };
  }

  if (contentType?.includes("application/json")) {
    const json = parseJsonMessage(bytes);
    const audio = findAudio(json);
    return audio
      ? { ok: true, status: response.status, contentType: "audio/mpeg", audio }
      : {
          ok: false,
          status: response.status,
          contentType,
          error: bytes.toString("utf8", 0, Math.min(bytes.length, 500))
        };
  }

  return {
    ok: true,
    status: response.status,
    contentType: contentType ?? "audio/mpeg",
    audio: bytes
  };
}

export async function synthesizeWithAgentPlan(text: string) {
  const url = process.env.ARK_TTS_URL;
  const resourceId = process.env.ARK_TTS_RESOURCE_ID ?? "seed-tts-2.0";
  if (!url) throw new Error("ARK_TTS_URL is not configured.");
  if (!text.trim()) throw new Error("Text is required.");

  const voice = process.env.ARK_TTS_VOICE ?? "zh_female_vv_uranus_bigtts";
  const result = await requestTtsHttp(url, resourceId, {
    req_params: {
      text,
      speaker: voice,
      audio_params: {
        format: "mp3",
        sample_rate: 24000
      }
    }
  });

  if (result.ok && result.audio?.length) {
    return {
      audio: result.audio,
      contentType: result.contentType ?? "audio/mpeg"
    };
  }

  throw new Error(result.error ?? `HTTP ${result.status}`);
}

const protocolVersion = 0b0001;
const clientFullRequest = 0b0001;
const clientAudioOnlyRequest = 0b0010;
const serverFullResponse = 0b1001;
const serverErrorResponse = 0b1111;
const positiveSequence = 0b0001;
const negativeWithSequence = 0b0011;
const jsonSerialization = 0b0001;
const gzipCompression = 0b0001;

type AsrResponse = {
  code: number;
  isLastPackage: boolean;
  payloadSequence: number;
  payloadMessage?: unknown;
};

function int32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
}

function uint32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function asrHeader(messageType: number, flags: number) {
  return Buffer.from([
    (protocolVersion << 4) | 1,
    (messageType << 4) | flags,
    (jsonSerialization << 4) | gzipCompression,
    0
  ]);
}

function fullAsrRequest({
  sequence,
  format = "wav",
  enablePunc = true,
  enableDdc = true,
  showUtterances = true
}: {
  sequence: number;
  format?: string;
  enablePunc?: boolean;
  enableDdc?: boolean;
  showUtterances?: boolean;
}) {
  const payload = gzipSync(
    Buffer.from(
      JSON.stringify({
        user: { uid: "ai-life-assistant" },
        audio: {
          format,
          codec: "raw",
          rate: 16000,
          bits: 16,
          channel: 1
        },
        request: {
          model_name: "bigmodel",
          enable_itn: true,
          enable_punc: enablePunc,
          enable_ddc: enableDdc,
          show_utterances: showUtterances,
          enable_nonstream: false
        }
      })
    )
  );

  return Buffer.concat([asrHeader(clientFullRequest, positiveSequence), int32(sequence), uint32(payload.length), payload]);
}

function audioAsrRequest(sequence: number, segment: Buffer, isLast: boolean) {
  const payload = gzipSync(segment);
  const requestSequence = isLast ? -sequence : sequence;
  return Buffer.concat([
    asrHeader(clientAudioOnlyRequest, isLast ? negativeWithSequence : positiveSequence),
    int32(requestSequence),
    uint32(payload.length),
    payload
  ]);
}

function parseAsrResponse(data: Buffer): AsrResponse {
  const headerSize = (data[0] & 0x0f) * 4;
  const messageType = data[1] >> 4;
  const flags = data[1] & 0x0f;
  const serialization = data[2] >> 4;
  const compression = data[2] & 0x0f;
  let offset = headerSize;
  let payloadSequence = 0;
  let isLastPackage = false;
  let code = 0;

  if (flags & 0x01) {
    payloadSequence = data.readInt32BE(offset);
    offset += 4;
  }
  if (flags & 0x02) {
    isLastPackage = true;
  }
  if (flags & 0x04) {
    offset += 4;
  }

  if (messageType === serverFullResponse) {
    const payloadSize = data.readUInt32BE(offset);
    offset += 4;
    data = data.subarray(offset, offset + payloadSize);
  } else if (messageType === serverErrorResponse) {
    code = data.readInt32BE(offset);
    offset += 4;
    const payloadSize = data.readUInt32BE(offset);
    offset += 4;
    data = data.subarray(offset, offset + payloadSize);
  } else {
    data = data.subarray(offset);
  }

  if (data.length && compression === gzipCompression) {
    data = gunzipSync(data);
  }

  let payloadMessage: unknown;
  if (data.length && serialization === jsonSerialization) {
    payloadMessage = JSON.parse(data.toString("utf8")) as unknown;
  }

  return { code, isLastPackage, payloadSequence, payloadMessage };
}

function asrErrorMessage(response: AsrResponse) {
  const detail = findText(response.payloadMessage);
  const fallback = response.payloadMessage ? JSON.stringify(response.payloadMessage).slice(0, 500) : undefined;
  return [`Agent Plan ASR returned code ${response.code}.`, detail ?? fallback].filter(Boolean).join(" ");
}

function readWavAudio(audio: Buffer) {
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Agent Plan ASR expects a 16 kHz mono WAV recording.");
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let pcm: Buffer | undefined;

  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = Math.min(chunkStart + chunkSize, audio.length);

    if (chunkId === "fmt ") {
      audioFormat = audio.readUInt16LE(chunkStart);
      channels = audio.readUInt16LE(chunkStart + 2);
      sampleRate = audio.readUInt32LE(chunkStart + 4);
      bitsPerSample = audio.readUInt16LE(chunkStart + 14);
    } else if (chunkId === "data") {
      pcm = audio.subarray(chunkStart, chunkEnd);
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (!pcm?.length) throw new Error("WAV recording has no audio data.");
  if (audioFormat !== 1 || channels !== 1 || sampleRate !== 16000 || bitsPerSample !== 16) {
    throw new Error("Agent Plan ASR requires PCM WAV audio: 16 kHz, mono, 16-bit.");
  }

  return audio;
}

function waitForSocketOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => {
      reject(new Error(`Agent Plan ASR WebSocket handshake failed with ${response.statusCode}.`));
    });
  });
}

function createMessageQueue(socket: WebSocket) {
  const queue: Buffer[] = [];
  const waiters: Array<(value: Buffer) => void> = [];

  socket.on("message", (data) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    const waiter = waiters.shift();
    if (waiter) waiter(buffer);
    else queue.push(buffer);
  });

  return {
    next(timeoutMs: number) {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Agent Plan ASR request timed out.")), timeoutMs);
        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    }
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envBoolean(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

async function readFinalAsrTranscript(messages: ReturnType<typeof createMessageQueue>, responses: unknown[]) {
  while (true) {
    const response = parseAsrResponse(await messages.next(45000));
    if (response.payloadMessage) responses.push(response.payloadMessage);
    if (response.code !== 0) throw new Error(asrErrorMessage(response));
    if (response.isLastPackage || response.payloadSequence < 0) break;
  }

  const transcript = responses
    .flatMap((response) => collectTextCandidates(response))
    .map(cleanAsrTranscript)
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => right.length - left.length)[0];
  if (!transcript) {
    throw new Error("Agent Plan ASR returned no transcript. Please try a clearer or longer recording.");
  }

  return transcript;
}

export async function transcribeWithAgentPlan(audio: Buffer, mimeType: string) {
  const url = process.env.ARK_ASR_URL;
  const resourceId = process.env.ARK_ASR_RESOURCE_ID ?? "volc.seedasr.sauc.duration";
  if (!url) throw new Error("ARK_ASR_URL is not configured.");
  if (!audio.length) throw new Error("Audio is required.");
  if (!mimeType.includes("wav")) throw new Error("Voice input must be recorded as WAV for Agent Plan ASR.");

  const wav = readWavAudio(audio);
  const connectId = createId("asr");
  const socket = new WebSocket(url, { headers: speechHeaders(resourceId, connectId) });
  const messages = createMessageQueue(socket);
  const responses: unknown[] = [];

  try {
    await waitForSocketOpen(socket);

    let sequence = 1;
    socket.send(fullAsrRequest({ sequence, format: "wav" }));
    sequence += 1;

    const initial = parseAsrResponse(await messages.next(10000));
    if (initial.code !== 0) throw new Error(asrErrorMessage(initial));
    if (initial.payloadMessage) responses.push(initial.payloadMessage);

    const segmentDurationMs = envNumber("ARK_ASR_SEGMENT_MS", 200);
    const segmentDelayMs = envNumber("ARK_ASR_CHUNK_DELAY_MS", 20);
    const segmentSize = Math.max(3200, Math.round((16000 * 2 * segmentDurationMs) / 1000));
    for (let offset = 0; offset < wav.length; offset += segmentSize) {
      const segment = wav.subarray(offset, Math.min(offset + segmentSize, wav.length));
      const isLast = offset + segmentSize >= wav.length;
      socket.send(audioAsrRequest(sequence, segment, isLast));
      if (!isLast) sequence += 1;
      if (!isLast && segmentDelayMs > 0) await sleep(segmentDelayMs);
    }

    return await readFinalAsrTranscript(messages, responses);
  } finally {
    socket.close();
  }
}

export async function transcribePcmStreamWithAgentPlan(audioChunks: AsyncIterable<Buffer>) {
  const url = process.env.ARK_ASR_URL;
  const resourceId = process.env.ARK_ASR_RESOURCE_ID ?? "volc.seedasr.sauc.duration";
  if (!url) throw new Error("ARK_ASR_URL is not configured.");

  const connectId = createId("asr");
  const socket = new WebSocket(url, { headers: speechHeaders(resourceId, connectId) });
  const messages = createMessageQueue(socket);
  const responses: unknown[] = [];
  const streamFormat = process.env.ARK_ASR_STREAM_FORMAT ?? "pcm";
  const segmentDurationMs = envNumber("ARK_ASR_SEGMENT_MS", 200);
  const segmentSize = Math.max(3200, Math.round((16000 * 2 * segmentDurationMs) / 1000));
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let sequence = 1;
  let sentBytes = 0;

  function sendSegment(segment: Buffer, isLast: boolean) {
    if (!segment.length && !isLast) return;
    socket.send(audioAsrRequest(sequence, segment, isLast));
    if (!isLast) sequence += 1;
    sentBytes += segment.length;
  }

  try {
    await waitForSocketOpen(socket);

    socket.send(
      fullAsrRequest({
        sequence,
        format: streamFormat,
        enablePunc: envBoolean("ARK_ASR_STREAM_ENABLE_PUNC", false),
        enableDdc: envBoolean("ARK_ASR_STREAM_ENABLE_DDC", false),
        showUtterances: envBoolean("ARK_ASR_STREAM_SHOW_UTTERANCES", false)
      })
    );
    sequence += 1;

    const initial = parseAsrResponse(await messages.next(10000));
    if (initial.code !== 0) throw new Error(asrErrorMessage(initial));
    if (initial.payloadMessage) responses.push(initial.payloadMessage);

    for await (const chunk of audioChunks) {
      if (!chunk.length) continue;
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= segmentSize) {
        sendSegment(pending.subarray(0, segmentSize), false);
        pending = pending.subarray(segmentSize);
      }
    }

    if (!sentBytes && !pending.length) {
      throw new Error("No voice input was captured.");
    }

    sendSegment(pending, true);
    return await readFinalAsrTranscript(messages, responses);
  } finally {
    socket.close();
  }
}
