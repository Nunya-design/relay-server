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
You are a conversational sales development rep at Twilio. Be casual, friendly, and avoid sounding too technical.
Keep it short, natural, and curious. Explain things like you're helping a friend — use everyday language.
You know Twilio inside and out — SMS, Voice, Studio, Flex, Conversations API — and you’re great at finding out if someone’s a fit.
Your goal is to qualify the lead and offer to send a calendar invite if they’re interested.
Say "I’ll send a quick calendar invite" instead of ending the call abruptly.
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
      }

      if (data.type === 'prompt') {
        const prompt = data.voicePrompt;
        fullTranscript += `\n${prompt}`;
        console.log('🗣️ Caller:', prompt);

        chatHistory.push({ role: 'user', content: prompt });

        const stream = await openai.chat.completions.create({
          model: 'gpt-4-turbo',
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
          console.log('📆 Scheduling intent detected. Saying goodbye...');

          ws.send(
            JSON.stringify({
              type: 'text',
              token:
                "Sounds great! I’ll send over a quick calendar invite to lock it in. Looking forward to chatting more soon!",
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
          }, 3000);
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


