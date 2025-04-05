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
You are a top SDR at Twilio.

You speak casually, like a real human. 
Use short replies (1-2 sentences). 
You're an expert in Twilio products: 
SMS, Voice, Studio, Conversations, Flex, Verify, Segment. 
Your job is to help the caller, qualify them, 
and suggest scheduling a follow-up. 
Don't be too long or formal — keep it friendly!
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
          temperature: 1.0,
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

        if (/schedule|book|meeting|demo|calendar/i.test(prompt)) {
          console.log('📆 Scheduling intent detected. Handoff...');

          ws.send(
            JSON.stringify({
              type: 'text',
              token:
                "Awesome! Here's a Calendly link: https://calendly.com/your-link/15min. I'll hand you off now!",
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

  ws.on('close', () => {
    console.log('❌ WebSocket closed');
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Relay server listening on port ${PORT}`);
});
