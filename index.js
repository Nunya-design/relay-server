import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import wav from 'wav';
import axios from 'axios';
import twilio from 'twilio';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  console.log('📞 New WebSocket connection from Twilio');

  const buffers = [];
  let callSid = '';

  ws.on('message', async (msg) => {
    const data = JSON.parse(msg.toString());

    if (data.event === 'start') {
      callSid = data.start.callSid;
      console.log('🔗 Call SID:', callSid);
    }

    if (data.event === 'media') {
      const audioBuffer = Buffer.from(data.media.payload, 'base64');
      buffers.push(audioBuffer);
    }

    if (data.event === 'stop') {
      console.log('🛑 Media stream ended');

      const outputPath = path.join(__dirname, 'output.wav');
      const fileWriter = new wav.FileWriter(outputPath, {
        sampleRate: 8000,
        channels: 1,
        bitDepth: 16,
      });

      for (const b of buffers) fileWriter.write(b);
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
              {
                role: 'system',
                content:
                  'You are a helpful SDR working for Twilio. Your job is to ask one qualifying question and try to get a meeting set up.',
              },
              { role: 'user', content: transcription.text },
            ],
          });

          const reply = aiResponse.choices[0].message.content;
          console.log('🤖 AI Response:', reply);

          if (callSid) {
            await twilioClient.calls(callSid).update({
              twiml: `<Response><Say voice="Polly.Joanna">${reply}</Say><Hangup/></Response>`,
            });
            console.log('📞 Sent GPT reply back to Twilio via REST API');
          } else {
            console.warn('⚠️ No callSid found. Cannot send response back to Twilio.');
          }
        } catch (err) {
          console.error('❌ Whisper/GPT/Twilio error:', err.message);
        }
      });
    }
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err.message);
  });

  ws.on('close', () => {
  console.log('❌ WebSocket closed');
});
