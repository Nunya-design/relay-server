import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import wav from 'wav';

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

wss.on('connection', (ws) => {
  console.log('📞 New media stream connection');

  let buffers = [];

  ws.on('message', async (msg) => {
    const data = JSON.parse(msg.toString());

    if (data.event === 'media') {
      const audioBuffer = Buffer.from(data.media.payload, 'base64');
      buffers.push(audioBuffer);
    }

    if (data.event === 'stop') {
      console.log('🛑 Media stream ended');

      // Combine all buffers into a single audio stream
      const outputPath = path.join(__dirname, 'output.wav');
      const fileWriter = new wav.FileWriter(outputPath, {
        sampleRate: 8000,
        channels: 1,
        bitDepth: 16,
      });

      for (const b of buffers) {
        fileWriter.write(b);
      }

      fileWriter.end();

      fileWriter.on('finish', async () => {
        console.log('📁 Audio saved. Sending to Whisper...');

        try {
          const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(outputPath),
            model: 'whisper-1',
          });

          console.log('📝 Transcription:', transcription.text);

          const aiResponse = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: 'You are a helpful SDR working for Twilio. Keep responses concise and friendly.' },
              { role: 'user', content: transcription.text },
            ]
          });

          console.log('🤖 AI Response:', aiResponse.choices[0].message.content);
        } catch (err) {
          console.error('❌ Whisper failed:', err.message);
        }
      });
    }
  });

  ws.on('close', () => {
    console.log('❌ WebSocket connection closed');
  });
});

