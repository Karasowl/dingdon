// src/app/api/workspaces/[workspaceId]/classify-lead/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { leadClassificationService } from '@/services/server/leadClassificationService';
import { supabaseAdmin } from '@/lib/supabase/server';

/**
 * POST: Clasificar un lead basado en el historial de chat
 * Body: { chatSessionId: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspaceId } = await params;
    const { chatSessionId, language } = await request.json();

    if (!chatSessionId) {
      return NextResponse.json(
        { error: 'chatSessionId es requerido' },
        { status: 400 }
      );
    }

    // Verificar que el chat pertenece al workspace
    const { data: chatSession, error: chatError } = await supabaseAdmin
      .from('chat_sessions')
      .select('workspace_id')
      .eq('id', chatSessionId)
      .single();

    if (chatError || chatSession?.workspace_id !== workspaceId) {
      return NextResponse.json(
        { error: 'Chat no encontrado en este workspace' },
        { status: 404 }
      );
    }

    // Realizar clasificación
    const result = await leadClassificationService.classifyLead(workspaceId, chatSessionId, language || 'es');

    if (!result) {
      return NextResponse.json(
        { error: 'No se pudo clasificar el lead' },
        { status: 400 }
      );
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('Error en clasificación de lead:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}