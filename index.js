import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  console.log('📞 New ConversationRelay WebSocket connected');

  let mediaBuffer = [];
  let mediaActive = false;

  ws.on('message', async (msg) => {
    try {
      const text = typeof msg === 'string' ? msg : msg.toString();
      const data = JSON.parse(text);

      console.log('📨 Event received:', data.event);

      if (data.event === 'start') {
        console.log('🚀 Start event:', data.start);
        mediaBuffer = [];
        mediaActive = true;
      }

      if (data.event === 'media' && mediaActive) {
        console.log('🎧 Received media chunk');
        const payload = Buffer.from(data.media.payload, 'base64');
        mediaBuffer.push(payload);
      }

      if (data.event === 'stop') {
        console.log('🛑 Stop event received');
        mediaActive = false;

        const completeAudio = Buffer.concat(mediaBuffer);
        const filename = `/tmp/${uuidv4()}.wav`;

        await Bun.write(filename, completeAudio);

        const transcription = await openai.audio.transcriptions.create({
          file: Bun.file(filename),
          model: 'whisper-1',
        });

        console.log('📝 Transcription:', transcription.text);

        const aiResponse = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful Twilio sales rep. Answer questions and try to schedule a quick meeting.',
            },
            { role: 'user', content: transcription.text },
          ],
        });

        const reply = aiResponse.choices[0].message.content;
        console.log('🤖 GPT Response:', reply);

        console.log('🎙️ Sending to ElevenLabs...');
        const ttsResponse = await axios({
          method: 'POST',
          url: `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          responseType: 'arraybuffer',
          data: {
            text: reply,
            model_id: 'eleven_monolingual_v1',
          },
        });

        const audioBuffer = Buffer.from(ttsResponse.data);

        const chunkSize = 3200;
        for (let i = 0; i < audioBuffer.length; i += chunkSize) {
          const chunk = audioBuffer.slice(i, i + chunkSize);
          const payload = chunk.toString('base64');
          ws.send(JSON.stringify({ event: 'media', media: { payload } }));
          await new Promise((res) => setTimeout(res, 100));
        }

        ws.send(JSON.stringify({ event: 'mark', mark: { name: 'done' } }));
        console.log('✅ Response streamed back to caller');
      }
    } catch (err) {
      console.error('❌ Failed to parse message:', err.message);
      console.log('📦 Raw message:', msg.toString());
    }
  });

  ws.on('close', () => {
    console.log('❌ WebSocket closed');
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err.message);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🟢 WebSocket server ready on port ${PORT}`);
});



