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

  // Grab recordId from the URL, if present
  const url = new URL(`http://localhost?${req.url.split('?')[1]}`);
  const recordId = url.searchParams.get('recordId') || null;

  let callSid = '';
  let callerNumber = '';
  let fullTranscript = '';
  let aiSummary = '';

  // System prompt: more creative, but still short, real, and helpful
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
        // Twilio's initial setup message
        callSid = data.callSid;
        callerNumber = data.from;
        console.log(`🔗 Call SID: ${callSid}`);
      }

      if (data.type === 'prompt') {
        const prompt = data.voicePrompt;
        fullTranscript += `\n${prompt}`;
        console.log('🗣️ Caller:', prompt);

        // Add caller's message to chat history
        chatHistory.push({ role: 'user', content: prompt });

        // GPT streaming with higher temperature for more “human” responses
        const stream = await openai.chat.completions.create({
          model: 'gpt-4-turbo',
          stream: true,
          temperature: 1.0,     // 🔥 Turn up creativity
          messages: chatHistory,
        });

        let reply = '';

        for await (const chunk of stream) {
          // chunk.choices[0]?.delta?.content = next token
          const token = chunk.choices[0]?.delta?.content;
          if (!token) continue;

          reply += token;

          // Send each token as it arrives
          ws.send(
            JSON.stringify({
              type: 'text',
              token,
              last: false,
            })
          );
        }

        // Mark the final token
        ws.send(
          JSON.stringify({
            type: 'text',
            token: '',
            last: true,
          })
        );

        aiSummary = reply;
        chatHistory.push({ role: 'assistant', content: reply });

        // Basic handoff detection
        if (/schedule|book|meeting|demo|calendar/i.test(prompt)) {
          console.log('📆 Scheduling intent detected. Handoff...');

          ws.send(
            JSON.stringify({
              type: 'text',
              token:
                "Awesome! Here's the link to book a short call: https://calendly.com/your-link/15min. I'll hand you off now!",
              last: true,
            })
          );

          setTimeout(async () => {
            if (recordId) {
              // Log to Airtable or other CRM
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

            // End the call
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


  ws.on('close', () => console.log('❌ WebSocket closed'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Relay server listening on ${PORT}`);
});

