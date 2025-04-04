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

  const chatHistory = [
    {
      role: 'system',
      content:
        'You are a helpful and friendly Twilio SDR. Ask the caller about their current communication setup and suggest a quick 15-minute meeting with a solutions engineer. Be conversational, curious, and helpful.',
    },
  ];

  ws.on('message', async (msg) => {
    try {
      const text = typeof msg === 'string' ? msg : msg.toString();
      const data = JSON.parse(text);

      console.log('📨 Incoming:', data.type);

      if (data.type === 'prompt') {
        const prompt = data.voicePrompt || '';
        console.log('🗣️ Caller said:', prompt);

        // Add to memory
        chatHistory.push({ role: 'user', content: prompt });

        const reply = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: chatHistory,
        });

        const responseText = reply.choices[0].message.content;
        chatHistory.push({ role: 'assistant', content: responseText });

        console.log('🤖 GPT:', responseText);

        // Scheduling intent check
        if (/schedule|book|meeting|15/i.test(prompt)) {
          console.log('📆 Detected scheduling intent. Sending handoff...');

          ws.send(
            JSON.stringify({
              type: 'text',
              token:
                "Awesome! I’ll send you a link to schedule. A human will follow up shortly. Thanks!",
              last: true,
            })
          );

          setTimeout(() => {
            ws.send(
              JSON.stringify({
                type: 'end',
                handoffData: JSON.stringify({
                  reasonCode: 'sdr-handoff',
                  reason: 'Caller ready to book a meeting',
                }),
              })
            );
          }, 3000);

          return;
        }

        // Normal response
        ws.send(
          JSON.stringify({
            type: 'text',
            token: responseText,
            last: true,
          })
        );
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


