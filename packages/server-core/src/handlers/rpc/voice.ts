import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export function registerVoiceHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Get Groq API key
  server.handle(RPC_CHANNELS.voice.GET_GROQ_API_KEY, async () => {
    const { getGroqApiKey } = await import('@craft-agent/shared/config/storage')
    return getGroqApiKey()
  })

  // Set Groq API key
  server.handle(RPC_CHANNELS.voice.SET_GROQ_API_KEY, async (_ctx, apiKey: string) => {
    const { setGroqApiKey } = await import('@craft-agent/shared/config/storage')
    setGroqApiKey(apiKey)
  })

  // Transcribe audio via Groq Whisper API
  server.handle(RPC_CHANNELS.voice.TRANSCRIBE_AUDIO, async (_ctx, audioBase64: string) => {
    const { getGroqApiKey } = await import('@craft-agent/shared/config/storage')
    const fs = await import('fs')
    const path = await import('path')
    const os = await import('os')

    const apiKey = getGroqApiKey()
    if (!apiKey) {
      throw new Error('Groq API key not configured. Please set it in Settings → Input.')
    }

    // Decode base64 to buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64')
    console.log(`[voice] Received audio: base64 length=${audioBase64.length}, buffer size=${audioBuffer.length} bytes`)

    if (audioBuffer.length < 100) {
      throw new Error('Audio recording is too short or empty. Please try again.')
    }

    // Write to temp file to avoid Bun Blob/FormData issues
    const tmpFile = path.join(os.tmpdir(), `voice-${Date.now()}.webm`)
    fs.writeFileSync(tmpFile, audioBuffer)
    console.log(`[voice] Wrote temp file: ${tmpFile} (${audioBuffer.length} bytes)`)

    try {
      // Build multipart/form-data using Bun.file() for reliable binary handling
      const formData = new FormData()
      formData.append('file', Bun.file(tmpFile), 'recording.webm')
      formData.append('model', 'whisper-large-v3-turbo')
      formData.append('language', 'ru')
      formData.append('response_format', 'text')

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`Groq API error (${response.status}): ${errorText}`)
      }

      const text = await response.text()
      console.log(`[voice] Transcription result: "${text.trim()}"`)
      return text.trim()
    } finally {
      // Cleanup temp file
      try { fs.unlinkSync(tmpFile) } catch {}
    }
  })
}
