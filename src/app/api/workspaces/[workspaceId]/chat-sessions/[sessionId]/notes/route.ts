import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; sessionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { workspaceId, sessionId } = await params;
    const { content } = await request.json();

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

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

    // Verificar que la sesión de chat existe
    const { data: chatSession, error: chatError } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('workspace_id', workspaceId)
      .single();

    if (chatError || !chatSession) {
      return NextResponse.json({ error: 'Chat session not found' }, { status: 404 });
    }

    // La tabla chat_session_notes debería existir, pero si no, se creará automáticamente

    // Añadir la nota
    const { data: note, error: noteError } = await supabaseAdmin
      .from('chat_session_notes')
      .insert({
        session_id: sessionId,
        workspace_id: workspaceId,
        agent_id: session.user.id,
        agent_name: session.user.name || session.user.email || 'Agente',
        content: content.trim()
      })
      .select()
      .single();

    if (noteError) {
      console.error('Error creating note:', noteError);
      return NextResponse.json({ error: 'Failed to create note' }, { status: 500 });
    }

    return NextResponse.json({
      id: note.id,
      content: note.content,
      agentName: note.agent_name,
      createdAt: note.created_at
    });

  } catch (error) {
    console.error('Error adding note:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

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

    // Obtener todas las notas de la sesión
    const { data: notes, error: notesError } = await supabaseAdmin
      .from('chat_session_notes')
      .select('id, content, agent_name, created_at')
      .eq('session_id', sessionId)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (notesError) {
      console.error('Error getting notes:', notesError);
      return NextResponse.json({ error: 'Failed to get notes' }, { status: 500 });
    }

    const formattedNotes = (notes || []).map(note => ({
      id: note.id,
      content: note.content,
      agentName: note.agent_name,
      createdAt: note.created_at
    }));

    return NextResponse.json(formattedNotes);

  } catch (error) {
    console.error('Error getting notes:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}