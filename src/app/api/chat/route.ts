// app/api/chat/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { chatbotServiceBackend } from '@/services/server/chatbotServiceBackend';
import { Message } from '@/types/chatbot';
import path from 'path';
import { readFile } from 'fs/promises';
import { supabaseAdmin } from '@/lib/supabase/server';
import { emailService } from '@/lib/email/server';
import { checkRateLimit } from '@/lib/rateLimit';


// --- Helper para crear respuestas con cabeceras CORS ---
function createCorsResponse(body: any, status: number = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set('Access-Control-Allow-Origin', '*'); // Permite cualquier origen
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); // Métodos permitidos
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Cabeceras permitidas
  return response;
}

// --- Helper para cargar traducciones en el servidor ---
// Developer Note: This function manually loads translation files from the filesystem.
// This is the correct way to handle i18n in a server-side-only context like an API Route,
// as it avoids importing React-specific libraries.
async function getServerTranslations(language: string, namespace: string = 'chatbotUI') {
  const fallbackLang = 'en';
  let langToTry = language;

  try {
    const filePath = path.resolve(process.cwd(), `public/locales/${langToTry}/translation.json`);
    console.log("RUTA1: ", filePath)
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // If the requested language file doesn't exist, fall back to English.
    console.warn(`Translation file for language '${language}' not found. Falling back to '${fallbackLang}'.`);
    try {
      const fallbackPath = path.resolve(process.cwd(), `public/locales/${fallbackLang}/translation.json`);
      console.log("RUTA: ", fallbackPath)
      const data = await readFile(fallbackPath, 'utf-8');
      return JSON.parse(data);
    } catch (fallbackError) {
      console.error(`FATAL: Could not load fallback English translation file.`);
      // Return a hardcoded object as a last resort
      return { handoffMessage: "Understood. I'm finding an agent to help you. Please wait." };
    }
  }
}

/**
 * @file API route for handling chat messages.
 * @description This route acts as a secure bridge between the client and the
 * server-side chatbot logic. It receives a user's message, passes it to the
 * `chatbotServiceBackend` for processing with Gemini, and returns the AI's response.
 */

/**
 * Handles POST requests to the /api/chat endpoint.
 * @param {NextRequest} req - The incoming request object from the client.
 * @returns {Promise<NextResponse>} A JSON response containing the AI's reply or an error message.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {

  try {
    // Rate limit by IP (20 requests per minute per IP)
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkRateLimit(`chat:${clientIp}`, 20, 60000)) {
      return createCorsResponse({ error: 'Too many requests. Please try again later.' }, 429);
    }

    const body = await req.json();
    const { workspaceId, message, sessionId, history, language } = body;

    console.log(`[/api/chat] Petición recibida. El historial tiene ${history.length} mensajes.`);

    if (!workspaceId) {
      return createCorsResponse({ error: 'Workspace ID is required.' }, 400);
    }

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return createCorsResponse({ error: 'Message is required and must be a non-empty string.' }, 400);
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return createCorsResponse({ error: 'Session ID is required.' }, 400);
    }


    const aiResponse = await chatbotServiceBackend.generateChatbotResponse(workspaceId, message, sessionId, language, history);

    // Call the backend service to get the AI-generated response
    if (typeof aiResponse === 'object' && aiResponse.handoff) {
      // The backend service detected a handoff request.
      console.log(`[API Route] Handoff initiated for session ${sessionId}.`);

      // We get the initial message to provide context to the agent.
      const firstUserMessage = history?.find(
        (msg: Message) => msg.role === 'user'
      )

      // La URL de nuestro propio servidor. Render se encarga de resolver esto internamente.
      const isDev = process.env.NODE_ENV !== 'production';
      const internalApiUrl = isDev
        ? 'http://localhost:3001/api/internal/notify-handoff'
        : `http://localhost:${process.env.PORT || 3001}/api/internal/notify-handoff`;

      console.log("[API Route] Internal notify-handoff URL:", internalApiUrl);

      try {
        const notifyResponse = await fetch(internalApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_API_SECRET || ''
          },
          body: JSON.stringify({
            workspaceId: workspaceId,
            sessionId: sessionId,
            history: history,
            initialMessage: firstUserMessage
          })
        });

        if (!notifyResponse.ok) {
          console.error(`[API Route] Handoff notification failed with status ${notifyResponse.status}: ${await notifyResponse.text()}`);
        } else {
          console.log(`[API Route] Handoff notification sent successfully for session ${sessionId}`);
        }
      } catch (err) {
        console.error('[API Route] Error llamando al notificador interno de handoff:', err);
      }

      // Load the appropriate translation file on the server.
      const translations = await getServerTranslations(language);
      // Get the translated message.
      const handoffReply = translations.chatbotUI?.handoffMessage || "Understood. I'm finding an agent to help you. Please wait.";
      return createCorsResponse({
        reply: handoffReply,
        handoff: true
      });
    } else if (typeof aiResponse === 'string') {
      // Construimos los mensajes de respuesta
      const userMessage: Message = {
        id: `user-${Date.now()}`, // <-- ID como lo pediste
        role: 'user',
        content: message,
        timestamp: new Date(),
      };

      const botMessage: Message = {
        id: `assistant-${Date.now()}`, // ID similar para el bot
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date(),
      };

      const currentHistory = history || [];
      const updatedHistory = [...currentHistory, userMessage, botMessage];

       // --- LOG #3: ¿QUÉ HISTORIAL VAMOS A GUARDAR? ---
      console.log(`[/api/chat] Haciendo Upsert. El historial ahora tiene ${updatedHistory.length} mensajes. Últimos 2:`, JSON.stringify(updatedHistory.slice(-2).map(m => ({ role: m.role, content: m.content.slice(0, 20) }))));

      const { error: dbError } = await supabaseAdmin
        .from('chat_sessions')
        .upsert({
          id: sessionId,
          workspace_id: workspaceId,
          status: 'bot',
          history: updatedHistory,
        }, {
          onConflict: 'id'
        });

      if (dbError) {
        console.error(`[DB Upsert Error] Fallo al guardar la sesión de bot ${sessionId}:`, dbError);
      }

      // Notificamos al servidor de agentes para que actualice los paneles de monitoreo en tiempo real.
      const isDev = process.env.NODE_ENV !== 'production';
      const internalApiUrl = isDev
        ? 'http://localhost:3001/api/internal/bot-chat-update'
        : `http://localhost:${process.env.PORT || 3001}/api/internal/bot-chat-update`;

      // Preparamos los datos que el frontend de monitoreo necesita.
      // Usamos el último mensaje del bot como 'initialMessage' porque es el más relevante para el preview.
      const chatDataForMonitoring = {
        sessionId: sessionId,
        initialMessage: botMessage,
      };

      // --- LOG #4: ¿QUÉ ESTAMOS ENVIANDO AL MONITOR? ---
      console.log(`[/api/chat] Notificando al monitor con el último mensaje:`, JSON.stringify({ role: chatDataForMonitoring.initialMessage.role, content: chatDataForMonitoring.initialMessage.content.slice(0, 20) }));

      // Hacemos la llamada "fire-and-forget" para no retrasar la respuesta al usuario.
      fetch(internalApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.INTERNAL_API_SECRET || ''
        },
        body: JSON.stringify({
          workspaceId: workspaceId,
          chatData: chatDataForMonitoring
        })
      }).catch(err => {
        console.error('[API Route] Error llamando al notificador de monitoreo:', err);
      });

      // This is a standard AI-generated response.
      return createCorsResponse({ reply: aiResponse })
    }

    // Fallback for an unexpected response type from the service.
    console.error(`[API Route] Invalid response type from backend service for session: ${sessionId}`);
    return createCorsResponse({ error: 'Invalid response type from backend service.' }, 500);

  } catch (error) {
    // This catches potential JSON parsing errors or other unexpected issues.
    console.error('[CHAT_API_ROUTE_ERROR]', error);
    return createCorsResponse({ error: 'An internal server error occurred.' }, 500);
  }
}

