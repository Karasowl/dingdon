// lib/email/server.ts
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase/server';
import { cryptoService } from '@/lib/crypto/server';

interface LeadData {
    name: string;
    email: string;
    phone?: string;
}

// Destinatarios fijos para notificaciones
const FIXED_RECIPIENTS = [
    'ventas@tscseguridadprivada.com.mx',
    'ismael.sg@tscseguridadprivada.com.mx',
];

// Remitente fijo verificado en Resend
const FIXED_FROM = 'noreply@guimarais.com';

/**
 * Obtiene la configuración de notificación y la API key desencriptada para un workspace.
 * @param workspaceId - El ID del workspace.
 * @returns Un objeto con la configuración necesaria para enviar un correo, o null si no está configurado.
 */
async function getNotificationConfig(workspaceId: string) {
    // 1) Intentar usar API key desde entorno
    const envApiKey = process.env.RESEND_API_KEY || process.env.DINDON_RESEND_API_KEY;
    if (envApiKey) {
        return {
            recipients: FIXED_RECIPIENTS,
            from: FIXED_FROM,
            resend: new Resend(envApiKey),
        };
    }

    // 2) Si no hay en entorno, buscar solo la API key del workspace
    const { data: workspace, error } = await supabaseAdmin
        .from('workspaces')
        .select('resend_api_key')
        .eq('id', workspaceId)
        .single();

    if (error || !workspace || !workspace.resend_api_key) {
        console.log(`[Email Service] API key de Resend no configurada para el workspace ${workspaceId}`);
        return null;
    }

    const apiKey = cryptoService.decrypt(workspace.resend_api_key);
    if (!apiKey) {
        console.error(`[Email Service] Falló la desencriptación de la API key para el workspace ${workspaceId}.`);
        return null;
    }

    return {
        recipients: FIXED_RECIPIENTS,
        from: FIXED_FROM,
        resend: new Resend(apiKey),
    };
}

export const emailService = {
    /**
     * Envía una notificación de un nuevo lead capturado.
     */
    sendNewLeadNotification: async (workspaceId: string, lead: LeadData) => {
        const config = await getNotificationConfig(workspaceId);
        if (!config) return; // Si no hay config, no hace nada.

        try {
            await config.resend.emails.send({
                from: `Notificación de Lead <${config.from}>`,
                to: config.recipients,
                subject: `Lead Nuevo Capturado: ${lead.name}`,
                html: `
                    <h1>¡Nuevo Lead!</h1>
                    <p>Se ha capturado un nuevo lead a través del chatbot.</p>
                    <ul>
                        <li><strong>Nombre:</strong> ${lead.name}</li>
                        <li><strong>Email:</strong> ${lead.email}</li>
                        <li><strong>Teléfono:</strong> ${lead.phone || 'No proporcionado'}</li>
                    </ul>
                `,
            });
            console.log(`[Email Service] Notificación de nuevo lead enviada a ${config.recipients.join(', ')}`);
        } catch (error) {
            console.error("[Email Service] Error enviando notificación de lead:", error);
        }
    },

    /**
     * Envía una notificación de una nueva solicitud de handoff.
     */
    sendHandoffNotification: async (workspaceId: string, sessionId: string, initialMessage: string) => {
        const config = await getNotificationConfig(workspaceId);
        if (!config) return;

        try {
            await config.resend.emails.send({
                from: `Solicitud de Agente <${config.from}>`,
                to: config.recipients,
                subject: `Un usuario solicita un agente (Sesión: ...${sessionId.slice(-6)})`,
                html: `
                    <h1>¡Solicitud de Agente!</h1>
                    <p>Un usuario ha solicitado hablar con un agente.</p>
                    <p><strong>Sesión ID:</strong> ${sessionId}</p>
                    <p><strong>Primer Mensaje:</strong></p>
                    <blockquote style="border-left: 4px solid #ccc; padding-left: 1em; margin: 1em 0;">${initialMessage}</blockquote>
                    <p>Por favor, ingresa al dashboard para atenderlo.</p>
                `,
            });
            console.log(`[Email Service] Notificación de handoff enviada a ${config.recipients.join(', ')}`);
        } catch (error) {
            console.error("[Email Service] Error enviando notificación de handoff:", error);
        }
    }
};