import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  console.log('🟢 ConversationRelay WebSocket connected');

  ws.on('message', async (msg) => {
    try {
      const text = typeof msg === 'string' ? msg : msg.toString();
      const data = JSON.parse(text);

      console.log('📨 Incoming:', data.type);

      if (data.type === 'prompt') {
        const prompt = data.voicePrompt || '';
        console.log('🗣️ Caller said:', prompt);

        const reply = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: 'You are a Twilio SDR. Be conversational. Ask the user about their current messaging or call setup. Suggest a 15-minute meeting to explain more.',
            },
            { role: 'user', content: prompt }
          ],
        });

        const responseText = reply.choices[0].message.content;
        console.log('🤖 GPT:', responseText);

        ws.send(JSON.stringify({
          type: 'text',
          token: responseText,
          last: true
        }));
      }
    } catch (err) {
      console.error('❌ Error:', err.message);
      console.log('📦 Raw message:', msg.toString());
    }
  });

  ws.on('close', () => console.log('❌ WebSocket closed'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Relay server listening on ${PORT}`);
});


