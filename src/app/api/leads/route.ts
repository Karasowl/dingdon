// app/api/leads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { emailService } from "@/lib/email/server";
import { checkRateLimit } from "@/lib/rateLimit";


// Funcion para crear respuestas con CORS
function createCorsResponse(body: any, status: number = 200) {
    const response = NextResponse.json(body, { status });
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return response;
}

export async function POST(req: NextRequest) {

    try {
        // Rate limit: 10 leads per minute per IP
        const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
        if (!checkRateLimit(`leads:${clientIp}`, 10, 60000)) {
            return createCorsResponse({ error: 'Too many requests.' }, 429);
        }

        const { workspaceId, name, email, phone } = await req.json();

        if (!workspaceId || !name || !email) {
            return createCorsResponse({ error: 'Workspace, name and email are required' }, 400)
        }

        const { error } = await supabaseAdmin
            .from('leads')
            .insert([{
                workspace_id: workspaceId,
                name,
                email,
                phone
            }])

        if (error) {
            throw error
        }

        // Enviamos la notificación por email (fire-and-forget con error logging)
        emailService.sendNewLeadNotification(workspaceId, { name, email, phone })
            .catch(err => console.error('[Leads API] Email notification failed:', err));

        return createCorsResponse({ success: true })

    } catch (error) {
        console.error("Error creating lead:", error);
        return createCorsResponse({ error: 'Failed to save contact information.' }, 500);
    }

}