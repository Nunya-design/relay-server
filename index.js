import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import fetch from 'node-fetch';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  console.log('🟢 New ConversationRelay WebSocket connected');

  const url = new URL(`http://localhost?${req.url.split('?')[1]}`);
  const recordId = url.searchParams.get('recordId') || null;

  let callSid = '';
  let callerNumber = '';
  let fullTranscript = '';
  let aiSummary = '';
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

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'setup') {
        callSid = data.callSid;
        callerNumber = data.from;
        console.log(`🔗 Call SID: ${callSid}`);

        // ✅ Send a quick SPI response to initiate voice
        ws.send(
          JSON.stringify({
            type: 'text',
            token: "Hi there! I'm your Twilio assistant. How can I help today?",
            last: true,
          })
        );
      }

      if (data.type === 'prompt') {
        const prompt = data.voicePrompt;
        fullTranscript += `\n${prompt}`;
        console.log('🗣️ Caller:', prompt);

        chatHistory.push({ role: 'user', content: prompt });

        const stream = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          stream: true,
          messages: chatHistory,
        });

        let reply = '';

        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content;
          if (!token) continue;

          reply += token;

          ws.send(
            JSON.stringify({
              type: 'text',
              token,
              last: false,
            })
          );
        }

        ws.send(
          JSON.stringify({
            type: 'text',
            token: '',
            last: true,
          })
        );

        aiSummary = reply;
        chatHistory.push({ role: 'assistant', content: reply });

        // Detect handoff intent
        if (/schedule|book|meeting|demo|calendar/i.test(prompt)) {
          console.log('📆 Scheduling intent detected. Handoff...');

          ws.send(
            JSON.stringify({
              type: 'text',
              token:
                "Awesome! Here's the link to book a quick call: https://calendly.com/your-link/15min. I'll hand you off now!",
              last: true,
            })
          );

          setTimeout(async () => {
            if (recordId) {
              await fetch('https://voice-agent-inky.vercel.app/api/log-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  recordId,
                  callSid,
                  from: callerNumber,
                  timestamp: new Date().toISOString(),
                  transcript: fullTranscript,
                  notes: aiSummary,
                  handoffReason: 'Caller ready to book a meeting',
                }),
              });
              console.log('✅ Call data logged to Airtable');
            }

            ws.send(
              JSON.stringify({
                type: 'end',
                handoffData: JSON.stringify({
                  reasonCode: 'sdr-handoff',
                  reason: 'Interested in booking',
                }),
              })
            );
          }, 2500);
        }
      }
    } catch (err) {
      console.error('❌ WebSocket error:', err.message);
    }
  });

  ws.on('close', () => console.log('❌ WebSocket closed'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Relay server listening on port ${PORT}`);
});
