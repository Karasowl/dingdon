import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; sessionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspaceId, sessionId } = await params;

    // Verificar que el usuario pertenece al workspace
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', session.user.id)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Obtener información de la sesión de chat
    const { data: chatSession, error: chatError } = await supabaseAdmin
      .from('chat_sessions')
      .select('history, lead_id, created_at, status')
      .eq('id', sessionId)
      .eq('workspace_id', workspaceId)
      .single();

    if (chatError || !chatSession) {
      return NextResponse.json({ error: 'Chat session not found' }, { status: 404 });
    }

    let leadInfo: any = {
      id: sessionId,
      totalInteractions: 0,
      lastInteraction: chatSession.created_at,
      tags: [],
      notes: []
    };

    // Si hay un lead_id, obtener información del lead
    if (chatSession.lead_id) {
      const { data: lead, error: leadError } = await supabaseAdmin
        .from('leads')
        .select('name, email, phone, created_at')
        .eq('id', chatSession.lead_id)
        .single();

      if (!leadError && lead) {
        leadInfo = {
          ...leadInfo,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          createdAt: lead.created_at
        };
      }
    }

    // Extraer información de los mensajes
    const history = chatSession.history as any[];
    if (history && Array.isArray(history)) {
      const userMessages = history.filter(msg => msg.role === 'user');
      leadInfo.totalInteractions = userMessages.length;
      
      if (userMessages.length > 0) {
        leadInfo.lastInteraction = userMessages[userMessages.length - 1].timestamp;
      }

      // Extraer email y teléfono de los mensajes si no existe en el lead
      if (!leadInfo.email || !leadInfo.phone) {
        const allText = userMessages.map(msg => msg.content).join(' ');
        
        if (!leadInfo.email) {
          const emailMatch = allText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
          if (emailMatch) {
            leadInfo.email = emailMatch[0];
          }
        }

        if (!leadInfo.phone) {
          const phoneMatch = allText.match(/(\+?[\d\s\-\(\)]{10,})/);
          if (phoneMatch) {
            leadInfo.phone = phoneMatch[0];
          }
        }
      }
    }

    // Las etiquetas se manejan en tiempo real por socket en ChatPanel, no en BD

    // Obtener notas internas (si existen)
    const { data: notes } = await supabaseAdmin
      .from('chat_session_notes')
      .select('id, content, agent_name, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });

    if (notes) {
      leadInfo.notes = notes.map(note => ({
        id: note.id,
        content: note.content,
        agentName: note.agent_name,
        createdAt: note.created_at
      }));
    }

    return NextResponse.json(leadInfo);

  } catch (error) {
    console.error('Error getting lead info:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}