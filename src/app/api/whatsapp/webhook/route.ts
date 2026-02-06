// app/api/whatsapp/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage, validateTwilioRequest } from "@/lib/twilio";
import { supabaseAdmin } from "@/lib/supabase/server";
import { chatbotServiceBackend } from "@/services/server/chatbotServiceBackend";
import { getTranslations } from "@/lib/server/translations"
import { Message } from "@/types/chatbot";
import { emailService } from "@/lib/email/server";


export async function POST(req: NextRequest) {

    try {

        // 1- Leer el workspace desde los parametros de la url
        const workspaceId = req.nextUrl.searchParams.get('workspaceId');

        if (!workspaceId) {
            console.error("Webhook Error: El 'workspaceId' falta en la URL del webhook.");
            return NextResponse.json({ error: 'Webhook configuration error' }, { status: 400 });
        }

        const { data: workspace, error: wsError } = await supabaseAdmin
            .from('workspaces')
            .select(`id, twilio_configs (*)`)
            .eq('id', workspaceId)
            .single();

        if (wsError || !workspace) {
            console.error(`Error al buscar el workspace o su config de Twilio: ${workspaceId}`, wsError);
            return new NextResponse('Workspace configuration error.', { status: 500 });
        }

        // Este es el objeto de configuración que usaremos.
        // Si un workspace no tiene una config asignada, twilio_configs será null.
        const twilioConfig = Array.isArray(workspace.twilio_configs)
            ? workspace.twilio_configs[0]
            : workspace.twilio_configs;

        // Si no hay una configuración de Twilio asignada, no podemos enviar mensajes.
        if (!twilioConfig) {
            console.error(`El workspace ${workspaceId} no tiene una configuración de Twilio asignada.`);
            return new NextResponse('Twilio not configured for this workspace.', { status: 500 });
        }

        // 2- Leer los datos del formulario en Twilio. Twilio envia los datos como 'form-data', no JSON
        const body = await req.formData()

        // Validate Twilio signature to prevent spoofed requests
        const twilioSignature = req.headers.get('x-twilio-signature') || '';
        if (twilioSignature) {
            const params: Record<string, string> = {};
            body.forEach((value, key) => { params[key] = value.toString(); });
            const webhookUrl = req.url;
            if (!validateTwilioRequest(twilioConfig, twilioSignature, webhookUrl, params)) {
                console.warn(`[WhatsApp Webhook] Invalid Twilio signature for workspace ${workspaceId}`);
                return new NextResponse('Invalid signature', { status: 403 });
            }
        }

        const userPhone = body.get('From') as string
        const userMessage = body.get('Body') as string

        if (!userPhone || !userMessage) {
            return NextResponse.json({ error: 'Invalid Twilio request' }, { status: 400 });
        }

        console.log(`Mensaje de ${userPhone} para workspace ${workspaceId}: "${userMessage}"`);

        // - DETERMINAR EL IDIOMA Y CARGAR TRADUCCIONES -
        // En el futuro, este 'language' podría venir de la configuración del workspace en la DB.
        const language = 'es';
        const t = await getTranslations(language);

        // 3- Buscar o crear una sesion de chat activa
        let { data: session } = await supabaseAdmin
            .from('chat_sessions')
            .select('*')
            .eq('user_identifier', userPhone)
            .eq('workspace_id', workspaceId)
            .in('status', ['bot', 'pending', 'in_progress'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        // 4- Si no hay sesion activa, crear una nueva
        if (!session) {
            console.log(`No se encontró sesión activa para ${userPhone}. Verificando si es un cliente recurrente...`);

            // Normalizamos el número de teléfono SÓLO para esta búsqueda específica.
            const phoneForLeadSearch = userPhone.replace('whatsapp:', '');

            // --- INICIO DEL DIAGNÓSTICO ---
            console.log(`[DIAGNÓSTICO] Buscando en tabla 'leads' con:`);
            console.log(`[DIAGNÓSTICO]   - phone: "${phoneForLeadSearch}"`);
            console.log(`[DIAGNÓSTICO]   - workspace_id: "${workspaceId}"`);

            // Buscamos en la tabla 'leads' usando el numero de telefono
            const { data: existingLeads, error: leadError } = await supabaseAdmin
                .from('leads')
                .select('name') // Usaremos el nombre para saludar
                .eq('phone', phoneForLeadSearch)
                .eq('workspace_id', workspaceId)
                .order('created_at', { ascending: false });

            if (leadError) {
                console.error("[DIAGNÓSTICO] Error directo de Supabase al buscar leads:", leadError);
            }

            console.log("[DIAGNÓSTICO] Resultado de la búsqueda (existingLeads):", existingLeads);

            const mostRecentLead = existingLeads && existingLeads.length > 0 ? existingLeads[0] : null;

            let initialState = {};
            let welcomeMessage = '';

            if (mostRecentLead) {
                // --- CASO 1: Es un cliente recurrente ---
                console.log(`Cliente recurrente detectado: ${mostRecentLead.name}`);

                // Creamos la sesión directamente en estado 'chatting'
                initialState = {
                    conversation_state: 'chatting',
                };
                // Le damos una bienvenida personalizada
                welcomeMessage = t('whatsapp.welcomeBack', { name: mostRecentLead.name });

            } else {
                // --- CASO 2: Es un cliente nuevo ---
                console.log(`Cliente nuevo. Iniciando flujo de captura de leads.`);

                // Creamos la sesión en el estado inicial del formulario
                initialState = {
                    conversation_state: 'collecting_name',
                };
                welcomeMessage = t('whatsapp.welcome');
            }


            // Ahora creamos la sesión con el estado inicial que hemos determinado
            const { data: newSession, error } = await supabaseAdmin
                .from('chat_sessions')
                .insert({
                    workspace_id: workspaceId,
                    user_identifier: userPhone,
                    channel: 'whatsapp',
                    status: 'bot',
                    ...initialState, // El primer paso del formulario
                    history: [],
                })
                .select()
                .single();

            if (error) throw error;

            session = newSession;

            await sendWhatsAppMessage(userPhone, welcomeMessage, twilioConfig);
            return new NextResponse('', { status: 200 })
        }

        // 5- Procesar el mensaje del usuario
        const currentHistory = (session.history || []) as Message[];
        const updatedHistory: Message[] = [
            ...currentHistory,
            {
                role: 'user',
                content: userMessage,
                id: `user-${Date.now()}`,
                timestamp: new Date()
            }
        ];

        let botReply: string | null = null;

        switch (session.conversation_state) {

            case 'collecting_name':
                await supabaseAdmin
                    .from('leads')
                    .insert({
                        workspace_id: workspaceId,
                        name: userMessage,
                        email: '',
                        phone: userPhone.replace('whatsapp:', ''), // Eliminar el prefijo 'whatsapp:'
                    });

                await supabaseAdmin
                    .from('chat_sessions')
                    .update({
                        conversation_state: 'collecting_email'
                    })
                    .eq('id', session.id);

                botReply = t('whatsapp.askEmail');

                break;

            case 'collecting_email':
                const lastUserMessage = [...currentHistory].reverse().find(m => m.role === 'user');
                const leadName = lastUserMessage?.content || 'Unknown'

                await supabaseAdmin
                    .from('leads')
                    .update({
                        email: userMessage
                    })
                    .eq('workspace_id', workspaceId)
                    .eq('name', leadName);

                await supabaseAdmin
                    .from('chat_sessions')
                    .update({
                        conversation_state: 'chatting'
                    })
                    .eq('id', session.id);

                botReply = t('whatsapp.chatReady');

                emailService.sendNewLeadNotification(workspaceId, {
                    name: leadName,
                    email: userMessage,
                    phone: userPhone.replace('whatsapp:', '')
                });

                break;

            case 'chatting':

                if (session.status === 'in_progress') {
                    // --- ESTADO: AGENTE YA ESTÁ ATENDIENDO ---
                    console.log(`[WhatsApp Webhook] Reenviando mensaje de usuario a dashboard para sesión ${session.id}`);

                    // --- Llamamos a la ruta interna ---
                    const isDev = process.env.NODE_ENV !== 'production';
                    const internalApiUrl = isDev
                        ? 'http://localhost:3001/api/internal/forward-message' // Puerto fijo en desarrollo
                        : `http://localhost:${process.env.PORT || 3001}/api/internal/forward-message`; // Puerto dinámico en producción

                    const userMessageObject: Message = updatedHistory[updatedHistory.length - 1];

                    fetch(internalApiUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-internal-secret': process.env.INTERNAL_API_SECRET || ''
                        },
                        body: JSON.stringify({
                            workspaceId: workspaceId,
                            sessionId: session.id,
                            message: userMessageObject
                        })
                    }).catch(err => {
                        console.error('[WhatsApp Webhook] Error llamando al reenviador interno de mensajes:', err);
                    });

                    // Actualizamos el historial pero no enviamos respuesta desde aquí.
                    await supabaseAdmin.from('chat_sessions').update({ history: updatedHistory }).eq('id', session.id);

                } else {
                    const aiResponse = await chatbotServiceBackend.generateChatbotResponse(
                        workspaceId,
                        userMessage,
                        session.id,
                        language,
                        updatedHistory
                    );

                    if (typeof aiResponse === 'object' && aiResponse.handoff) {
                        botReply = t('chatbotUI.handoffMessage');

                        // Obtener el primer mensaje del usuario para darle contexto al agente
                        const firstUserMessage = updatedHistory?.find(
                            (msg: Message) => msg.role === 'user'
                        )

                        // Lógica para notificar al panel de agentes.
                        await supabaseAdmin
                            .from('chat_sessions')
                            .update({ status: 'pending' })
                            .eq('id', session.id)

                        // Notifica al panel de agentes a traves de la ruta interna
                        const isDev = process.env.NODE_ENV !== 'production';
                        const internalApiUrl = isDev
                            ? 'http://localhost:3001/api/internal/notify-handoff'  // Express server en desarrollo
                            : `http://localhost:${process.env.PORT || 3001}/api/internal/notify-handoff`; // Mismo servidor en producción

                        console.log("INTERNALURL: ", internalApiUrl)

                        try {
                            await fetch(internalApiUrl, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'x-internal-secret': process.env.INTERNAL_API_SECRET || ''
                                },
                                body: JSON.stringify({
                                    workspaceId: workspaceId,
                                    sessionId: session.id,
                                    history: updatedHistory,
                                    initialMessage: firstUserMessage
                                }),
                                signal: AbortSignal.timeout(5000)
                            });
                        } catch (err) {
                            console.error('[WhatsApp Webhook] Error notificando handoff:', err);
                        }
                        
                        // Nota: El correo se envía desde el servidor interno (server.js) 
                        // para evitar duplicados. No enviamos desde aquí.

                        // Informar al usuario que se le contactará con un agente
                    } else if (typeof aiResponse === 'string') {
                        botReply = aiResponse;
                    }
                }

                break;

        }

        if (botReply) {
            // Creamos el objeto de mensaje del bot
            const botMessage: Message = {
                id: `asst-${Date.now()}`,
                role: 'assistant',
                content: botReply,
                timestamp: new Date()
            }

            // Enviamos la respuesta por whatsapp
            await sendWhatsAppMessage(userPhone, botReply, twilioConfig);

            // Actualizamos el historial en la base de datos con la respuesta del bot
            const finalHistory = [...updatedHistory, botMessage];
            await supabaseAdmin
                .from('chat_sessions')
                .update({ history: finalHistory })
                .eq('id', session.id);
        }

        // Siempre respondemos 200 OK a Twilio para que no reintente.
        return new NextResponse('', { status: 200 });

    } catch (error) {
        console.error("Error en el webhook de WhatsApp:", error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}