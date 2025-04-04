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
      content: `
You are a senior SDR at Twilio.

You are sharp, confident, and conversational. You ask helpful questions, listen well, and talk like a real human. You're very familiar with Twilio's products — SMS, Voice, Conversations API, Studio, Flex, etc.

Keep responses short (1-2 sentences max), avoid rambling. Use natural pauses and plain language. Your job is to qualify and book a quick follow-up.
      `.trim(),
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

        chatHistory.push({ role: 'user', content: prompt });

        const stream = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          stream: true,
          messages: chatHistory,
        });

        let fullResponse = '';

        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content;
          if (!token) continue;

          fullResponse += token;

          ws.send(
            JSON.stringify({
              type: 'text',
              token,
              last: false,
            })
          );
        }

        // End of response
        ws.send(
          JSON.stringify({
            type: 'text',
            token: '',
            last: true,
          })
        );

        chatHistory.push({ role: 'assistant', content: fullResponse });

        // Scheduling intent check
        if (/schedule|book|meeting|15/i.test(prompt)) {
          console.log('📆 Detected scheduling intent. Sending handoff...');

          ws.send(
            JSON.stringify({
              type: 'text',
              token:
                "Awesome! Here's the link to book a quick call: calendly.com/yourusername/15min. I'll hand you off now!",
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
          }, 2000);

          return;
        }
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


  ws.on('close', () => console.log('❌ WebSocket closed'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Relay server listening on ${PORT}`);
});


