#!/usr/bin/env bun
/**
 * Test script to verify voice transcription flow.
 * Tests the same code path as the server handler:
 *   base64 → Buffer → temp file → Bun.file() → FormData → Groq API
 */

import { getGroqApiKey } from './packages/shared/src/config/storage'
import fs from 'fs'
import path from 'path'
import os from 'os'

async function testTranscriptionFlow() {
  console.log('=== Voice Transcription Test ===\n')

  // Step 1: Check API key
  const apiKey = getGroqApiKey()
  if (!apiKey) {
    console.error('❌ Groq API key not configured. Set it in Settings → Input.')
    process.exit(1)
  }
  console.log(`✅ Groq API key found: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`)

  // Step 2: Generate a minimal valid WAV file with a sine wave tone
  // This creates a real audio file that Whisper can process
  // 16-bit PCM, 16000 Hz, mono, 1 second of 440 Hz sine wave
  const sampleRate = 16000
  const duration = 1 // seconds
  const numSamples = sampleRate * duration
  const bitsPerSample = 16
  const numChannels = 1
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = numSamples * blockAlign

  const wavBuffer = Buffer.alloc(44 + dataSize)

  // WAV header
  wavBuffer.write('RIFF', 0)
  wavBuffer.writeUInt32LE(36 + dataSize, 4)
  wavBuffer.write('WAVE', 8)
  wavBuffer.write('fmt ', 12)
  wavBuffer.writeUInt32LE(16, 16) // chunk size
  wavBuffer.writeUInt16LE(1, 20) // PCM format
  wavBuffer.writeUInt16LE(numChannels, 22)
  wavBuffer.writeUInt32LE(sampleRate, 24)
  wavBuffer.writeUInt32LE(byteRate, 28)
  wavBuffer.writeUInt16LE(blockAlign, 32)
  wavBuffer.writeUInt16LE(bitsPerSample, 34)
  wavBuffer.write('data', 36)
  wavBuffer.writeUInt32LE(dataSize, 40)

  // Generate 440 Hz sine wave
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.5 * 32767
    wavBuffer.writeInt16LE(Math.round(sample), 44 + i * 2)
  }

  console.log(`✅ Generated test WAV: ${wavBuffer.length} bytes (${duration}s, ${sampleRate}Hz)`)

  // Step 3: Simulate the exact server flow
  // Convert to base64 (like the renderer does)
  const audioBase64 = wavBuffer.toString('base64')
  console.log(`✅ Base64 encoded: ${audioBase64.length} chars`)

  // Decode back (like the server does)
  const decodedBuffer = Buffer.from(audioBase64, 'base64')
  console.log(`✅ Decoded buffer: ${decodedBuffer.length} bytes`)
  console.log(`   Buffers match: ${Buffer.compare(wavBuffer, decodedBuffer) === 0}`)

  // Write to temp file
  const tmpFile = path.join(os.tmpdir(), `voice-test-${Date.now()}.wav`)
  fs.writeFileSync(tmpFile, decodedBuffer)
  console.log(`✅ Temp file written: ${tmpFile}`)

  // Step 4: Send to Groq API using Bun.file()
  console.log('\n--- Sending to Groq API ---')

  const formData = new FormData()
  formData.append('file', Bun.file(tmpFile), 'recording.wav')
  formData.append('model', 'whisper-large-v3-turbo')
  formData.append('language', 'ru')
  formData.append('response_format', 'text')

  try {
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    })

    console.log(`Response status: ${response.status}`)
    const responseText = await response.text()
    console.log(`Response body: "${responseText.trim()}"`)

    if (response.ok) {
      const trimmed = responseText.trim()
      if (trimmed === '' || trimmed === 'Продолжение следует...' || trimmed === 'Продолжение следует.') {
        console.log('\n⚠️  Got empty/hallucinated response — expected for a sine wave tone (no speech)')
        console.log('   This is NORMAL — Whisper hallucinates on audio without speech.')
        console.log('   The important thing is: API call works, Bun.file() + FormData works.')
      } else {
        console.log(`\n✅ Transcription returned text: "${trimmed}"`)
      }
    } else {
      console.error(`\n❌ API error: ${response.status} ${responseText}`)
    }
  } catch (error) {
    console.error(`\n❌ Fetch error:`, error)
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }

  // Step 5: Now test with Blob (old approach) to compare
  console.log('\n--- Testing OLD approach (Blob from Buffer) for comparison ---')
  const tmpFile2 = path.join(os.tmpdir(), `voice-test2-${Date.now()}.wav`)
  fs.writeFileSync(tmpFile2, decodedBuffer)

  const formData2 = new FormData()
  const blobFromBuffer = new Blob([decodedBuffer], { type: 'audio/wav' })
  formData2.append('file', blobFromBuffer, 'recording.wav')
  formData2.append('model', 'whisper-large-v3-turbo')
  formData2.append('language', 'ru')
  formData2.append('response_format', 'text')

  // Check actual blob size
  console.log(`   Blob size: ${blobFromBuffer.size} bytes`)
  const blobArrayBuffer = await blobFromBuffer.arrayBuffer()
  console.log(`   Blob arrayBuffer size: ${blobArrayBuffer.byteLength} bytes`)

  try {
    const response2 = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData2,
    })
    console.log(`   Response status: ${response2.status}`)
    const text2 = await response2.text()
    console.log(`   Response body: "${text2.trim()}"`)
  } catch (error) {
    console.error(`   Fetch error:`, error)
  } finally {
    try { fs.unlinkSync(tmpFile2) } catch {}
  }

  console.log('\n=== Test Complete ===')
}

testTranscriptionFlow().catch(console.error)
